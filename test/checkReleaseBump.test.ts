import { describe, beforeEach, afterEach, test, expect, vi } from "vitest";
import { checkReleaseBump, checkPackageExists } from '../src/lints/checkReleaseBump.js';
import { MADOGUCHI_BASE_URL } from "../src/consts.js";

// Bun-compatible HTTP mock helper
class HttpMock {
  private mocks: Map<string, { method: string; handler: (req: Request) => Response | Promise<Response> }> = new Map();

  get(url: string, handler: (req: Request) => Response | Promise<Response>) {
    this.mocks.set(`GET-${url}`, { method: "GET", handler });
    return this;
  }

  reply(status: number, body: any, headers?: Record<string, string>) {
    const entries = Array.from(this.mocks.entries());
    if (entries.length > 0) {
      const [key] = entries[entries.length - 1];
      const mock = this.mocks.get(key)!;
      mock.handler = () => new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers }
      });
    }
    return this;
  }

  intercept() {
    const originalFetch = globalThis.fetch;
    const mocks = this.mocks;
    
    globalThis.fetch = new Proxy(originalFetch, {
      apply: async (target, thisArg, args) => {
        const [input, init] = args;
        const url = input.toString();
        const method = init?.method || "GET";
        
        const key = `${method}-${url}`;
        const mock = mocks.get(key);
        
        if (mock) {
          const req = new Request(url, init);
          return mock.handler(req);
        }
        
        return target.apply(thisArg, args);
      }
    }) as typeof fetch;

    return this;
  }

  restore() {
    if (globalThis.fetch && typeof (globalThis.fetch as any).restore === 'function') {
      (globalThis.fetch as any).restore();
    }
  }
}

function createHttpMock() {
  return new HttpMock();
}

const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

describe("checkReleaseBump", () => {
  beforeEach(() => {
    // No need to disable net connect with Bun mock
  });

  afterEach(() => {
    // Restore fetch if needed
  });

  test("processes PR with spec file that needs release bump", async () => {
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
        repos: {
          createOrUpdateFileContents: vi.fn().mockResolvedValue({})
        }
      },
      repo: vi.fn().mockReturnValue({}),
    } as any;

    const result = await checkReleaseBump({ context, app, file, specContent });
    expect(result.messages).toEqual([]);
    expect(result.reviewComments).toHaveLength(0);
  });

  test("returns empty when version and release match", async () => {
    const mock = createHttpMock();
    mock.get(`${MADOGUCHI_BASE_URL}/v4/terra40/packages/test-package`, () => 
      new Response(JSON.stringify({ ver: "1.0.0", rel: "1.f40" }), { status: 200 })
    );
    mock.intercept();

    const result = await checkPackageExists("test-package", "1.0.0", "1", "f40");

    expect(result).toBe(true);
    mock.restore();
  });
});

describe("checkPackageExists", () => {
  test("returns false when version differs", async () => {
    const mock = createHttpMock();
    mock.get(`${MADOGUCHI_BASE_URL}/v4/terra40/packages/test-package`, () => 
      new Response(JSON.stringify({ ver: "1.0.0", rel: "1.f40" }), { status: 200 })
    );
    mock.intercept();

    const result = await checkPackageExists("test-package", "2.0.0", "1", "f40");

    expect(result).toBe(false);
    mock.restore();
  });

  test("returns false when release differs", async () => {
    const mock = createHttpMock();
    mock.get(`${MADOGUCHI_BASE_URL}/v4/terra40/packages/test-package`, () => 
      new Response(JSON.stringify({ ver: "1.0.0", rel: "1.f40" }), { status: 200 })
    );
    mock.intercept();

    const result = await checkPackageExists("test-package", "1.0.0", "2", "f40");

    expect(result).toBe(false);
    mock.restore();
  });
});
