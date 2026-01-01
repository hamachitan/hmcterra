import { Probot } from "probot";
import { gitBranch2SatmBranch } from "./terrautil.js";
import { getGithubUsernameFromEmail } from "./ghutil.js";
import { checkReleaseBump } from "./lints/checkReleaseBump.js";
import { checkPackager } from "./lints/checkPackager.js";
import { checkChangelog } from "./lints/checkChangelog.js";

const mdFullPkgNameRegex = /### Full Package Name\n\n(.+)-([^-]+)-([^-\n]+)$/m;
const mdRelverRegex = /### Release Version\n\n([\d\w]+)$/m;
const specPkgerRegex = /^Packager:\s*.+<(.+?)>$/m;

export default (app: Probot) => {
  app.on(["pull_request.opened", "pull_request.review_requested", "pull_request.reopened"], async (context) => {
    if (context.payload.action == "review_requested" && !context.payload.pull_request.requested_reviewers.some((user: any) => "login" in user && user.login == "hamachitan")) return;

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

    for (const { file, specContent } of fileContents) {
      // checkReleaseBump
      const releaseResult = await checkReleaseBump(context, app, file, specContent);
      allMessages.push(...releaseResult.messages);
      allReviewComments.push(...releaseResult.reviewComments);

      // checkPackager
      const packagerResult = await checkPackager(specContent, file.filename);
      allMessages.push(...packagerResult.messages);
      allReviewComments.push(...packagerResult.reviewComments);

      // checkChangelog
      const changelogResult = await checkChangelog(app, file, specContent);
      allMessages.push(...changelogResult.messages);
      allReviewComments.push(...changelogResult.reviewComments);
    }

    if (allMessages.length > 0 || allReviewComments.length > 0) {
      await context.octokit.pulls.createReview({
        ...context.pullRequest(),
        event: 'COMMENT',
        body: allMessages.join('\n\n') || 'Automated review comments:',
        comments: allReviewComments
      });
    }

    if (context.payload.action == "review_requested") {
      try {
        await context.octokit.pulls.removeRequestedReviewers(context.pullRequest({ reviewers: ['hamachitan'] }));
      } catch (error) {
        app.log.error(`fail to remove hamachitan from reviewers: ${error}`);
      }
    }
  });

  app.on(["issues.opened"], async (context) => {
    if (context.payload.issue.assignee?.login != "hamachitan") return;

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
    await fetch(`https://madoguchi.fyralabs.com/redirect/terra${satmBranch}/packages/${pkgname}/spec/raw`)
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
              assignees: ['hamachitan']
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
              .then(() => {
                app.log.info(`assigned ${githubUsername} to issue #${context.payload.issue.number}`);
              })
              .catch(assignError => {
                app.log.error(`fail to assign/unassign users to issue: ${assignError}`);
              });
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
