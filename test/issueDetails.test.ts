import { afterEach, expect, test, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleIssueDetails } from "../src/issueDetails.ts";
import { ISSUE_DETAILS_THANKS } from "../src/consts.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specContent = fs.readFileSync(
  path.join(__dirname, "anda-srpm-macros.spec"),
  "utf8",
);

const issueBody = (pkg: string, relver: string) =>
  "### Full Raw Package Name (e.g. anda-0.4.14-1.fcrawhide.x86_64)\n\n" +
  `${pkg}\n\n### Release Version\n\n${relver}`;

interface Route {
  status?: number;
  json?: unknown;
  text?: string;
}

function stubFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const route = Object.entries(routes).find(([prefix]) =>
      url.startsWith(prefix)
    );
    const { status = 200, json, text } = route?.[1] ?? { status: 404 };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => text ?? "",
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeContext(body: string, repo = "packages", owner = "terrapkg") {
  const createComment = vi.fn().mockResolvedValue({});
  const listCommits = vi.fn().mockResolvedValue({
    data: [{
      sha: "abcdef1234567890",
      author: { login: "alice" },
      commit: { message: "fix: thing\n\nbody", author: { name: "Alice" } },
    }],
  });
  const getCommit = vi.fn().mockResolvedValue({
    data: {
      sha: "fedcba0987654321",
      author: { login: "bob" },
      commit: { message: "fallback commit", author: { name: "Bob" } },
    },
  });
  const issuesAndPullRequests = vi.fn().mockResolvedValue({
    data: { items: [{ number: 42 }] },
  });
  const users = vi.fn().mockResolvedValue({
    data: { items: [{ login: "somepackager" }] },
  });

  const context = {
    payload: { issue: { number: 1, body, user: { login: "someone" } } },
    repo: (overrides: object = {}) => ({ owner, repo, ...overrides }),
    octokit: {
      issues: { createComment },
      repos: { listCommits, getCommit },
      search: { issuesAndPullRequests, users },
    },
    issue: vi.fn().mockImplementation((overrides: unknown) => ({
      owner,
      repo,
      issue_number: 1,
      ...overrides as object,
    })),
  } as any;

  return {
    context,
    createComment,
    listCommits,
    getCommit,
    issuesAndPullRequests,
  };
}

const makeApp = () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}) as any;

const ghosttyRoutes: Record<string, Route> = {
  "https://madoguchi.fyralabs.com/api/terra45/packages/ghostty": {
    json: {
      name: "ghostty",
      repo: "terra45",
      ver: "1.3.1",
      rel: "3.fc45",
      arch: "x86_64",
      dirs: "anda/devs/ghostty/stable",
    },
  },
  "https://madoguchi.fyralabs.com/api/terra45/builds/ghostty": {
    json: [
      {
        id: "1",
        epoch: "2026-08-17T05:10:39",
        pname: "ghostty",
        pver: "1.3.1",
        prel: "2.fc45",
        parch: "x86_64",
        repo: "terra45",
        succ: true,
        commit: "abc",
      },
      {
        id: "2",
        epoch: "2026-11-03T07:57:33",
        pname: "ghostty",
        pver: "?",
        prel: "?",
        parch: "x86_64",
        repo: "terra45",
        succ: false,
        commit: "def",
      },
    ],
  },
  "https://madoguchi.fyralabs.com/redirect/terra45/packages/ghostty/spec/raw": {
    text: specContent,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("posts thanks and package details for a known package", async () => {
  stubFetch(ghosttyRoutes);
  const { context, createComment, listCommits } = makeContext(
    issueBody("ghostty-1.3.1-3.fc45.x86_64", "f45"),
  );

  await handleIssueDetails(context, makeApp());

  expect(listCommits).toHaveBeenCalledWith({
    owner: "terrapkg",
    repo: "packages",
    path: "anda/devs/ghostty/stable",
    sha: "f45",
    per_page: 1,
  });
  expect(createComment).toHaveBeenCalledTimes(1);

  const comment = createComment.mock.calls[0][0].body as string;
  expect(comment).toContain(ISSUE_DETAILS_THANKS);
  expect(comment).toContain(
    "- Package name: `ghostty-1.3.1-3.fc45.x86_64`",
  );
  expect(comment).toContain("- Latest version: `ghostty-1.3.1-3.fc45.x86_64`");
  expect(comment).toContain("- Last commit: `abcdef1` by alice:");
  expect(comment).toContain("  > fix: thing");
  expect(comment).toContain(
    "- last build: [2](https://github.com/terrapkg/packages/actions/runs/2) (failing)",
  );
  expect(comment).toContain("- packager: @somepackager");
  expect(comment).toContain("- open PRs:");
  expect(comment).toContain("  - #42");
});

test.each([
  { repo: "packages-el", release: "el10", madoguchi: "terrael10" },
  { repo: "tuatara", release: "tumbleweed", madoguchi: "tuatara-tumbleweed" },
  { repo: "packages", release: "45", madoguchi: "terra45" },
])("uses the event repository and mapping for $repo", async ({
  repo,
  release,
  madoguchi,
}) => {
  const routes = Object.fromEntries(
    Object.entries(ghosttyRoutes).map(([url, route]) => [
      url.replace("terra45", madoguchi),
      route,
    ]),
  );
  const fetchMock = stubFetch(routes);
  const { context, createComment, listCommits, issuesAndPullRequests } =
    makeContext(issueBody("ghostty-1.3.1-3.x86_64", release), repo, "test-owner");

  await handleIssueDetails(context, makeApp());

  expect(fetchMock).toHaveBeenCalledWith(
    `https://madoguchi.fyralabs.com/api/${madoguchi}/packages/ghostty`,
  );
  expect(listCommits).toHaveBeenCalledWith({
    owner: "test-owner",
    repo,
    path: "anda/devs/ghostty/stable",
    sha: release === "45" ? "f45" : release,
    per_page: 1,
  });
  expect(issuesAndPullRequests).toHaveBeenCalledWith({
    q: `repo:test-owner/${repo} is:pr is:open in:title ghostty`,
    per_page: 100,
  });
  expect(createComment.mock.calls[0][0].body).toContain(
    `https://github.com/test-owner/${repo}/actions/runs/2`,
  );
});

test("posts only the thanks message when no package name is detected", async () => {
  const fetchMock = stubFetch({});
  const { context, createComment } = makeContext(
    "### Name of the software\n\nsomething\n",
  );

  await handleIssueDetails(context, makeApp());

  expect(fetchMock).not.toHaveBeenCalled();
  expect(createComment).toHaveBeenCalledWith({
    owner: "terrapkg",
    repo: "packages",
    issue_number: 1,
    body: ISSUE_DETAILS_THANKS,
  });
});

test("posts only the thanks message when the package is not in Terra", async () => {
  stubFetch({});
  const { context, createComment } = makeContext(
    issueBody("ghostty-1.3.1-3.fc45.x86_64", "f45"),
  );

  await handleIssueDetails(context, makeApp());

  const comment = createComment.mock.calls[0][0].body as string;
  expect(comment).toBe(ISSUE_DETAILS_THANKS);
});

test("posts only the thanks message when the release version is missing", async () => {
  const fetchMock = stubFetch({});
  const { context, createComment } = makeContext(
    "### Full Raw Package Name\n\nghostty-1.3.1-3.fc45.x86_64\n",
  );

  await handleIssueDetails(context, makeApp());

  expect(fetchMock).not.toHaveBeenCalled();
  expect(createComment.mock.calls[0][0].body).toBe(ISSUE_DETAILS_THANKS);
});

test("still posts the thanks message when Madoguchi fails", async () => {
  stubFetch({
    "https://madoguchi.fyralabs.com/api/terra45/packages/ghostty": {
      status: 500,
    },
  });
  const { context, createComment } = makeContext(
    issueBody("ghostty-1.3.1-3.fc45.x86_64", "f45"),
  );
  const app = makeApp();

  await handleIssueDetails(context, app);

  expect(app.log.error).toHaveBeenCalled();
  expect(createComment.mock.calls[0][0].body).toBe(ISSUE_DETAILS_THANKS);
});

test("uses fallbacks when optional details fail", async () => {
  stubFetch({
    ...ghosttyRoutes,
    "https://madoguchi.fyralabs.com/redirect/terra45/packages/ghostty/spec/raw":
      { status: 404 },
  });
  const { context, createComment, listCommits, getCommit } = makeContext(
    issueBody("ghostty-1.3.1-3.fc45.x86_64", "f45"),
  );
  listCommits.mockRejectedValue(new Error("no commits"));
  getCommit.mockRejectedValue(new Error("no commit"));
  context.octokit.search.issuesAndPullRequests.mockRejectedValue(
    new Error("search failed"),
  );

  await handleIssueDetails(context, makeApp());

  const comment = createComment.mock.calls[0][0].body as string;
  expect(comment).toContain("- Latest version: `ghostty-1.3.1-3.fc45.x86_64`");
  expect(comment).not.toContain("- Last commit:");
  expect(comment).toContain("- packager: unspecified");
  expect(comment).toContain("  - none");
});
