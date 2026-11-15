// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Command } from "../command.ts";
import {
  createCommitAndUpdatePR,
  getPullRequestDetails,
  getPullRequestRepository,
  getSpecFiles,
  processSpecFiles,
} from "../utils/pr.ts";

const releaseRegex = /^Release:(\s*)(\d+)(%\?dist|%\{\?dist\})/m;

export default class BumpCommand
  implements Command<Record<PropertyKey, never>> {
  flags = {};
  description =
    "Increment the `Release:` field in the spec files in the current pull request.";
  usage = "bump";

  async exec(
    ctx: Context<"issue_comment.created">,
    bot: Probot,
    _args: string[],
  ): Promise<string> {
    const { pr, headSha } = await getPullRequestDetails(ctx);
    const specFiles = await getSpecFiles(ctx);

    if (specFiles.length === 0) {
      return "🛑 No `.spec` files found in this pull request.";
    }

    const repository = await getPullRequestRepository(ctx, bot, pr.data.head);
    if ("error" in repository) return repository.error;

    const { errors, blobs } = await processSpecFiles(
      repository.target,
      headSha,
      specFiles,
      // deno-lint-ignore require-await
      async (content: string, filePath: string) => {
        const match = releaseRegex.exec(content);
        if (!match) {
          return { error: `No \`Release:\` found in ${filePath}` };
        }

        const [, whitespace, numberStr, suffix] = match;
        const newNumber = parseInt(numberStr, 10) + 1; // not NaN unless the regex is broken
        const newRelease = `Release:${whitespace}${newNumber}${suffix}`;

        const updatedContent = content.replace(releaseRegex, newRelease);
        return { content: updatedContent };
      },
    );

    if (blobs.length !== 0) {
      await createCommitAndUpdatePR(
        repository.target,
        headSha,
        pr.data.head.ref,
        blobs,
        "chore: bump release",
      );
    }

    return errors.join("\n");
  }
}
