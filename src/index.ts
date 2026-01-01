import { ApplicationFunctionOptions, Probot } from "probot";
import { gitBranch2SatmBranch, isProdBranch } from "./utils/terrautil.js";
import { getGithubUsernameFromEmail } from "./utils/github.js";
import { lints } from "./linting.js";
import { mdFullPkgNameRegex, mdRelverRegex, specPkgerRegex, HAMACHITAN_USERNAME, MADOGUCHI_BASE_URL } from "./consts.js";

export default (app: Probot, { getRouter }: ApplicationFunctionOptions) => {
  if (!getRouter) return;
  const router = getRouter("/");
  router.get('/health', (_, res) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    res.json({ version: require("../package.json").version });
  });

  app.on(["pull_request.opened", "pull_request.reopened"], async context => {
    if (context.payload.pull_request.labels.some(lbl => lbl.name === "nosync")) return;
    if (/\bnosync\b/.test(context.payload.pull_request.body ?? "")) return;
    const labels = await context.octokit.issues.listLabelsForRepo(context.repo());
    const syncs = labels.data.map(lbl => lbl.name).filter(lbl => lbl.startsWith("sync-"));
    await context.octokit.issues.addLabels(context.issue({ labels: syncs }));
    app.log.debug(`labelled #${context.payload.pull_request.number}`);
  });

  app.on(["pull_request.opened", "pull_request.review_requested", "pull_request.reopened"], async context => {
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
        body: allMessages.join("\n\n") || "Automated review comments:",
        comments: allReviewComments,
      }));
    }

    if (context.payload.action === "review_requested") {
      try {
        await context.octokit.pulls.removeRequestedReviewers(context.pullRequest({ reviewers: [HAMACHITAN_USERNAME] }));
      } catch (error) {
        app.log.error(`fail to remove hamachitan from reviewers: ${error}`);
      }
    }
  });

  app.on(["issues.opened"], async context => {
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
    await fetch(`${MADOGUCHI_BASE_URL}/redirect/terra${satmBranch}/packages/${pkgname}/spec/raw`)
      .then(async res => {
        if (!res.redirected) return app.log.error(`expected redirection from mg, got ${res.status}: ${await res.text()}`);
        if (!res.ok) return app.log.error(`mg err ${res.status}: ${await res.text()}`);

        app.log.trace(`url: ${res.url}`);

        const specContent = await res.text();
        const pkgerMatch = specPkgerRegex.exec(specContent);
        const pkgerEmail = pkgerMatch?.[1];
        if (!pkgerEmail) {
          await context.octokit.issues.createComment(context.issue({ body: "Cannot find `Packager:` in spec file." }));
          return;
        }

        getGithubUsernameFromEmail(context.octokit, pkgerEmail)
          .then(async githubUsername => {
            if (!githubUsername) {
              await context.octokit.issues.createComment(context.issue({
                body: `Cannot find GitHub user for email: ${pkgerEmail}`
              }));
              return;
            }

            app.log.trace(`found username: ${githubUsername} for email: ${pkgerEmail}`);

            // first unassign hamachitan, then assign the new packager
            context.octokit.issues.removeAssignees({
              owner: context.payload.repository.owner.login,
              repo: context.payload.repository.name,
              issue_number: context.payload.issue.number,
              assignees: [HAMACHITAN_USERNAME]
            })
              .then(() => {
                app.log.info(`unassigned hamachitan from issue #${context.payload.issue.number}`);

                return context.octokit.issues.addAssignees({
                  owner: context.payload.repository.owner.login,
                  repo: context.payload.repository.name,
                  issue_number: context.payload.issue.number,
                  assignees: [githubUsername]
                });
              })
              .then(() => app.log.info(`assigned ${githubUsername} to issue #${context.payload.issue.number}`))
              .catch(assignError => app.log.error(`fail to assign/unassign users to issue: ${assignError}`));
          })
          .catch(async error => {
            app.log.error(error);
            await context.octokit.issues.createComment(context.issue({
              body: `Error searching GitHub user for email: ${pkgerEmail}`
            }));
          });
      }, e => app.log.error(`cannot find pkg ${pkgname} from mg: ${e}`))
  });
};
