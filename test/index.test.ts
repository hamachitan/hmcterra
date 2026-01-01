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
import { describe, beforeEach, afterEach, test, expect } from "vitest";

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

  const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

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
    (probot as Probot).load(myProbotApp);
  });

  test("processes PR with spec file that needs release bump", async () => {
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
        content: Buffer.from("Packager: hamachitan <hamachitan@outlook.com>\n" + specContent).toString('base64')
      });

    // Mock madoguchi API response
    const madoguchiMock = nock("https://madoguchi.fyralabs.com")
      .get("/v4/terra40/packages/test-package")
       .reply(200, [
         { ver: "1.0.0", rel: "1" }
       ]);

     await (probot as Probot).receive({ name: "pull_request", payload: pullRequestPayload } as any);

     expect(madoguchiMock.pendingMocks()).toStrictEqual([]);
    expect(mock.pendingMocks()).toStrictEqual([]);
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

    // Should not make any additional API calls beyond token and files
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

     await (probot as Probot).receive({ name: "pull_request", payload: pullRequestPayload } as any);

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("processes PR with new spec file missing packager", async () => {

    const openedPayload = {
      ...pullRequestPayload,
      action: "opened"
    };

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
          status: "added"
        }
      ])
      .get("/repos/hiimbex/testing-things/contents/test-package.spec?ref=abc123")
      .reply(200, {
        content: Buffer.from(specContent).toString('base64')
      })
        .post("/repos/hiimbex/testing-things/pulls/1/reviews", (body: unknown) => {
          expect((body as { event: string; body: string }).event).toBe("COMMENT");
          expect((body as { event: string; body: string }).body).toContain("The `Packager: name <mail@example.com>` preamble is missing in `test-package.spec` and should be added.");
          return true;
       })
       .reply(200);

     await (probot as Probot).receive({ name: "pull_request", payload: openedPayload } as any);

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});
