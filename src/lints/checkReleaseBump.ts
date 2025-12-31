import { gitBranch2SatmBranch } from "../terrautil.js";
import { runRpmspec } from "../utils.js";

const specReleaseRegex = /^Release:(\s*)([0-9]+)(.*)$/m;

async function getPackageInfo(specContent: string): Promise<{ name: string, version: string, release: string } | null> {
  try {
    const output = await runRpmspec(specContent, '%{name} %{version} %{release}');
    const [name, version, release] = output.split(' ');
    return { name, version, release };
  } catch (error) {
    return null;
  }
}

async function checkPackageExists(pkgName: string, version: string, release: string | number, satmBranch: string): Promise<boolean> {
  try {
    const response = await fetch(`https://madoguchi.fyralabs.com/v4/terra${satmBranch}/packages/${pkgName}`);
    if (!response.ok) return false;

    const pkg = await response.json();
    return pkg.ver === version && pkg.rel.startsWith(`${release}.`);
  } catch (error) {
    return false;
  }
}

export async function checkReleaseBump(context: any, app: any, file: any, specContent: string): Promise<void> {
  const targetBranch = context.payload.pull_request.base.ref;

  if (!/^frawhide|el\d+|f\d+$/.test(targetBranch)) {
    return;
  }

  const satmBranch = gitBranch2SatmBranch(targetBranch);

  const pkgInfo = await getPackageInfo(specContent);
  if (!pkgInfo) {
    app.log.warn(`cannot parse package info with rpmspec for ${file.filename}`);
    return;
  }

  const releaseNumber = parseInt(pkgInfo.release, 10);

  if (!await checkPackageExists(pkgInfo.name, pkgInfo.version, releaseNumber, satmBranch)) return;

  const updatedSpecContent = specContent.replace(
    specReleaseRegex,
    (_match, whitespace, _currentNumber, suffix) => `Release:${whitespace}${releaseNumber + 1}${suffix}`
  );

  await context.octokit.repos.createOrUpdateFileContents({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    path: file.filename,
    message: `bump(${pkgInfo.name}): release ${releaseNumber} → ${releaseNumber + 1}`,
    content: Buffer.from(updatedSpecContent).toString('base64'),
    sha: file.sha,
    branch: context.payload.pull_request.head.ref,
  });

  app.log.info(`Bumped release for ${file.filename} in PR #${context.payload.pull_request.number}`);
}
