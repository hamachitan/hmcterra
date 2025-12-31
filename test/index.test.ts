// You can import your modules
// import index from '../src/index'

import nock from "nock";
// Requiring our app implementation
import myProbotApp from "../src/index.js";
import { Probot, ProbotOctokit } from "probot";
// Requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test, expect, vi } from "vitest";

const issueCreatedBody = { body: "Thanks for opening this issue!" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/issues.opened.json"), "utf-8"),
);

const pullRequestPayload = {
  action: "opened",
  number: 1,
  pull_request: {
    number: 1,
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
  let probot: any;

  beforeEach(() => {
    nock.disableNetConnect();
    probot = new Probot({
      appId: 123,
      privateKey,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    // Load our app into probot
    probot.load(myProbotApp);
  });

  test("creates a comment when an issue is opened", async () => {
    const mock = nock("https://api.github.com")
      // Test that we correctly return a test token
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })

      // Test that a comment is posted
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        expect(body).toMatchObject(issueCreatedBody);
        return true;
      })
      .reply(200);

    // Receive a webhook event
    await probot.receive({ name: "issues", payload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("processes PR with spec file that needs release bump", async () => {
    const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package`;

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          pulls: "read",
          issues: "write",
        },
      })
      .get("/repos/hiimbex/testing-things/pulls/1/files")
      .reply(200, [
        {
          filename: "test-package.spec",
          status: "modified"
        }
      ])
      .get("/repos/hiimbex/testing-things/contents/test-package.spec?ref=abc123")
      .reply(200, {
        content: Buffer.from(specContent).toString('base64')
      })
      .post("/repos/hiimbex/testing-things/pulls/1/reviews", (body: any) => {
        expect(body.event).toBe("COMMENT");
        expect(body.comments).toHaveLength(1);
        expect(body.comments[0].path).toBe("test-package.spec");
        expect(body.comments[0].line).toBe(3);
        expect(body.comments[0].body).toContain("```suggestion");
        expect(body.comments[0].body).toContain("Release:        2%{?dist}");
        return true;
      })
      .reply(200);

    // Mock madoguchi API response
    const madoguchiMock = nock("https://madoguchi.fyralabs.com")
      .get("/v4/terra40/packages/test-package")
      .reply(200, [
        { ver: "1.0.0", rel: "1" }
      ]);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
    expect(madoguchiMock.pendingMocks()).toStrictEqual([]);
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
      });

    await probot.receive({ name: "pull_request", payload: unsupportedPayload });

    // Should not make any additional API calls beyond token authentication
    expect(mock.pendingMocks()).toStrictEqual([]);
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
      .get("/repos/hiimbex/testing-things/pulls/1/files")
      .reply(200, [
        {
          filename: "README.md",
          status: "modified"
        }
      ]);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});

// For more information about testing with Jest see:
// https://facebook.github.io/jest/

// For more information about using TypeScript in your tests, Jest recommends:
// https://github.com/kulshekhar/ts-jest

// For more information about testing with Nock see:
// https://github.com/nock/nock
