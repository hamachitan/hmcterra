// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Command } from "../command.ts";
import { runRpmspec } from "../utils/rpm.ts";
import {
  createCommitAndUpdatePR,
  getPullRequestDetails,
  getSpecFiles,
  processSpecFiles,
} from "../utils/pr.ts";

const changelogRegex = /^%changelog\s*$/m;

export default class ChangelogCommand implements Command<{ print: string[] }> {
  flags = {
    print: ["p"],
  };

  makeChangelogDateOnly(): string {
    const now = new Date(Date.now());
    const weekday = now.toLocaleDateString(undefined, { weekday: "short" }),
      mo = now.toLocaleDateString(undefined, { month: "short" }),
      day = String(now.getUTCDate()).padStart(2, "0"),
      yr = now.getUTCFullYear();
    return `* ${weekday} ${mo} ${day} ${yr}`;
  }

  makeChangelog(pkger: string, msg: string, verrel: string): string {
    return `${this.makeChangelogDateOnly()} ${pkger} - ${verrel}\n- ${msg}`;
  }

  addChangelog(
    file: string,
    msg: string,
    pkger: string,
    verrel: string,
  ): string {
    const changelog = this.makeChangelog(pkger, msg, verrel);
    if (!changelogRegex.test(file)) {
      return file.trimEnd() + `\n\n%changelog\n${changelog}\n`;
    }
    return file.trimEnd().replace(changelogRegex, `%changelog\n${changelog}\n`);
  }

  async getPackager(ctx: Context<"issue_comment.created">): Promise<string> {
    const email = ctx.payload.sender.email ??
      (await ctx.octokit.users.getByUsername({
        username: ctx.payload.sender.login,
      })).data.email ?? "your.github.mail@is.private";
    return `${ctx.payload.sender.name ?? ctx.payload.sender.login} <${email}>`;
  }

  async exec(
    ctx: Context<"issue_comment.created">,
    _: Probot,
    args: string[],
    flags: { print: (string | null)[] },
  ): Promise<string> {
    const msg = args.join(" ");
    if (flags.print?.length) {
      return "```rpmspec\n" +
        `${this.makeChangelogDateOnly()} ${await this.getPackager(
          ctx,
        )}\n- ${msg}` + "\n```";
    }

    const { pr, headSha } = await getPullRequestDetails(ctx);
    const specFiles = await getSpecFiles(ctx);
    if (specFiles.length === 0) {
      return "🛑 No `.spec` files found in this pull request.";
    }

    const packager = await this.getPackager(ctx);

    const { errors, blobs } = await processSpecFiles(
      ctx,
      headSha,
      specFiles,
      async (content: string, _: string) => {
        const verrel =
          (await runRpmspec(content, "%{version}-%{release}\n")).split(
            "\n",
          )[0];
        const updatedContent = this.addChangelog(
          content,
          msg,
          packager,
          verrel,
        );
        return { content: updatedContent };
      },
    );

    if (blobs.length !== 0) {
      await createCommitAndUpdatePR(
        ctx,
        headSha,
        pr.data.head.ref,
        blobs,
        "chore: add changelogs",
      );
    }

    return errors.join("\n");
  }
}
