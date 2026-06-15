// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Command } from "../command.ts";

export default class NosyncCommand implements Command<{}> {
  flags = {};

  async exec(ctx: Context<'issue_comment.created'>, _bot: Probot, args: string[]): Promise<string> {
    const { data: labels } = await ctx.octokit.issues.listLabelsOnIssue(ctx.issue());

    if (args.length === 0) {
      const syncLabels = labels.filter(lbl => lbl.name.startsWith('sync-'));
      for (const label of syncLabels) {
        await ctx.octokit.issues.removeLabel(ctx.issue({ name: label.name }));
      }
    } else {
      for (const arg of args) {
        const labelName = `sync-${arg}`;
        if (labels.some(lbl => lbl.name === labelName)) {
          await ctx.octokit.issues.removeLabel(ctx.issue({ name: labelName }));
        }
      }
    }

    return '';
  }
}
