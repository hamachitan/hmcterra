import { describe, beforeEach, afterEach, test, expect, vi } from "vitest";
import nock from "nock";
import { checkReleaseBump, checkPackageExists } from '../src/lints/checkReleaseBump.js';
import { MADOGUCHI_BASE_URL } from "../src/consts.js";

const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

describe("checkReleaseBump", () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("processes PR with spec file that needs release bump", async () => {
    const mockMadoguchi = nock(MADOGUCHI_BASE_URL)
      .get("/v4/terra40/packages/test-package")
      .reply(200, {
        ver: "1.0.0",
        rel: "1.f40"
      });

    const app = { log: { info: () => { }, error: () => { }, warn: () => { } } } as any;
    const file = { filename: 'test.spec', status: 'added' as const, sha: 'dummy' } as any;
    const context = {
      payload: {
        pull_request: {
          base: { ref: 'f40' },
          head: { ref: 'feature-branch' },
          number: 1
        },
        repository: {
          owner: { login: 'hiimbex' },
          name: 'testing-things'
        },
        installation: { id: 2 }
      },
      octokit: {
        issues: {
          listLabelsForRepo: vi.fn().mockResolvedValue({
            data: [{ name: 'sync-f40' }, { name: 'sync-frawhide' }]
          })
        },
        repos: {
          createOrUpdateFileContents: vi.fn().mockResolvedValue({})
        }
      },
      repo: vi.fn().mockReturnValue({}),
    } as any;

    const result = await checkReleaseBump({ context, app, file, specContent });
    expect(result.messages).toEqual([]);
    expect(result.reviewComments).toHaveLength(0);
    expect(context.octokit.repos.createOrUpdateFileContents).toHaveBeenCalled();
    mockMadoguchi.done();
  });

});

describe("checkPackageExists", () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("checkPackageExists returns true when version and release match", async () => {
    const mock = nock(MADOGUCHI_BASE_URL)
      .get("/v4/terrarawhide/packages/anda")
      .reply(200, {
        "arch": "aarch64",
        "dirs": "anda/tools/buildsys/anda",
        "name": "anda",
        "rel": "1.fcrawhide",
        "repo": "terrarawhide",
        "ver": "0.4.14"
      });

    const result = await checkPackageExists("anda", "0.4.14", "1", "rawhide");
    expect(result).toBe(true);
    mock.done();
  });

  test("checkPackageExists returns false when version differs", async () => {
    const mock = nock(MADOGUCHI_BASE_URL)
      .get("/v4/terrarawhide/packages/anda")
      .reply(200, {
        "arch": "aarch64",
        "dirs": "anda/tools/buildsys/anda",
        "name": "anda",
        "rel": "1.fcrawhide",
        "repo": "terrarawhide",
        "ver": "0.4.14"
      });

    const result = await checkPackageExists("anda", "0.4.15", "1", "rawhide");
    expect(result).toBe(false);
    mock.done();
  });

  test("checkPackageExists returns false when release differs", async () => {
    const mock = nock(MADOGUCHI_BASE_URL)
      .get("/v4/terrarawhide/packages/anda")
      .reply(200, {
        "arch": "aarch64",
        "dirs": "anda/tools/buildsys/anda",
        "name": "anda",
        "rel": "1.fcrawhide",
        "repo": "terrarawhide",
        "ver": "0.4.14"
      });

    const result = await checkPackageExists("anda", "0.4.14", "2", "rawhide");
    expect(result).toBe(false);
    mock.done();
  });
});
