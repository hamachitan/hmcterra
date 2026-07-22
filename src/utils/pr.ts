// vim: ts=2 sw=2
import { Context } from "probot";
import { Buffer } from "node:buffer";
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

export async function getPullRequestDetails(
  ctx: Context<"issue_comment.created">,
) {
  const pr = await ctx.octokit.pulls.get(ctx.pullRequest());
  const headSha = pr.data.head.sha;
  return { pr, headSha };
}

/**
 * List .spec files in the PR that are not deleted.
 */
export async function getSpecFiles(
  ctx: Context<"issue_comment.created">,
) {
  const { data: files } = await ctx.octokit.pulls.listFiles(ctx.pullRequest());
  return files.filter(
    (file) => file.filename.endsWith(".spec") && file.status !== "removed",
  );
}

export async function processSpecFiles(
  ctx: Context<"issue_comment.created">,
  headSha: string,
  specs: RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"],
  processor: (
    content: string,
    path: string,
  ) => Promise<{ content?: string; error?: string }>,
) {
  const errors: string[] = [];
  const blobs: Array<{ path: string; sha: string }> = [];

  for (const spec of specs) {
    try {
      const { data: fileContent } = await ctx.octokit.repos.getContent(
        ctx.repo({
          path: spec.filename,
          ref: headSha,
        }),
      );

      if (!("content" in fileContent)) {
        errors.push(`Could not get content for ${spec.filename}`);
        continue;
      }

      const specContent = Buffer.from(fileContent.content, "base64").toString(
        "utf8",
      );
      const result = await processor(specContent, spec.filename);

      if (result.error) {
        errors.push(result.error);
        continue;
      }

      if (!result.content) {
        errors.push(`Processor returned no content for ${spec.filename}`);
        continue;
      }

      const { data: blob } = await ctx.octokit.git.createBlob(
        ctx.repo({ content: result.content }),
      );
      blobs.push({ path: spec.filename, sha: blob.sha });
    } catch (error) {
      errors.push(`Error processing ${spec.filename}: ${error}`);
    }
  }

  return { errors, blobs };
}

/**
 * Create a new commit with the updated blobs and update the PR branch.
 */
export async function createCommitAndUpdatePR(
  ctx: Context<"issue_comment.created">,
  headSha: string,
  ref: string,
  blobs: Array<{ path: string; sha: string }>,
  commitMessage: string,
) {
  const { data: headCommit } = await ctx.octokit.git.getCommit(
    ctx.repo({ commit_sha: headSha }),
  );

  const { data: newTree } = await ctx.octokit.git.createTree(
    ctx.repo({
      tree: blobs.map(({ path, sha }) => ({
        path,
        mode: "100644",
        type: "blob",
        sha,
      })),
      base_tree: headCommit.tree.sha,
    }),
  );

  const { data: newCommit } = await ctx.octokit.git.createCommit(
    ctx.repo({
      message: commitMessage,
      tree: newTree.sha,
      parents: [headSha],
    }),
  );

  await ctx.octokit.git.updateRef(
    ctx.repo({
      ref: `heads/${ref}`,
      sha: newCommit.sha,
      force: false,
    }),
  );
}
