import { Probot } from "probot";
import { gitBranch2SatmBranch } from "./terrautil.js";
import { getGithubUsernameFromEmail } from "./ghutil.js";
import { exec } from "child_process";
import { promisify } from "util";


const execAsync = promisify(exec);

const mdFullPkgNameRegex = /### Full Package Name\n\n(.+)-([^-]+)-([^-\n]+)$/m;
const mdRelverRegex = /### Release Version\n\n([\d\w]+)$/m;

const specPkgerRegex = /^Packager:\s*.+<(.+?)>$/m;
const specReleaseRegex = /^Release:(\s*)([0-9]+)(.*)$/m;
const targetBranchRegex = /^frawhide|el\d+|f\d+$/;

async function getPackageInfo(specContent: string): Promise<{ name: string, version: string, release: string } | null> {
  try {
    const { stdout } = await execAsync(`cat << 'EOF' | rpmspec -q /dev/stdin --queryformat '%{name} %{version} %{release}'\n${specContent}\nEOF`);
    const [name, version, release] = stdout.trim().split(' ');
    return { name, version, release };
  } catch (error) {
    return null;
  }
}

async function checkPackageExists(pkgName: string, version: string, release: number, satmBranch: string): Promise<boolean> {
  try {
    const response = await fetch(`https://madoguchi.fyralabs.com/v4/terra${satmBranch}/packages/${pkgName}`);
    if (!response.ok) return false;

    const pkg = await response.json();
    return pkg.ver === version && pkg.rel.startsWith(`${release}.`);
  } catch (error) {
    return false;
  }
}

export default (app: Probot) => {
  app.on(["pull_request.opened"], async (context) => {
    const targetBranch = context.payload.pull_request.base.ref;

    if (!targetBranchRegex.test(targetBranch)) {
      app.log.trace(`Skipping PR #${context.payload.pull_request.number} - target branch ${targetBranch} does not match pattern`);
      return;
    }

    const { data: files } = await context.octokit.pulls.listFiles({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      pull_number: context.payload.pull_request.number,
    });

    const specFiles = files.filter(file => file.filename.endsWith('.spec'));

    if (specFiles.length === 0) {
      app.log.trace(`No .spec files found in PR #${context.payload.pull_request.number}`);
      return;
    }

    const satmBranch = gitBranch2SatmBranch(targetBranch);

    for (const file of specFiles) {
      try {
        const { data: fileContent } = await context.octokit.repos.getContent({
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          path: file.filename,
          ref: context.payload.pull_request.head.sha,
        });

        if (!('content' in fileContent)) {
          app.log.warn(`Could not get content for ${file.filename}`);
          continue;
        }

        const specContent = Buffer.from(fileContent.content, 'base64').toString('utf8');

        const pkgInfo = await getPackageInfo(specContent);
        if (!pkgInfo) {
          app.log.warn(`cannot parse package info with rpmspec for ${file.filename}`);
          continue;
        }

        const releaseMatch = pkgInfo.release.match(/^(\d+)(.*)$/);
        if (!releaseMatch) {
          app.log.warn(`cannot parse release from ${pkgInfo.release}`);
          continue;
        }

        const releaseNumber = parseInt(releaseMatch[1], 10);

        if (!await checkPackageExists(pkgInfo.name, pkgInfo.version, releaseNumber, satmBranch)) {
          continue;
        }

        const updatedSpecContent = specContent.replace(
          specReleaseRegex,
          `Release:$1${releaseNumber + 1}$3`
        );

        await context.octokit.repos.createOrUpdateFileContents({
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          path: file.filename,
          message: `chore(bump): release ${releaseNumber} → ${releaseNumber + 1}`,
          content: Buffer.from(updatedSpecContent).toString('base64'),
          sha: fileContent.sha,
          branch: context.payload.pull_request.head.ref,
        });

        app.log.info(`bumped release for ${pkgInfo.name} from ${releaseNumber} to ${releaseNumber + 1} in ${file.filename}`);

      } catch (error) {
        app.log.error(`error processing ${file.filename} in PR #${context.payload.pull_request.number}: ${error}`);
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
