// you can import your modules
// import index from '../src/index'

import { describe, beforeAll, beforeEach, afterEach, test, expect, vi } from "vitest";
import nock from "nock";
// requiring our app implementation
import myProbotApp, { handlePullRequestAutolabel } from "../src/index.js";
import { Probot } from "probot";
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

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});
