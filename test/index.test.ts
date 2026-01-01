// you can import your modules
// import index from '../src/index'

import nock from "nock";
// requiring our app implementation
import myProbotApp from "../src/index.js";
import { Probot } from "probot";
// requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeAll, beforeEach, afterEach, test, expect } from "vitest";

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
      .get("/repos/hiimbex/testing-things/pulls/1/files")
      .reply(200, [
        {
          filename: "README.md",
          status: "modified"
        }
      ]);

    await (probot as Probot).receive({ name: "pull_request", payload: pullRequestPayload } as any);

    expect(mock.pendingMocks()).toStrictEqual(["POST https://api.github.com:443/app/installations/2/access_tokens", "GET https://api.github.com:443/repos/hiimbex/testing-things/pulls/1/files"]);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});
