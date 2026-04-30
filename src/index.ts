import { ApplicationFunctionOptions, Context, Probot } from "probot";
import { gitBranch2SatmBranch, isProdBranch } from "./utils/terrautil.js";
import { getGithubUsernameFromEmail } from "./utils/github.js";
import { runRpmspec } from "./utils/rpm.js";
import { lints } from "./linting.js";
import { mdFullPkgNameRegex, mdRelverRegex, HAMACHITAN_USERNAME, MADOGUCHI_BASE_URL } from "./consts.js";
import { readFileSync } from "fs";
import processCommands from "./command.js";
import { getOrgMembers } from "./utils/orgMembersCache.js";
import { getSyncLabels } from "./utils/syncsCache.js";
import { ciLints } from "./ci_linting.js";
import { tailMatchingLines } from "./utils/logReader.js";

export async function handlePullRequestAutolabel(context: Context<"pull_request">, app: Probot) {
  if (!isProdBranch(context.payload.pull_request.base.ref)) return;
  if (context.payload.pull_request.labels.some(lbl => lbl.name === "nosync")) return;
  if (context.payload.pull_request.user.login === "raboneko") return;
  if (/\bnosync\b/.test(context.payload.pull_request.body ?? "")) return;
  if (context.payload.pull_request.body?.startsWith("# Backport\n")) return;

  const syncs = await getSyncLabels(context, app);
  if (syncs.length === 0) return;
  app.log.debug(`labelling #${context.payload.pull_request.number}`);
  await context.octokit.issues.addLabels(context.issue({ labels: syncs }));
}

export async function handlePullRequestLint(context: Context<"pull_request">, app: Probot) {
  if (context.payload.action === "review_requested" && !context.payload.pull_request.requested_reviewers.some(user => "login" in user && (user as { login: string }).login === HAMACHITAN_USERNAME)) return;
  if (!isProdBranch(context.payload.pull_request.base.ref)) return;

  const { data: files } = await context.octokit.pulls.listFiles(context.pullRequest());
  const specFiles = files.filter(file => file.filename.endsWith('.spec') && file.status !== 'removed' && file.status !== 'renamed');

  const fileContents = (await Promise.all(specFiles.map(async file => {
    try {
      const { data: fileContent } = await context.octokit.repos.getContent(context.repo({
        path: file.filename,
        ref: context.payload.pull_request.head.sha,
      }));

      if (!('content' in fileContent)) {
        app.log.warn(`Could not get content for ${file.filename}`);
        return null;
      }

      const specContent = Buffer.from(fileContent.content, 'base64').toString('utf8');
      return { file, specContent };
    } catch (error) {
      app.log.error(`Error fetching content for ${file.filename}: ${error}`);
      return null;
    }
  }))).filter(fc => fc !== null);

  const allMessages: string[] = [];
  const allReviewComments: Array<{ path: string; position: number; body: string }> = [];

  const allResults = await Promise.all(
    fileContents.flatMap(({ file, specContent }) =>
      lints.map(lint => lint.check({ context, app, file, specContent }))
    )
  );
  allMessages.push(...allResults.flatMap(r => r.messages));
  allReviewComments.push(...allResults.flatMap(r => r.reviewComments));

  if (allMessages.length > 0 || allReviewComments.length > 0) {
    await context.octokit.pulls.createReview(context.pullRequest({
      event: "COMMENT",
      body: allMessages.join("\n\n"),
      comments: allReviewComments,
    }));
  }

  if (context.payload.action === "review_requested") {
    try {
      app.log.info(`removing hamachitan from reviewers for PR #${context.payload.pull_request.number}`);
      await context.octokit.pulls.removeRequestedReviewers(context.pullRequest({ reviewers: [HAMACHITAN_USERNAME] }));
    } catch (error) {
      app.log.error(`failed to remove hamachitan from reviewers: ${error}`);
    }
  }
}

async function handleIssueAssignment(context: Context<"issues.opened" | "issues.reopened" | "issue_comment.created">, app: Probot, pkgname: string) {
  const matches = mdFullPkgNameRegex.exec(context.payload.issue.body ?? '');
  const relver = mdRelverRegex.exec(context.payload.issue.body ?? '')?.at(1);
  if (!relver) {
    app.log.warn(`cannot detect relver, matches: ${matches}`);
    app.log.trace(`issue body: ${context.payload.issue.body}`);
    await context.octokit.issues.createComment(context.issue({ body: "Cannot detect relver." }));
    return;
  }

  const satmBranch = gitBranch2SatmBranch(relver);
  let pkgerEmail;
  try {
    const url = `${MADOGUCHI_BASE_URL}/redirect/terra${satmBranch}/packages/${pkgname}/spec/raw`;
    const res = await fetch(url);
    if (!res.redirected || !res.ok) {
      app.log.error(`mg ${url}: ${res.status}: ${await res.text()}`);
      await context.octokit.issues.createComment(context.issue({ body: `🛑 The package \`${pkgname}\` cannot be found in \`terra${satmBranch}\` [mg ${res.status}].` }));
      return;
    }

    app.log.trace(`url: ${res.url}`);

    const specContent = await res.text();
    const packager = await runRpmspec(specContent, '%{packager}');
    const pkgerMatch = /^(.+)<(.+)>$/.exec(packager);
    if (!(pkgerEmail = pkgerMatch?.[2])) {
      await context.octokit.issues.createComment(context.issue({ body: "🛑 Cannot find `Packager:` in spec file." }));
      return;
    }
  } catch (e) {
    app.log.error(`cannot find pkg ${pkgname} from mg: ${e}`);
    return
  }

  const githubUsername = await getGithubUsernameFromEmail(context.octokit, pkgerEmail);
  if (!githubUsername) {
    await context.octokit.issues.createComment(context.issue({
      body: `🛑 Cannot find GitHub user for email: ${pkgerEmail}`
    }));
    return;
  }

  app.log.trace(`found username: ${githubUsername} for email: ${pkgerEmail}`);

  app.log.info(`unassigning hamachitan from issue #${context.payload.issue.number}`);
  await context.octokit.issues.removeAssignees(context.issue({ assignees: [HAMACHITAN_USERNAME] }));

  app.log.info(`assigning ${githubUsername} to issue #${context.payload.issue.number}`);
  await context.octokit.issues.addAssignees(context.issue({ assignees: [githubUsername] }));
}

export async function handleIssues(context: Context<"issues.opened" | "issues.reopened" | "issues.edited">, app: Probot) {
  if (context.payload.issue.assignee?.login !== HAMACHITAN_USERNAME) return;

  const matches = mdFullPkgNameRegex.exec(context.payload.issue.body ?? '');
  const pkgname = matches?.at(2);
  if (!pkgname) {
    app.log.warn(`cannot detect pkgname, matches: ${matches}`);
    app.log.trace(`issue body: ${context.payload.issue.body}`);
    await context.octokit.issues.createComment(context.issue({ body: "Cannot detect pkgname." }));
    return;
  }

  await handleIssueAssignment(context, app, pkgname);
}

export async function handleIssueComment(context: Context<"issue_comment.created">, app: Probot) {
  if (context.isBot) return;
  const senderLogin = context.payload.sender.login;
  // const orgLogin = context.payload.repository.owner.login;
  const orgLogin = "terrapkg";
  const orgMembers = await getOrgMembers(context, app, orgLogin);
  if (!orgMembers.includes(senderLogin)) return;

  if (!context.payload.issue.pull_request) {
    const issueMatch = /^@hamachitan (.+)-([^-]+)-([^\-\s]+)$/.exec(context.payload.comment.body.trim());
    if (issueMatch) {
      await handleIssueAssignment(context, app, issueMatch[1]);
      return;
    }
  }

  const invocations = context.payload.comment.body.split('\n').map(l => l.trim())
    .filter(l => l.startsWith('@hamachitan ') || l.startsWith('hmct '))
    .map(l => l.replace(/^(@hamachitan|hmct) /, '').trimStart());
  if (invocations.length)
    await processCommands(invocations, context, app);
}

function getJobArchFromName(name: string): string | null {
  const match = /\(([^)]+)\)/.exec(name);
  if (!match) return null;
  const parts = match[1].split(',');
  if (parts.length < 2) return null;
  return parts[1].trim();
}

function isBuildJob(name: string): boolean {
  return name.startsWith("build ");
}

function didAllBuildJobsFail(jobs: Array<{ name: string; conclusion: string | null }>): boolean {
  const buildJobs = jobs.filter(job => isBuildJob(job.name));
  if (buildJobs.length === 0) return false;
  return buildJobs.every(job => job.conclusion === "failure");
}

async function handleWorkflowRunCompleted(context: Context<"workflow_run.completed">, app: Probot) {
  if (context.payload.workflow.name !== "Automatically build packages") return;
  if (context.payload.workflow_run.pull_requests.length === 0) return;

  const { data: jobsData } = await context.octokit.actions.listJobsForWorkflowRun(context.repo({
    run_id: context.payload.workflow_run.id,
  }));

  if (!didAllBuildJobsFail(jobsData.jobs)) return;

  const buildJobs = jobsData.jobs.filter(job => isBuildJob(job.name));
  const preferredJob = buildJobs.find(job => getJobArchFromName(job.name) === "x86_64") ?? buildJobs[0];
  if (!preferredJob) return;

  const logsResponse = await context.octokit.actions.downloadJobLogsForWorkflowRun(context.repo({
    job_id: preferredJob.id,
  }));

  const logs = await tailMatchingLines(logsResponse.data as unknown as NodeJS.ReadableStream, 500);

  for (const pr of context.payload.workflow_run.pull_requests) {
    const results = await Promise.all(
      ciLints.map(lint => lint.check({
        context,
        app,
        logs,
        pullRequest: { number: pr.number },
      }))
    );
    const comments = results.flatMap(r => r.comments);
    if (comments.length === 0) continue;
    await context.octokit.issues.createComment(context.repo({
      issue_number: pr.number,
      body: comments.join("\n\n"),
    }));
  }
}

const { version } = JSON.parse(readFileSync("package.json").toString());

export default (app: Probot, { getRouter }: ApplicationFunctionOptions = {}) => {
  const isServeRepo = (repo: string) => repo === ((process.env['NODE_ENV'] === 'production') ? 'terrapkg/packages' : 'hamachitan/terra-test');

  if (getRouter) {
    const router = getRouter("/");
    router.get('/health', (_, res) => {
      res.json({ version });
    });
  }

  app.on(["pull_request.opened", "pull_request.reopened"], async context => {
    if (!isServeRepo(context.payload.repository.full_name)) return;
    await handlePullRequestAutolabel(context, app);
  });

  app.on(["pull_request.opened", "pull_request.review_requested", "pull_request.reopened"], async context => {
    if (!isServeRepo(context.payload.repository.full_name)) return;
    await handlePullRequestLint(context, app);
  });

  app.on(["issues.opened", "issues.reopened"], async context => {
    if (!isServeRepo(context.payload.repository.full_name)) return;
    await handleIssues(context, app);
  });

  app.on(["issue_comment.created"], async context => {
    if (!isServeRepo(context.payload.repository.full_name)) return;
    await handleIssueComment(context, app);
  })

  app.on(["workflow_run.completed"], async context => {
    if (!isServeRepo(context.payload.repository.full_name)) return;
    await handleWorkflowRunCompleted(context, app);
  })
};
