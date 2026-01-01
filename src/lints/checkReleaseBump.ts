import { gitBranch2SatmBranch } from "../utils/terrautil.js";
import { LintParams } from "../linting.js";
import { runRpmspec } from "../utils/rpm.js";
import { CheckResult } from "../linting.js";
import { MADOGUCHI_BASE_URL } from "../consts.js";

const specReleaseRegex = /^Release:(\s*)([0-9]+)(.*)$/m;

async function getPackageInfo(specContent: string): Promise<{ name: string, version: string, release: string } | null> {
  try {
    const output = await runRpmspec(specContent, '%{name} %{version} %{release}\n');
    const [name, version, release] = output.split('\n')[0].split(' ');
    return { name, version, release };
  } catch (_) {
    return null;
  }
}

export async function checkPackageExists(pkgName: string, version: string, release: string | number, satmBranch: string): Promise<boolean> {
  try {
    const response = await fetch(`${MADOGUCHI_BASE_URL}/v4/terra${satmBranch}/packages/${pkgName}`);
    if (!response.ok) return false;

    const pkg = await response.json();
    return pkg.ver === version && pkg.rel.startsWith(`${release}.`);
  } catch (_) {
    return false;
  }
}

export async function checkReleaseBump({ context, app, file, specContent }: LintParams): Promise<CheckResult> {
  const result: CheckResult = { messages: [], reviewComments: [] };
  const targetBranch = context.payload.pull_request.base.ref;
  const satmBranch = gitBranch2SatmBranch(targetBranch);

  const pkgInfo = await getPackageInfo(specContent);
  if (!pkgInfo) {
    app.log.error(`cannot parse package info with rpmspec for ${file.filename}`);
    return result;
  }

  if (!await checkPackageExists(pkgInfo.name, pkgInfo.version, pkgInfo.release, satmBranch)) return result;

  const releaseNumber = parseInt(pkgInfo.release, 10);
  const updatedSpecContent = specContent.replace(
    specReleaseRegex,
    (_match, whitespace, _currentNumber, suffix) => `Release:${whitespace}${releaseNumber + 1}${suffix}`
  );

  await context.octokit.repos.createOrUpdateFileContents(context.repo({
    path: file.filename,
    message: `bump(${pkgInfo.name}): release ${releaseNumber} → ${releaseNumber + 1}`,
    content: Buffer.from(updatedSpecContent).toString('base64'),
    sha: file.sha,
    branch: context.payload.pull_request.head.ref,
  }));

  app.log.info(`bumped release for ${file.filename} in PR #${context.payload.pull_request.number}`);

  return result;
}
