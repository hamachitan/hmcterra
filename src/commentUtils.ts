import { Context } from "probot";

export async function postPrCommentIfNeeded(context: Context, messages: string[]): Promise<void> {
  if (messages.length === 0) return;

  const body = messages.join('\n\n');
  await context.octokit.issues.createComment(context.issue({ body }));
}