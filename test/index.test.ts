// you can import your modules
// import index from '../src/index'

import { describe, beforeAll, beforeEach, afterEach, test, expect, vi } from "vitest";
import nock from "nock";
// requiring our app implementation
import myProbotApp, { handlePullRequestAutolabel } from "../src/index.js";
import { Probot } from "probot";
import { MADOGUCHI_BASE_URL } from "../src/consts.js";
// requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

const pullRequestPayload = {
  action: "opened",
  number: 1,
  pull_request: {
    number: 1,
    user: {
      login: "testuser"
    },
    labels: [],
    base: {
      ref: "f40"
    },
    head: {
      sha: "abc123"
    }
  },
  repository: {
    name: "testing-things",
    owner: {
      login: "hiimbex"
    }
  },
  installation: {
    id: 2
  }
};

describe("My Probot app", () => {
  let probot: unknown;

  beforeAll(() => {
    probot = new Probot({
      appId: 123,
      privateKey: privateKey,
      secret: "test",
    });
    (probot as Probot).load(myProbotApp);
  });

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
  });

  test("skips PR targeting unsupported branch", async () => {
    const unsupportedPayload = {
      ...pullRequestPayload,
      pull_request: {
        ...pullRequestPayload.pull_request,
        base: { ref: "main" }
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          pulls: "read",
        },
      })
      .get("/repos/hiimbex/testing-things/pulls/1/files")
      .reply(200, []);

    await (probot as Probot).receive({ name: "pull_request", payload: unsupportedPayload } as any);

    // should not make any API calls for unsupported branch
    expect(mock.pendingMocks()).toStrictEqual(["POST https://api.github.com:443/app/installations/2/access_tokens", "GET https://api.github.com:443/repos/hiimbex/testing-things/pulls/1/files"]);
  });

  test("skips PR with no spec files", async () => {
    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          pulls: "read",
        },
      })
      .persist()
      .get("/repos/hiimbex/testing-things/pulls/1/files")
      .reply(200, [
        {
          filename: "README.md",
          status: "modified"
        }
      ])
      .get("/repos/hiimbex/testing-things/labels")
      .reply(200, [])
      .post("/repos/hiimbex/testing-things/issues/1/labels")
      .reply(200, []);

    await (probot as Probot).receive({ name: "pull_request", payload: pullRequestPayload } as any);

    expect(mock.pendingMocks()).toStrictEqual([]);
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

  test("handles issues.opened event", async () => {
    const specContent = "Packager: test user <test@example.com>\n%changelog\n* Mon Jan 01 2024 test user <test@example.com> - 0.2.29-1\n- Initial package";
    const mockMadoguchi = nock(MADOGUCHI_BASE_URL)
      .get("/redirect/terra40/packages/anda-srpm-macros/spec/raw")
      .reply(302, '', { location: `${MADOGUCHI_BASE_URL}/terra40/packages/anda-srpm-macros/spec/raw` })
      .get("/terra40/packages/anda-srpm-macros/spec/raw")
      .reply(200, specContent);

    const mockGithub = nock("https://api.github.com")
      .get("/search/users?q=test%40example.com%20in%3Aemail")
      .reply(200, { items: [{ login: "testuser" }] })
      .delete("/repos/hiimbex/testing-things/issues/1/assignees")
      .reply(200, {})
      .post("/repos/hiimbex/testing-things/issues/1/assignees")
      .reply(200, {});

    await (probot as Probot).receive({
      name: "issues.opened",
      payload: {
        action: "opened",
        issue: {
          number: 1,
          assignee: { login: "hamachitan" },
          body: "### Full Package Name\n\nanda-srpm-macros\n\n### Release Version\n\n40"
        },
        repository: {
          owner: { login: "hiimbex" },
          name: "testing-things"
        },
        installation: { id: 2 }
      }
    } as any);

    mockMadoguchi.done();
    mockGithub.done();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});
