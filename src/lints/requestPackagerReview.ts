import { runRpmspec } from "../utils/rpm.js";
import { CheckResult, LintParams } from "../linting.js";
import { getGithubUsernameFromEmail } from "../utils/github.js";

const packagerEmailRegex = /^(.+)<(.+)>$/;

export async function requestPackagerReview({ context, app, file, specContent }: LintParams): Promise<CheckResult> {
  try {
    const packager = await runRpmspec(specContent, '%{packager}');
    if (packager === '(none)') return { messages: [], reviewComments: [] };

    const match = packagerEmailRegex.exec(packager);
    const email = match?.[2];
    if (!email) return { messages: [], reviewComments: [] };

    const githubUsername = await getGithubUsernameFromEmail(context.octokit, email);
    if (!githubUsername) return { messages: [], reviewComments: [] };

    await context.octokit.pulls.requestReviewers(context.pullRequest({ reviewers: [githubUsername] }));
  } catch (error) {
    app.log.error(`error requesting packager review for ${file.filename}: ${error}`);
  }

  return { messages: [], reviewComments: [] };
}
