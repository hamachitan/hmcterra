// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import NosyncCommand from "./cmds/nosync.ts";
import ChangelogCommand from "./cmds/changelog.ts";
import BumpCommand from "./cmds/bump.ts";

export interface Command<Flags extends { [flag: string]: string[] }> {
  flags: Flags;
  exec(
    ctx: Context<"issue_comment.created">,
    bot: Probot,
    args: string[],
    flags: {
      [key in keyof Flags]: (string | null)[];
    },
  ): Promise<string>;
}

export const commands = {
  nosync: new NosyncCommand(),
  changelog: new ChangelogCommand(),
  bump: new BumpCommand(),
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
  cmdname!: keyof typeof commands; // アホですか！.wav（きりたん公式ボイス）
  args: string[] = [];
  flags: {
    [flag: string]: (string | null)[];
  } = {};
  errors: InvokeErr[] = [];

  constructor(invocation: string) {
    let i = 0, cmdname = "";
    do cmdname += invocation[i]; while (
      ++i < invocation.length && !invocation[i].match(/\s/)
    );
    // アホですね…….wav（きりたん公式ボイス）
    if (cmdname in commands) this.cmdname = cmdname as keyof typeof commands;
    else return;

    // assume no trailing spaces
    while (i < invocation.length) {
      let word = "";
      while (++i < invocation.length && invocation[i].match(/\s/));
      do word += invocation[i]; while (
        ++i < invocation.length && !invocation[i].match(/\s/)
      );
      if (word.startsWith("--")) this.parseLongFlag(word);
      else if (word.startsWith("-")) this.parseShortFlags(word);
      else this.args.push(word);
    }
  }

  parseLongFlag(word: string) {
    let flagname = "", flagarg = null, i = word.indexOf("=");
    if (i === -1) i = word.indexOf(":");
    if (i === -1) flagname = word.substring(2);
    else {
      flagname = word.substring(2, i);
      flagarg = word.substring(i + 1);
    }
    if (!(flagname in commands[this.cmdname].flags)) {
      this.errors.push(new UnknownFlagErr(flagname));
    } else if (this.flags[flagname] == null) this.flags[flagname] = [flagarg];
    else this.flags[flagname].push(flagarg);
  }

  parseShortFlags(word: string) {
    for (const ch of word.substring(1)) {
      const [flag, _] =
        Object.entries(commands[this.cmdname]?.flags ?? {}).find((
          [_, flags],
        ) => flags.includes(ch)) ?? [];
      if (!flag) this.errors.push(new UnknownShortFlagErr(ch));
      else if (this.flags[flag] == null) this.flags[flag] = [null];
      else this.flags[flag].push(null);
    }
  }

  async exec(
    ctx: Context<"issue_comment.created">,
    app: Probot,
  ): Promise<string> {
    if (!(this.cmdname in commands)) {
      return `🛑 \`${this.cmdname}\`: command not found`;
    }

    const cmd = commands[this.cmdname as keyof typeof commands];

    if (this.errors.length !== 0) {
      return this.errors.map((e) => `🛑 \`${this.cmdname}\`: ${e.display()}`)
        .join("\n\n");
    }
    // @ts-ignore 2345: cannot typecheck this.flags
    return await cmd.exec(ctx, app, this.args, this.flags);
  }
}

async function processCommands(
  cmds: string[],
  ctx: Context<"issue_comment.created">,
  app: Probot,
) {
  try {
    const msgs = await Promise.all([
      ctx.octokit.reactions.createForIssueComment(
        ctx.repo({ comment_id: ctx.payload.comment.id, content: "rocket" }),
      ),
      ...cmds.map((s) => new Invocation(s).exec(ctx, app)),
    ]);
    msgs.shift(); // reactions.createForIssueComment
    const body = msgs.filter((msg) => msg !== "").join("\n\n");
    if (body === "") return;
    await ctx.octokit.issues.createComment(ctx.issue({ body }));
  } catch (e) {
    if (e instanceof Error) {
      await ctx.octokit.issues.createComment(
        ctx.issue({ body: `🛑 Fatal: ${e}` + "\n```\n" + e.stack + "\n```" }),
      );
    } else {
      await ctx.octokit.issues.createComment(
        ctx.issue({ body: `🛑 Fatal: ${e}` }),
      );
    }
  }
}
export default processCommands;
