import { Context, Probot } from "probot";
import {
  ISSUE_DETAILS_THANKS,
  mdFullPkgNameRegex,
  mdRelverRegex,
} from "./consts.ts";
import { madoguchiRepoFromRelease } from "./utils/terrautil.ts";
import {
  Build,
  getBuilds,
  getPkgInfo,
  getSpecContent,
} from "./utils/madoguchi.ts";
import { runRpmspec } from "./utils/rpm.ts";
import { getGithubUsernameFromEmail } from "./utils/github.ts";

interface Nevra {
  name: string;
  ver: string;
  rel: string;
  arch: string;
}

const formatNevra = ({ name, ver, rel, arch }: Nevra) =>
  `${name}-${ver}-${rel}.${arch}`;

function latestBuild(builds: Build[]): Build | undefined {
  return builds.reduce<Build | undefined>((latest, build) => {
    if (!latest) return build;
    return Date.parse(build.epoch) > Date.parse(latest.epoch) ? build : latest;
  }, undefined);
}

function gitBranchFromRelver(relver: string): string {
  return /^\d+$/.test(relver) ? `f${relver}` : relver;
}

async function getLastCommit(
  context: Context<"issues.opened">,
  app: Probot,
  relver: string,
  dirs: string | undefined,
  builds: Build[],
): Promise<{ sha: string; author: string; message: string } | null> {
  if (dirs) {
    try {
      const { data } = await context.octokit.repos.listCommits(context.repo({
        path: dirs,
        sha: gitBranchFromRelver(relver),
        per_page: 1,
      }));
      const commit = data[0];
      if (commit) {
        return {
          sha: commit.sha,
          author: commit.author?.login ?? commit.commit.author?.name ??
            "unknown",
          message: commit.commit.message.split("\n")[0],
        };
      }
    } catch (error) {
      app.log.debug(`failed to list commits for ${dirs}: ${error}`);
    }
  }

  const build = latestBuild(builds);
  if (!build?.commit) return null;

  try {
    const { data } = await context.octokit.repos.getCommit(context.repo({
      ref: build.commit,
    }));
    return {
      sha: data.sha,
      author: data.author?.login ?? data.commit.author?.name ?? "unknown",
      message: data.commit.message.split("\n")[0],
    };
  } catch (error) {
    app.log.debug(`failed to get commit ${build.commit}: ${error}`);
    return null;
  }
}

async function getPackagerMention(
  context: Context<"issues.opened">,
  app: Probot,
  repo: string,
  pkgname: string,
): Promise<string> {
  try {
    const specContent = await getSpecContent(repo, pkgname);
    if (!specContent) return "unspecified";

    const packager = await runRpmspec(specContent, "%{packager}");
    const email = /<(.+)>/.exec(packager)?.[1];
    if (!email) return "unspecified";

    const username = await getGithubUsernameFromEmail(context.octokit, email);
    return username ? `@${username}` : "unspecified";
  } catch (error) {
    app.log.error(`failed to find packager for ${pkgname}: ${error}`);
    return "unspecified";
  }
}

async function getOpenPullRequests(
  context: Context<"issues.opened">,
  app: Probot,
  pkgname: string,
): Promise<number[]> {
  try {
    const { owner, repo } = context.repo();
    const { data } = await context.octokit.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open in:title ${pkgname}`,
      per_page: 100,
    });
    return data.items.map((item) => item.number);
  } catch (error) {
    app.log.error(`failed to search pull requests for ${pkgname}: ${error}`);
    return [];
  }
}

export async function collectIssueDetails(
  context: Context<"issues.opened">,
  app: Probot,
  pkgname: string,
  rawPkgName: string,
  arch: string | undefined,
  relver: string,
): Promise<string[]> {
  const { owner, repo: githubRepo } = context.repo();
  const repo = madoguchiRepoFromRelease(githubRepo, relver);
  const actionsRunUrl =
    `https://github.com/${owner}/${githubRepo}/actions/runs`;
  const [pkg, builds] = await Promise.all([
    getPkgInfo(repo, pkgname),
    getBuilds(repo, pkgname),
  ]);

  if (!pkg && builds.length === 0) return [];

  const latest = latestBuild(builds);
  const successfulBuilds = builds.filter((build) => build.succ);
  const archBuilds = arch
    ? successfulBuilds.filter((build) => build.parch === arch)
    : [];
  const latestSuccessful = latestBuild(
    archBuilds.length > 0 ? archBuilds : successfulBuilds,
  );
  const version = pkg
    ? formatNevra({ ...pkg, arch: arch ?? pkg.arch })
    : latestSuccessful
    ? formatNevra({
      name: latestSuccessful.pname,
      ver: latestSuccessful.pver,
      rel: latestSuccessful.prel,
      arch: latestSuccessful.parch,
    })
    : null;

  const lines = [
    `- Package name: \`${rawPkgName}\``,
    `- Latest version: ${version ? `\`${version}\`` : "unknown"}`,
  ];

  const commit = await getLastCommit(context, app, relver, pkg?.dirs, builds);
  if (commit) {
    lines.push(
      `- Last commit: \`${commit.sha.slice(0, 7)}\` by ${commit.author}:`,
      `  > ${commit.message}`,
    );
  }

  lines.push(
    `- last build: ${
      latest
        ? `[${latest.id}](${actionsRunUrl}/${latest.id}) (${
          latest.succ ? "passed" : "failing"
        })`
        : "none found"
    }`,
    `- packager: ${await getPackagerMention(context, app, repo, pkgname)}`,
    "- open PRs:",
  );

  const pullRequests = await getOpenPullRequests(context, app, pkgname);
  if (pullRequests.length === 0) lines.push("  - none");
  else for (const number of pullRequests) lines.push(`  - #${number}`);

  return lines;
}

export async function handleIssueDetails(
  context: Context<"issues.opened">,
  app: Probot,
): Promise<void> {
  const body = context.payload.issue.body ?? "";
  const match = mdFullPkgNameRegex.exec(body);
  const pkgname = match?.at(2);
  const rawPkgName = match ? `${match[2]}-${match[3]}-${match[4]}` : undefined;
  const relver = mdRelverRegex.exec(body)?.at(1);

  const dot = rawPkgName?.lastIndexOf(".") ?? -1;
  const arch = dot === -1 ? undefined : rawPkgName?.slice(dot + 1);

  let details: string[] = [];
  if (pkgname && rawPkgName && relver) {
    try {
      details = await collectIssueDetails(
        context,
        app,
        pkgname,
        rawPkgName,
        arch,
        relver,
      );
    } catch (error) {
      app.log.error(
        `failed to collect details for issue #${context.payload.issue.number}: ${error}`,
      );
    }
  }

  const comment = details.length === 0
    ? ISSUE_DETAILS_THANKS
    : `${ISSUE_DETAILS_THANKS}\n\n${details.join("\n")}`;

  try {
    await context.octokit.issues.createComment(
      context.issue({ body: comment }),
    );
  } catch (error) {
    app.log.error(
      `failed to comment on issue #${context.payload.issue.number}: ${error}`,
    );
  }
}
