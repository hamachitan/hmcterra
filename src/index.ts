import { ApplicationFunctionOptions, Context, Probot } from "probot";
import { gitBranch2SatmBranch, isProdBranch } from "./utils/terrautil.js";
import { getGithubUsernameFromEmail } from "./utils/github.js";
import { runRpmspec } from "./utils/rpm.js";
import { lints } from "./linting.js";
import { mdFullPkgNameRegex, mdRelverRegex, HAMACHITAN_USERNAME, MADOGUCHI_BASE_URL } from "./consts.js";
import { readFileSync } from "fs";

const SYNCS_CACHE_EXPIRE = 12 * 60 * 60 * 1000; // 12 hours in ms
let syncsCache = { syncs: [''], timestamp: 0, isExpired: () => process.env.VITEST === 'true' || Date.now() - syncsCache.timestamp >= SYNCS_CACHE_EXPIRE };

export async function handlePullRequestAutolabel(context: Context<"pull_request">, app: Probot) {
  if (!isProdBranch(context.payload.pull_request.base.ref)) return;
  if (context.payload.pull_request.labels.some(lbl => lbl.name === "nosync")) return;
  if (context.payload.pull_request.user.login === "raboneko") return;
  if (/\bnosync\b/.test(context.payload.pull_request.body ?? "")) return;
  if (context.payload.pull_request.body?.startsWith("# Backport\n")) return;

  let last = syncsCache.isExpired();
  do { // repeat max twice
    try {
      let syncs: string[];
      if (syncsCache.isExpired()) {
        const labels = await context.octokit.issues.listLabelsForRepo(context.repo());
        syncs = labels.data.map(lbl => lbl.name).filter((name: string) => name.startsWith("sync-"));
        syncsCache = { ...syncsCache, syncs, timestamp: Date.now() };
      } else syncs = syncsCache.syncs;
      app.log.debug(`labelling #${context.payload.pull_request.number}`);
      await context.octokit.issues.addLabels(context.issue({ labels: syncs }));
    } catch (err) {
      app.log.error(`fail to autoassign labels: ${err}`);
      syncsCache.timestamp = 0;
    }
  } while (!last && (last = syncsCache.isExpired()))
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

export async function handleIssues(context: Context<"issues.opened" | "issues.reopened">, app: Probot) {
  if (context.payload.issue.assignee?.login !== HAMACHITAN_USERNAME) return;

  const matches = mdFullPkgNameRegex.exec(context.payload.issue.body ?? '');
  const pkgname = matches?.at(1);
  if (!pkgname) {
    app.log.warn(`cannot detect pkgname, matches: ${matches}`);
    app.log.trace(`issue body: ${context.payload.issue.body}`);
    await context.octokit.issues.createComment(context.issue({ body: "Cannot detect pkgname." }));
    return;
  }

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
    const res = await fetch(`${MADOGUCHI_BASE_URL}/redirect/terra${satmBranch}/packages/${pkgname}/spec/raw`);
    if (!res.redirected || !res.ok) {
      app.log.error(`mg ${res.status}: ${await res.text()}`);
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

const { version } = JSON.parse(readFileSync("package.json").toString());

export default (app: Probot, { getRouter }: ApplicationFunctionOptions = {}) => {
  if (getRouter) {
    const router = getRouter("/");
    router.get('/health', (_, res) => {
      res.json({ version });
    });
  }

  app.on(["pull_request.opened", "pull_request.reopened"], async context => {
    await handlePullRequestAutolabel(context, app);
  });

  app.on(["pull_request.opened", "pull_request.review_requested", "pull_request.reopened"], async context => {
    await handlePullRequestLint(context, app);
  });

  app.on(["issues.opened", "issues.reopened"], async context => {
    await handleIssues(context, app);
  });
};
