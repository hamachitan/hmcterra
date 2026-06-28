// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Command } from "../command.js";
import { runRpmspec } from "../utils/rpm.js";
import { Buffer } from "node:buffer";

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
    // not the packager of the spec, but the person who invoked the command!
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
    const p = await ctx.octokit.pulls.get(ctx.pullRequest());
    const { data: files } = await ctx.octokit.pulls.listFiles(
      ctx.pullRequest(),
    );
    const specFiles = files.filter((file) =>
      file.filename.endsWith(".spec") && file.status !== "removed"
    );
    const { data: headCommit } = await ctx.octokit.git.getCommit(
      ctx.repo({ commit_sha: p.data.head.sha }),
    );

    const specs = await Promise.all(specFiles.map((file) =>
      (async () => {
        try {
          const { data: fileContent } = await ctx.octokit.repos.getContent(
            ctx.repo({
              path: file.filename,
              ref: p.data.head.sha,
            }),
          );

          if (!("content" in fileContent)) {
            return `Could not get content for ${file.filename}`;
          }

          const specContent = Buffer.from(fileContent.content, "base64")
            .toString("utf8");
          const verrel =
            (await runRpmspec(specContent, "%{version}-%{release}\n")).split(
              "\n",
            )[0];
          const content = this.addChangelog(
            specContent,
            msg,
            await this.getPackager(ctx),
            verrel,
          );
          const { data } = await ctx.octokit.git.createBlob(
            ctx.repo({ content }),
          );
          return { path: file.filename, ...data };
        } catch (error) {
          return `Error fetching content for ${file.filename}: ${error}`;
        }
      })()
    ));
    const errors = specs.filter((spec) => typeof spec === "string").join("\n");
    const blobs = specs.filter((spec) => typeof spec !== "string");
    const { data } = await ctx.octokit.git.createTree(ctx.repo({
      tree: blobs.map(({ sha, path }) => ({
        path,
        mode: `100644`,
        type: `blob`,
        sha,
      })),
      base_tree: headCommit.tree.sha,
    }));
    const { data: commit } = await ctx.octokit.git.createCommit(ctx.repo({
      message: "chore: add changelogs",
      tree: data.sha,
      parents: [p.data.head.sha],
    }));
    await ctx.octokit.git.updateRef(ctx.repo({
      ref: `heads/${p.data.head.ref}`,
      sha: commit.sha,
      force: false,
    }));

    return errors;
  }
}
