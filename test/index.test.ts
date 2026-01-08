// you can import your modules
// import index from '../src/index'

import { describe, beforeAll, test, expect, vi } from "vitest";
// requiring our app implementation
import myProbotApp, { handlePullRequestAutolabel, handlePullRequestLint, handleIssues } from "../src/index.js";
import { Probot } from "probot";
import pkg from "../package.json";
import { MADOGUCHI_BASE_URL } from "../src/consts.js";
// requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
import pullRequestPayload from "./fixtures/pr_opened.json";
import issuePayload from "./fixtures/issue_opened.json";
import reviewRequestedPayload from "./fixtures/pr_lint_payload.json";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

// Bun-compatible HTTP mock helper
class BunHttpMock {
  private mocks: Map<string, { method: string; urlPattern: string; handler: (req: Request) => any }> = new Map();
  private originalFetch: typeof globalThis.fetch;
  private enabled: boolean = false;

  constructor() {
    this.originalFetch = globalThis.fetch;
  }

  post(url: string, handler: (req: Request) => any) {
    this.mocks.set(`POST-${url}`, { method: "POST", urlPattern: url, handler });
    return this;
  }

  get(url: string, handler: (req: Request) => any) {
    this.mocks.set(`GET-${url}`, { method: "GET", urlPattern: url, handler });
    return this;
  }

  delete(url: string, handler: (req: Request) => any) {
    this.mocks.set(`DELETE-${url}`, { method: "DELETE", urlPattern: url, handler });
    return this;
  }

  intercept() {
    const mocks = this.mocks;
    const originalFetch = this.originalFetch;
    const self = this;
    
    self.enabled = true;
    
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      if (!self.enabled) {
        return originalFetch(input, init);
      }
      
      const url = input.toString();
      const method = init?.method || "GET";
      
      // Try to find a matching mock
      for (const mock of mocks.values()) {
        if (mock.method === method && url.includes(mock.urlPattern)) {
          const req = new Request(url, init);
          const data = await mock.handler(req);
          if (data instanceof Response) {
            return data;
          }
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
      
      return originalFetch(input, init);
    }) as typeof globalThis.fetch;

    return this;
  }

  restore() {
    this.enabled = false;
    globalThis.fetch = this.originalFetch;
  }
}

function createHttpMock() {
  return new BunHttpMock();
}

describe("My Probot app", () => {
  let probot: unknown;

  beforeAll(async () => {
    probot = new Probot({
      appId: 123,
      privateKey: privateKey,
      secret: "test",
    });
    await (probot as Probot).load(myProbotApp);
  });

  test("skips PR targeting unsupported branch", async () => {
    const unsupportedPayload = {
      ...pullRequestPayload,
      pull_request: {
        ...pullRequestPayload.pull_request,
        base: { ref: "main" }
      }
    };

    await (probot as Probot).receive({ name: "pull_request", payload: unsupportedPayload } as any);
    // If we get here without error, the test passes
  });

  test("skips PR with no spec files", async () => {
    const listFilesMock = vi.fn().mockResolvedValue({
      data: [{ filename: "README.md", status: "modified" }]
    });
    const mockContext = {
      payload: {
        ...pullRequestPayload,
        action: "opened"
      },
      octokit: {
        pulls: { listFiles: listFilesMock }
      },
      pullRequest: vi.fn().mockReturnValue({
        owner: "hiimbex",
        repo: "testing-things",
        pull_number: 1
      })
    } as any;
    const mockApp = { log: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), trace: vi.fn() } } as any;

    await handlePullRequestLint(mockContext, mockApp);

    expect(listFilesMock).toHaveBeenCalled();
  });

  test("executes lints in parallel for multiple spec files and removes reviewers on review_requested", async () => {
    const listFilesMock = vi.fn().mockResolvedValue({
      data: [
        { filename: "pkg1.spec", status: "modified" },
        { filename: "pkg2.spec", status: "added" }
      ]
    });
    const getContentMock = vi.fn().mockImplementation(({ path }) => {
      if (path === "pkg1.spec") {
        return { data: { content: Buffer.from("Name: pkg1\nVersion: 1.0\nRelease: 1\nSummary: test\nLicense: MIT\nPackager: test <test@example.com>").toString('base64') } };
      }
      return { data: { content: Buffer.from("Name: pkg2\nVersion: 2.0\nRelease: 1\nSummary: test2\nLicense: MIT\nPackager: test2 <test2@example.com>").toString('base64') } };
    });
    const createReviewMock = vi.fn().mockResolvedValue({});
    const removeRequestedReviewersMock = vi.fn().mockResolvedValue({});
    const mockContext = {
      payload: reviewRequestedPayload,
      octokit: {
        pulls: {
          listFiles: listFilesMock,
          createReview: createReviewMock,
          removeRequestedReviewers: removeRequestedReviewersMock
        },
        repos: { getContent: getContentMock }
      },
      pullRequest: vi.fn().mockImplementation((overrides) => ({
        owner: "hiimbex",
        repo: "parallel-test",
        pull_number: 1,
        ...overrides
      })),
      repo: vi.fn().mockImplementation((overrides) => ({
        owner: "hiimbex",
        repo: "parallel-test",
        ...overrides
      }))
    } as any;
    const mockApp = { log: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), trace: vi.fn() } } as any;

    await handlePullRequestLint(mockContext, mockApp);

    expect(listFilesMock).toHaveBeenCalled();
    expect(getContentMock).toHaveBeenCalledTimes(2);
    expect(createReviewMock).toHaveBeenCalled();
    expect(removeRequestedReviewersMock).toHaveBeenCalledWith({
      owner: "hiimbex",
      repo: "parallel-test",
      pull_number: 1,
      reviewers: ["hamachitan"]
    });
  });

  test("handles issues.opened event", async () => {
    const originalFetch = globalThis.fetch;
    const createCommentMock = vi.fn().mockResolvedValue({});
    const removeAssigneesMock = vi.fn().mockResolvedValue({});
    const addAssigneesMock = vi.fn().mockResolvedValue({});

    const specContent = `Name:           anda-srpm-macros
Version:        0.2.29
Release:        1%{?dist}
Summary:        SRPM macros for extra Fedora packages
License:        MIT
Packager:       some packager <some_packager@example.com>
BuildArch:      noarch

%description
%{summary}.

%files
`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/redirect/terra40/packages/anda-srpm-macros/spec/raw')) {
        const response = new Response(specContent, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
        Object.defineProperty(response, 'redirected', { value: true, writable: false });
        Object.defineProperty(response, 'url', { value: 'https://madoguchi.fyralabs.com/redirected-real', writable: false });
        return Promise.resolve(response);
      }
      return Promise.resolve(new Response(specContent, { status: 200 }));
    });
    (globalThis as any).fetch = fetchMock;

    const searchUsersMock = vi.fn().mockResolvedValue({
      data: { items: [{ login: "someuser" }] }
    });

    const mockContext = {
      payload: issuePayload,
      octokit: {
        issues: {
          createComment: createCommentMock,
          removeAssignees: removeAssigneesMock,
          addAssignees: addAssigneesMock
        },
        search: { users: searchUsersMock }
      },
      issue: vi.fn().mockImplementation((overrides) => ({
        owner: "hiimbex",
        repo: "testing-things",
        issue_number: 1,
        ...overrides
      }))
    } as any;
    const mockApp = { 
      log: { 
        debug: vi.fn(), 
        info: vi.fn(), 
        error: vi.fn(), 
        warn: vi.fn(), 
        trace: vi.fn() 
      } 
    } as any;

    await handleIssues(mockContext, mockApp);

    expect(createCommentMock).not.toHaveBeenCalled();
    expect(removeAssigneesMock).toHaveBeenCalledWith({
      owner: "hiimbex",
      repo: "testing-things",
      issue_number: 1,
      assignees: ["hamachitan"]
    });
    expect(addAssigneesMock).toHaveBeenCalledWith({
      owner: "hiimbex",
      repo: "testing-things",
      issue_number: 1,
      assignees: ["someuser"]
    });

    (globalThis as any).fetch = originalFetch;
  });

  test("adds sync labels to opened PR", async () => {
    const listLabelsMock = vi.fn().mockResolvedValue({ data: [{ name: "sync-frawhide" }, { name: "other-label" }] });
    const addLabelsMock = vi.fn().mockResolvedValue({});
    const mockContext = {
      payload: {
        pull_request: {
          number: 2,
          base: { ref: "f40" },
          labels: [],
          user: { login: "testuser" }
        },
        action: "opened",
        repository: { owner: { login: "hiimbex" }, name: "synclbls" }
      },
      octokit: {
        issues: {
          listLabelsForRepo: listLabelsMock,
          addLabels: addLabelsMock
        }
      },
      repo: vi.fn().mockReturnValue({ owner: "hiimbex", repo: "synclbls" }),
      issue: vi.fn().mockReturnValue({ labels: ["sync-frawhide"] })
    } as any;
    const mockApp = { log: { debug: vi.fn() } } as any;

    await handlePullRequestAutolabel(mockContext, mockApp);

    expect(listLabelsMock).toHaveBeenCalledWith({ owner: "hiimbex", repo: "synclbls" });
    expect(addLabelsMock).toHaveBeenCalledWith({ labels: ["sync-frawhide"] });
  });

  test("skips adding labels if PR has nosync label", async () => {
    const listLabelsMock = vi.fn();
    const addLabelsMock = vi.fn();
    const mockContext = {
      payload: {
        pull_request: {
          number: 1,
          base: { ref: "f40" },
          labels: [{ name: "nosync" }],
          user: { login: "testuser" }
        },
        action: "opened"
      },
      octokit: {
        issues: {
          listLabelsForRepo: listLabelsMock,
          addLabels: addLabelsMock
        }
      }
    } as any;
    const mockApp = { log: { debug: vi.fn() } } as any;

    await handlePullRequestAutolabel(mockContext, mockApp);

    expect(listLabelsMock).not.toHaveBeenCalled();
    expect(addLabelsMock).not.toHaveBeenCalled();
  });

  test("skips adding labels if PR body contains nosync", async () => {
    const listLabelsMock = vi.fn();
    const addLabelsMock = vi.fn();
    const mockContext = {
      payload: {
        pull_request: {
          number: 1,
          base: { ref: "f40" },
          labels: [],
          user: { login: "testuser" },
          body: "This PR has nosync in the body"
        },
        action: "opened"
      },
      octokit: {
        issues: {
          listLabelsForRepo: listLabelsMock,
          addLabels: addLabelsMock
        }
      }
    } as any;
    const mockApp = { log: { debug: vi.fn() } } as any;

    await handlePullRequestAutolabel(mockContext, mockApp);

    expect(listLabelsMock).not.toHaveBeenCalled();
    expect(addLabelsMock).not.toHaveBeenCalled();
  });

  test.skip("handles issues.opened event", async () => {
    const specContent = fs.readFileSync('test/anda-srpm-macros.spec', 'utf8');
    
    const mockMadoguchi = createHttpMock();
    mockMadoguchi.get(`${MADOGUCHI_BASE_URL}/redirect/terra40/packages/anda-srpm-macros/spec/raw`, () => 
      ({})
    );
    mockMadoguchi.get(`${MADOGUCHI_BASE_URL}/redirected-real`, () => 
      (specContent)
    );
    mockMadoguchi.intercept();

    const mockGithub = createHttpMock();
    mockGithub.get("https://api.github.com/search/users?q=some_packager%40example.com%20in%3Aemail", () => 
      ({ items: [{ login: "someuser" }] })
    );
    mockGithub.delete("https://api.github.com/repos/hiimbex/testing-things/issues/1/assignees", () => 
      ({})
    );
    mockGithub.post("https://api.github.com/repos/hiimbex/testing-things/issues/1/assignees", () => 
      ({})
    );
    mockGithub.intercept();

    await (probot as Probot).receive({
      name: "issues.opened",
      payload: issuePayload
    } as any);

    mockMadoguchi.restore();
    mockGithub.restore();
  });

  test("health endpoint returns version from package.json", () => {
    const mockRouter = { get: vi.fn() };
    const getRouter = vi.fn().mockReturnValue(mockRouter);
    const mockApp = { on: vi.fn() };

    myProbotApp(mockApp as any, { getRouter });

    expect(getRouter).toHaveBeenCalledWith("/");
    expect(mockRouter.get).toHaveBeenCalledWith('/health', expect.any(Function));

    const handler = mockRouter.get.mock.calls[0][1];
    const mockRes = { json: vi.fn() };

    handler({}, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith({ version: pkg.version });
  });

  test.skip("executes lints in parallel for multiple spec files and removes reviewers on review_requested", async () => {
    const mock = createHttpMock();
    mock.post("https://api.github.com/app/installations/2/access_tokens", () => 
      ({ token: "test" })
    );
    mock.get("https://api.github.com/repos/hiimbex/parallel-test/pulls/1/files", () => 
      ({ data: [
        { filename: "pkg1.spec", status: "modified" },
        { filename: "pkg2.spec", status: "added" }
      ]})
    );
    mock.get("https://api.github.com/repos/hiimbex/parallel-test/contents/pkg1.spec?ref=abc123", () => 
      ({ content: Buffer.from("Name: pkg1\nVersion: 1.0\nRelease: 1\nSummary: test\nLicense: MIT\nPackager: test <test@example.com>").toString('base64') })
    );
    mock.get("https://api.github.com/repos/hiimbex/parallel-test/contents/pkg2.spec?ref=abc123", () => 
      ({ content: Buffer.from("Name: pkg2\nVersion: 2.0\nRelease: 1\nSummary: test2\nLicense: MIT\nPackager: test2 <test2@example.com>").toString('base64') })
    );
    mock.post("https://api.github.com/repos/hiimbex/parallel-test/pulls/1/reviews", () => 
      ({ data: {} })
    );
    mock.delete("https://api.github.com/repos/hiimbex/parallel-test/pulls/1/requested_reviewers", () => 
      ({ data: {} })
    );
    mock.intercept();

    await (probot as Probot).receive({ name: "pull_request", payload: reviewRequestedPayload } as any);

    mock.restore();
  });
});
