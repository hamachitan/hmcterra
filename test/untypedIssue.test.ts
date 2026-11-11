import { expect, test, vi } from "vitest";
import { handleUntypedIssue } from "../src/index.ts";
import { UNTYPED_ISSUE_CLOSE_MESSAGE } from "../src/consts.ts";

function makeContext({
  author = "someone",
  authorType = "User",
  issueType = null,
  members = ["maintainer"],
}: {
  author?: string;
  authorType?: "Bot" | "User" | "Organization";
  issueType?: unknown;
  members?: string[];
} = {}) {
  const listMembers = vi.fn().mockResolvedValue({
    data: members.map((login) => ({ login })),
  });
  const get = vi.fn().mockResolvedValue({ data: { type: issueType } });
  const createComment = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const lock = vi.fn().mockResolvedValue({});

  const context = {
    payload: {
      issue: {
        number: 1,
        user: { login: author, type: authorType },
      },
    },
    octokit: {
      orgs: { listMembers },
      issues: { get, createComment, update, lock },
    },
    issue: vi.fn().mockImplementation((overrides: unknown) => ({
      owner: "terrapkg",
      repo: "packages",
      issue_number: 1,
      ...overrides as object,
    })),
  } as any;

  return { context, listMembers, get, createComment, update, lock };
}

const makeApp = () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}) as any;

test("closes untyped issues opened by non-maintainers", async () => {
  const { context, createComment, update, lock } = makeContext();

  const result = await handleUntypedIssue(context, makeApp());

  expect(result).toBe(true);
  expect(createComment).toHaveBeenCalledWith({
    owner: "terrapkg",
    repo: "packages",
    issue_number: 1,
    body: UNTYPED_ISSUE_CLOSE_MESSAGE,
  });
  expect(update).toHaveBeenCalledWith({
    owner: "terrapkg",
    repo: "packages",
    issue_number: 1,
    state: "closed",
    state_reason: "not_planned",
  });
  expect(lock).toHaveBeenCalledWith({
    owner: "terrapkg",
    repo: "packages",
    issue_number: 1,
    lock_reason: "spam",
  });
});

test("does not close issues opened by maintainers", async () => {
  const { context, get, createComment, update, lock } = makeContext({
    author: "maintainer",
    members: ["maintainer"],
  });

  const result = await handleUntypedIssue(context, makeApp());

  expect(result).toBe(false);
  expect(get).not.toHaveBeenCalled();
  expect(createComment).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(lock).not.toHaveBeenCalled();
});

test("does not close issues that have a type", async () => {
  const { context, createComment, update, lock } = makeContext({
    issueType: { name: "Bug" },
  });

  const result = await handleUntypedIssue(context, makeApp());

  expect(result).toBe(false);
  expect(createComment).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(lock).not.toHaveBeenCalled();
});

test("does not close issues opened by bots", async () => {
  const { context, get, createComment } = makeContext({
    authorType: "Bot",
    members: [],
  });

  const result = await handleUntypedIssue(context, makeApp());

  expect(result).toBe(false);
  expect(get).not.toHaveBeenCalled();
  expect(createComment).not.toHaveBeenCalled();
});

test("still closes the issue if locking fails", async () => {
  const { context, update, lock } = makeContext();
  lock.mockRejectedValue(new Error("lock failed"));
  const app = makeApp();

  const result = await handleUntypedIssue(context, app);

  expect(result).toBe(true);
  expect(update).toHaveBeenCalled();
  expect(app.log.error).toHaveBeenCalled();
});
