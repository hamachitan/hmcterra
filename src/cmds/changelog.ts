// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Command } from "../command.ts";

const changelogRegex = /^%changelog\s*$/;

export default class ChangelogCommand implements Command<{}> {
  flags = {
    "print": ["p"],
  };

  makeChangelogDateOnly(): string {
    const now = new Date(Date.now());
    const weekday = now.getUTCDay(), mo = now.toLocaleDateString(undefined, { month: "short" }), day = String(now.getUTCDay()).padStart(2, '0'), yr = now.getUTCFullYear();
    return `* ${weekday} ${mo} ${day} ${yr}`;
  }

  async makeChangelog(ctx: Context<'issue_comment.created'>, pkger: string, msg: string): string {
    return `${this.makeChangelogDateOnly()} ${pkger} - ${pver}-${prel}\n- ${msg}`;
  }

  addChangelog(ctx: Context<'issue_comment.created'>, file: string, msg: string, pkger: string): string {
    const changelog = this.makeChangelog(ctx, pkger, msg);
    if (!changelogRegex.test(file)) {
      return file.trimEnd() + changelog;
    }
    return file.replace(changelogRegex, `%changelog\n${changelog}`);
  }

  async exec(ctx: Context<'issue_comment.created'>, app: Probot, args: string[], flags: { print: null[] }): Promise<string> {
    const pkger = 
    if (flags.print.length) {
      return "```rpmspec\n" + `${this.makeChangelogDateOnly()} ${pkger}\n- ${msg}` + "\n```";
    }
    const p = await ctx.octokit.pulls.get(ctx.pullRequest());
    const { data: files } = await ctx.octokit.pulls.listFiles(ctx.pullRequest());
    const specFiles = files.filter(file => file.filename.endsWith('.spec') && file.status !== 'removed');

    const msgs = await Promise.all(specFiles.map(file => async () => {
      try {
        const { data: fileContent } = await ctx.octokit.repos.getContent(ctx.repo({
          path: file.filename,
          ref: p.data.head.sha,
        }));

        if (!('content' in fileContent)) {
          app.log.warn(`Could not get content for ${file.filename}`);
          return null;
        }

        const specContent = Buffer.from(fileContent.content, 'base64').toString('utf8');
        return { file, specContent };
      } catch (error) {
        app.log.error(`Error fetching content for ${file.filename}: ${error}`);
        return null;
      }
    }));
    return msgs.join('\n');
  }
}
