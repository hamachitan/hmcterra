// vim: ts=2 sw=2
import { Context, Probot } from "probot";
import { Buffer } from "node:buffer";
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

type RepositoryContext = Pick<
  Context<"issue_comment.created">,
  "octokit" | "repo"
>;

/**
 * Git objects and refs belong to the head repository, not necessarily the
 * repository receiving the PR. Forks also require their own installation token.
 */
export async function getPullRequestRepository(
  ctx: Context<"issue_comment.created">,
  bot: Probot,
  head: RestEndpointMethodTypes["pulls"]["get"]["response"]["data"]["head"],
): Promise<{ target: RepositoryContext } | { error: string }> {
  if (!head.repo) {
    return { error: "🛑 The pull request's head repository no longer exists." };
  }

  const owner = head.repo.owner.login;
  const repo = head.repo.name;
  const base = ctx.repo();
  let octokit = ctx.octokit;
  if (owner !== base.owner || repo !== base.repo) {
    try {
      const appOctokit = await bot.auth();
      const { data: installation } = await appOctokit.apps.getRepoInstallation({
        owner,
        repo,
      });
      if (installation.permissions.contents !== "write") {
        return {
          error:
            `🛑 The bot needs Contents write permission on \`${owner}/${repo}\` to update this pull request.`,
        };
      }
      octokit = await bot.auth(installation.id);
    } catch (error) {
      if (
        typeof error === "object" && error !== null && "status" in error &&
        (error.status === 403 || error.status === 404)
      ) {
        return {
          error:
            `🛑 The bot cannot access the pull request's head repository \`${owner}/${repo}\`. Install the GitHub App there with Contents write permission, or update the branch manually. Allowing maintainer edits does not grant the bot access.`,
        };
      }
      throw error;
    }
  }

  const target: RepositoryContext = {
    octokit,
    repo: (overrides) => ({ ...ctx.repo(overrides), owner, repo }),
  };
  try {
    await octokit.git.getRef(target.repo({ ref: `heads/${head.ref}` }));
  } catch (error) {
    if (
      typeof error === "object" && error !== null && "status" in error &&
      error.status === 404
    ) {
      return {
        error:
          `🛑 The pull request branch \`${owner}/${repo}:${head.ref}\` no longer exists or is inaccessible to the bot.`,
      };
    }
    throw error;
  }
  return { target };
}

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
  ctx: RepositoryContext,
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
  ctx: RepositoryContext,
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
