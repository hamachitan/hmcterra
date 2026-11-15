import { beforeEach, describe, expect, test, vi } from "vitest";
import BumpCommand from "../src/cmds/bump.ts";
import ChangelogCommand from "../src/cmds/changelog.ts";
import { getPullRequestRepository } from "../src/utils/pr.ts";

vi.mock("../src/utils/rpm.ts", () => ({
  runRpmspec: vi.fn().mockResolvedValue("1.0-1"),
}));

function mockGit() {
  return {
    getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "head" } } }),
    createBlob: vi.fn().mockResolvedValue({ data: { sha: "blob" } }),
    getCommit: vi.fn().mockResolvedValue({
      data: { tree: { sha: "head-tree" } },
    }),
    createTree: vi.fn().mockResolvedValue({ data: { sha: "new-tree" } }),
    createCommit: vi.fn().mockResolvedValue({ data: { sha: "new-commit" } }),
    updateRef: vi.fn().mockResolvedValue({}),
  };
}

describe("PR commands target the head repository", () => {
  let ctx: any;
  let bot: any;
  let head: any;
  let forkOctokit: any;
  let appOctokit: any;

  beforeEach(() => {
    head = {
      sha: "head",
      ref: "mizuki/chore/nerd-fonts-automate-fetch",
      repo: { owner: { login: "MagicalDrizzle" }, name: "packages" },
    };
    const repos = () => ({
      getContent: vi.fn().mockResolvedValue({
        data: {
          content: Buffer.from("Release: 1%{?dist}\n").toString("base64"),
        },
      }),
    });
    ctx = {
      repo: (overrides: any) => ({
        owner: "terrapkg",
        repo: "packages",
        ...overrides,
      }),
      pullRequest: () => ({
        owner: "terrapkg",
        repo: "packages",
        pull_number: 20197,
      }),
      payload: { sender: { login: "maintainer", email: "m@example.com" } },
      octokit: {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { head } }),
          listFiles: vi.fn().mockResolvedValue({
            data: [{ filename: "nerd-fonts.spec", status: "modified" }],
          }),
        },
        repos: repos(),
        git: mockGit(),
      },
    };
    forkOctokit = { repos: repos(), git: mockGit() };
    appOctokit = {
      apps: {
        getRepoInstallation: vi.fn().mockResolvedValue({
          data: { id: 42, permissions: { contents: "write" } },
        }),
      },
    };
    bot = {
      auth: vi.fn().mockImplementation(async (id?: number) =>
        id === undefined ? appOctokit : forkOctokit
      ),
    };
  });

  async function bump() {
    return await new BumpCommand().exec(ctx, bot, []);
  }

  test.each(["bump", "changelog"])(
    "%s uses the fork installation for all content and Git operations",
    async (command) => {
      const result = command === "bump"
        ? await bump()
        : await new ChangelogCommand().exec(ctx, bot, ["Update"], {
          print: [],
        });
      expect(result).toBe("");
      expect(bot.auth.mock.calls).toEqual([[], [42]]);
      expect(appOctokit.apps.getRepoInstallation).toHaveBeenCalledWith({
        owner: "MagicalDrizzle",
        repo: "packages",
      });
      expect(ctx.octokit.pulls.listFiles).toHaveBeenCalledWith(
        ctx.pullRequest(),
      );
      expect(ctx.octokit.repos.getContent).not.toHaveBeenCalled();
      for (const method of Object.keys(ctx.octokit.git)) {
        expect(ctx.octokit.git[method]).not.toHaveBeenCalled();
        expect(forkOctokit.git[method]).toHaveBeenCalledWith(
          expect.objectContaining({
            owner: "MagicalDrizzle",
            repo: "packages",
          }),
        );
      }
      expect(forkOctokit.repos.getContent).toHaveBeenCalledWith({
        owner: "MagicalDrizzle",
        repo: "packages",
        path: "nerd-fonts.spec",
        ref: "head",
      });
      expect(forkOctokit.git.createCommit).toHaveBeenCalledWith(
        expect.objectContaining({ parents: ["head"], tree: "new-tree" }),
      );
      expect(forkOctokit.git.updateRef).toHaveBeenCalledWith({
        owner: "MagicalDrizzle",
        repo: "packages",
        ref: `heads/${head.ref}`,
        sha: "new-commit",
        force: false,
      });
      if (command === "bump") {
        expect(forkOctokit.git.createBlob).toHaveBeenCalledWith(
          expect.objectContaining({ content: "Release: 2%{?dist}\n" }),
        );
      }
    },
  );

  test("same-repository PRs retain the webhook installation", async () => {
    head.repo.owner.login = "terrapkg";
    expect(await bump()).toBe("");
    expect(bot.auth).not.toHaveBeenCalled();
    expect(ctx.octokit.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "terrapkg", force: false }),
    );
  });

  test.each([403, 404])(
    "inaccessible fork (%s) returns instructions without writes",
    async (status) => {
      appOctokit.apps.getRepoInstallation.mockRejectedValue({ status });
      expect(await bump()).toContain("Install the GitHub App there");
      expect(ctx.octokit.git.createBlob).not.toHaveBeenCalled();
      expect(forkOctokit.git.createBlob).not.toHaveBeenCalled();
    },
  );

  test("read-only fork installation is rejected before writes", async () => {
    appOctokit.apps.getRepoInstallation.mockResolvedValue({
      data: { id: 42, permissions: { contents: "read" } },
    });
    expect(await bump()).toContain("Contents write permission");
    expect(forkOctokit.git.createBlob).not.toHaveBeenCalled();
  });

  test("deleted head repository is rejected before writes", async () => {
    head.repo = null;
    expect(await bump()).toContain("head repository no longer exists");
    expect(bot.auth).not.toHaveBeenCalled();
    expect(ctx.octokit.git.createBlob).not.toHaveBeenCalled();
  });

  test("deleted branch is rejected without recreating it", async () => {
    forkOctokit.git.getRef.mockRejectedValue({ status: 404 });
    expect(await bump()).toContain("no longer exists or is inaccessible");
    expect(forkOctokit.git.createBlob).not.toHaveBeenCalled();
    expect(forkOctokit.git.updateRef).not.toHaveBeenCalled();
  });

  test("unexpected installation failures are not hidden", async () => {
    const error = Object.assign(new Error("GitHub unavailable"), {
      status: 500,
    });
    appOctokit.apps.getRepoInstallation.mockRejectedValue(error);
    await expect(bump()).rejects.toBe(error);
  });

  test("non-fast-forward updates remain errors and never force-push", async () => {
    forkOctokit.git.updateRef.mockRejectedValue({ status: 422 });
    await expect(bump()).rejects.toEqual({ status: 422 });
    expect(forkOctokit.git.updateRef).toHaveBeenCalledTimes(1);
    expect(forkOctokit.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ force: false }),
    );
  });

  test("repository target cannot be redirected by overrides", async () => {
    const result = await getPullRequestRepository(ctx, bot, head);
    expect(
      "target" in result && result.target.repo({
        owner: "terrapkg",
        repo: "other",
        path: "test.spec",
      }),
    ).toEqual({
      owner: "MagicalDrizzle",
      repo: "packages",
      path: "test.spec",
    });
  });
});
