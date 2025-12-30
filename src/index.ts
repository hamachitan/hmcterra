import { Probot } from "probot";
import { gitBranch2SatmBranch } from "./terrautil.js";
import { getGithubUsernameFromEmail } from "./ghutil.js";

const mdFullPkgNameRegex = /### Full Package Name\n\n(.+)-([^-]+)-([^-\n]+)$/m;
const mdRelverRegex = /### Release Version\n\n([\d\w]+)$/m;

const specPkgerRegex = /^Packager:\s*.+<(.+?)>$/m;

export default (app: Probot) => {
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

            app.log.trace(`Found GitHub username: ${githubUsername} for email: ${pkgerEmail}`);

            // First unassign hamachitan, then assign the new packager
            context.octokit.issues.removeAssignees({
              owner: context.payload.repository.owner.login,
              repo: context.payload.repository.name,
              issue_number: context.payload.issue.number,
              assignees: ['hamachitan']
            })
              .then(() => {
                app.log.info(`Unassigned hamachitan from issue #${context.payload.issue.number}`);

                return context.octokit.issues.addAssignees({
                  owner: context.payload.repository.owner.login,
                  repo: context.payload.repository.name,
                  issue_number: context.payload.issue.number,
                  assignees: [githubUsername]
                });
              })
              .then(() => {
                app.log.info(`Assigned ${githubUsername} to issue #${context.payload.issue.number}`);
              })
              .catch(assignError => {
                app.log.error(`Failed to assign/unassign users to issue: ${assignError}`);
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
