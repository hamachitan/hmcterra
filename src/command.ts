// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import NosyncCommand from "./cmds/nosync.ts";
import ChangelogCommand from "./cmds/changelog.ts";

export interface Command<Flags extends { [flag: string]: string[] }> {
  flags: Flags;
  exec: (ctx: Context<'issue_comment.created'>, bot: Probot, args: string[], flags: {
    [key in keyof Flags]: (string | null)[]
  }) => Promise<string>;
}

export const commands: { [cmdname: string]: Command<any> } = {
  nosync: new NosyncCommand(),
  changelog: new ChangelogCommand(),
};

export interface InvokeErr {
  display: () => string;
}

export class UnknownFlagErr implements InvokeErr {
  f: string;
  constructor(shortflag: string) {
    this.f = shortflag;
  }
  display = () => `unknown flag \`--${this.f}\``;
}

export class UnknownShortFlagErr implements InvokeErr {
  f: string;
  constructor(shortflag: string) {
    this.f = shortflag;
  }
  display = () => `unknown short flag \`-${this.f}\``;
}

export class Invocation {
  cmdname: string = '';
  args: string[] = [];
  flags: {
    [flag: string]: (string | null)[]
  } = {};
  errors: InvokeErr[] = [];

  constructor(invocation: string) {
    let i = 0;
    do this.cmdname += invocation[i];
    while (++i < invocation.length && !invocation[i].match(/\s/));

    // assume no trailing spaces
    while (i < invocation.length) {
      let word = "";
      while (++i < invocation.length && invocation[i].match(/\s/));
      do
        word += invocation[i];
      while (++i < invocation.length && !invocation[i].match(/\s/));
      if (word.startsWith('--')) {
        let flagname = '';
        let flagarg = null;
        const i = word.indexOf('=');
        if (i !== -1) { flagname = word.substring(2, i); flagarg = word.substring(i + 1); };
        const j = word.indexOf(':');
        if (i !== -1) { flagname = word.substring(2, j); flagarg = word.substring(j + 1); }
        if (flagname === '') flagname = word.substring(2);
        if (this.flags[flagname] == null) this.flags[flagname] = [];
        this.flags[flagname].push(flagarg);
      } else if (word.startsWith('-')) {
        for (const ch of word.substring(1)) {
          let done = false;
          for (const [flag, aliases] of commands[this.cmdname]?.flags ?? {}) {
            if (aliases.includes(ch)) {
              if (this.flags[flag] == null) this.flags[flag] = [];
              this.flags[flag].push(null);
              done = true;
              break;
            }
          }
          if (!done) this.errors.push(new UnknownShortFlagErr(ch));
        }
      } else {
        this.args.push(word);
      }
    }
  }

  async exec(ctx: Context<'issue_comment.created'>, app: Probot): Promise<string> {
    const cmd = commands[this.cmdname];
    if (cmd === null) {
      return `🛑 \`${this.cmdname}\`: command not found`;
    }
    this.errors.push(...Object.keys(this.flags).filter(f => !Object.keys(cmd.flags).includes(f)).map(f => new UnknownFlagErr(f)));

    if (this.errors.length !== 0) return this.errors.map(e => `🛑 \`${this.cmdname}\`: ${e.display()}`).join('\n\n');
    return await cmd.exec(ctx, app, this.args, this.flags);
  }
}

async function processCommands(cmds: string[], ctx: Context<'issue_comment.created'>, app: Probot) {
  try {
    const msgs = await Promise.all([
      ctx.octokit.reactions.createForIssueComment(ctx.repo({ comment_id: ctx.payload.comment.id, content: "rocket" })),
      ...cmds.map(s => new Invocation(s).exec(ctx, app))
    ]);
    msgs.shift(); // reactions.createForIssueComment
    const body = msgs.filter(msg => msg !== '').join("\n\n");
    if (body === '') return;
    await ctx.octokit.issues.createComment(ctx.issue({ body }));
  } catch (e) {
    if (e instanceof Error)
      await ctx.octokit.issues.createComment(ctx.issue({ body: `🛑 Fatal: ${e}` + "\n```\n" + e.stack + '\n```' }));
    else
      await ctx.octokit.issues.createComment(ctx.issue({ body: `🛑 Fatal: ${e}` }));
  }
}
export default processCommands;
