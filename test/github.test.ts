import { test, expect, vi } from "vitest";
import { getGithubUsernameFromEmail, fetchSpecContent, createPullRequestReview } from "../src/utils/github.js";

test("getGithubUsernameFromEmail returns username from user search", async () => {
  const mockOctokit = {
    search: {
      users: vi.fn().mockResolvedValue({
        data: { items: [{ login: "testuser" }] }
      })
    }
  } as any;

  const result = await getGithubUsernameFromEmail(mockOctokit, "test@example.com");
  expect(result).toBe("testuser");
  expect(mockOctokit.search.users).toHaveBeenCalledWith({ q: "test@example.com in:email" });
});

test("getGithubUsernameFromEmail falls back to commit search", async () => {
  const mockOctokit = {
    search: {
      users: vi.fn().mockResolvedValue({ data: { items: [] } }),
      commits: vi.fn().mockResolvedValue({
        data: { items: [{ author: { login: "commituser" } }] }
      })
    }
  } as any;

  const result = await getGithubUsernameFromEmail(mockOctokit, "test@example.com");
  expect(result).toBe("commituser");
});

test("getGithubUsernameFromEmail throws on no results", async () => {
  const mockOctokit = {
    search: {
      users: vi.fn().mockResolvedValue({ data: { items: [] } }),
      commits: vi.fn().mockResolvedValue({ data: { items: [] } })
    }
  } as any;

  await expect(getGithubUsernameFromEmail(mockOctokit, "test@example.com")).rejects.toThrow();
});

test("fetchSpecContent returns decoded content", async () => {
  const mockOctokit = {
    repos: {
      getContent: vi.fn().mockResolvedValue({
        data: { content: Buffer.from("test content").toString('base64') }
      })
    }
  } as any;

  const result = await fetchSpecContent(mockOctokit, "owner", "repo", "path", "ref");
  expect(result).toBe("test content");
  expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
    owner: "owner",
    repo: "repo",
    path: "path",
    ref: "ref"
  });
});

test("fetchSpecContent returns null for non-file content", async () => {
  const mockOctokit = {
    repos: {
      getContent: vi.fn().mockResolvedValue({
        data: { type: "dir" } // no content field
      })
    }
  } as any;

  const result = await fetchSpecContent(mockOctokit, "owner", "repo", "path", "ref");
  expect(result).toBeNull();
});

test("fetchSpecContent throws on error", async () => {
  const mockOctokit = {
    repos: {
      getContent: vi.fn().mockRejectedValue(new Error("API error"))
    }
  } as any;

  await expect(fetchSpecContent(mockOctokit, "owner", "repo", "path", "ref")).rejects.toThrow("Error fetching content for path: Error: API error");
});

test("createPullRequestReview calls octokit.pulls.createReview", async () => {
  const mockOctokit = {
    pulls: {
      createReview: vi.fn().mockResolvedValue({})
    }
  } as any;

  const pullRequest = { owner: "owner", repo: "repo", pull_number: 1 };
  await createPullRequestReview(mockOctokit, pullRequest, "COMMENT", "body", []);

  expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
    ...pullRequest,
    event: "COMMENT",
    body: "body",
    comments: []
  });
});