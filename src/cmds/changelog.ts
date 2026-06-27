// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Command } from "../command.ts";
import { runRpmspec } from "../utils/rpm.ts";

const changelogRegex = /^%changelog\s*$/;

export default class ChangelogCommand implements Command<{ print: string[] }> {
  flags = {
    print: ["p"],
  };

  makeChangelogDateOnly(): string {
    const now = new Date(Date.now());
    const weekday = now.getUTCDay(), mo = now.toLocaleDateString(undefined, { month: "short" }), day = String(now.getUTCDay()).padStart(2, '0'), yr = now.getUTCFullYear();
    return `* ${weekday} ${mo} ${day} ${yr}`;
  }

  makeChangelog(pkger: string, msg: string, verrel: string): string {
    return `${this.makeChangelogDateOnly()} ${pkger} - ${verrel}\n- ${msg}`;
  }

  addChangelog(file: string, msg: string, pkger: string, verrel: string): string {
    const changelog = this.makeChangelog(pkger, msg, verrel);
    if (!changelogRegex.test(file)) {
      return file.trimEnd() + changelog;
    }
    return file.replace(changelogRegex, `%changelog\n${changelog}`);
  }

  getPackager(ctx: Context<'issue_comment.created'>): string {
    // not the packager of the spec, but the person who invoked the command!
    return `${ctx.payload.sender.name} <${ctx.payload.sender.email ?? 'your.github.mail@is.private'}>`;
  }

  async exec(ctx: Context<'issue_comment.created'>, _: Probot, args: string[], flags: { print: (string | null)[] }): Promise<string> {
    const msg = args.join(' ');
    if (flags.print.length) {
      return "```rpmspec\n" + `${this.makeChangelogDateOnly()} ${this.getPackager(ctx)}\n- ${msg}` + "\n```";
    }
    const p = await ctx.octokit.pulls.get(ctx.pullRequest());
    const { data: files } = await ctx.octokit.pulls.listFiles(ctx.pullRequest());
    const specFiles = files.filter(file => file.filename.endsWith('.spec') && file.status !== 'removed');
    const { data: headCommit } = await ctx.octokit.git.getCommit(ctx.repo({ commit_sha: p.data.head.sha }));

    const specs = await Promise.all(specFiles.map(file => (async () => {
      try {
        const { data: fileContent } = await ctx.octokit.repos.getContent(ctx.repo({
          path: file.filename,
          ref: p.data.head.sha,
        }));

        if (!('content' in fileContent))
          return `Could not get content for ${file.filename}`;

        const specContent = Buffer.from(fileContent.content, 'base64').toString('utf8');
        const verrel = (await runRpmspec(specContent, '%{version}-%{release}\n')).split('\n')[0];
        const content = this.addChangelog(specContent, msg, this.getPackager(ctx), verrel);
        const { data } = await ctx.octokit.git.createBlob(ctx.repo({ content }));
        return { path: file.filename, ...data };
      } catch (error) {
        return `Error fetching content for ${file.filename}: ${error}`;
      }
    })()));
    const errors = specs.filter(spec => typeof spec === 'string').join('\n');
    const blobs = specs.filter(spec => typeof spec !== 'string')
    const { data } = await ctx.octokit.git.createTree(ctx.repo({
      tree: blobs.map(({ sha, path }) => ({
        path,
        mode: `100644`,
        type: `blob`,
        sha,
      })),
      base_tree: headCommit.tree.sha,
    }));
    await ctx.octokit.git.createCommit(ctx.repo({
      message: "chore: add changelogs",
      tree: data.sha,
      parents: [p.data.head.sha],
    }));

    return errors;
  }
}
