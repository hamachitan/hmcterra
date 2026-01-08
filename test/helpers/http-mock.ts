// Bun-compatible HTTP mock helper
export class HttpMock {
  private mocks: Map<string, { method: string; handler: (req: Request) => Response | Promise<Response> }> = new Map();

  get(url: string, handler: (req: Request) => Response | Promise<Response>) {
    this.mocks.set(`GET-${url}`, { method: "GET", handler });
    return this;
  }

  post(url: string, handler: (req: Request) => Response | Promise<Response>) {
    this.mocks.set(`POST-${url}`, { method: "POST", handler });
    return this;
  }

  delete(url: string, handler: (req: Request) => Response | Promise<Response>) {
    this.mocks.set(`DELETE-${url}`, { method: "DELETE", handler });
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

  async done() {
    return true;
  }

  restore() {
    if (globalThis.fetch && typeof (globalThis.fetch as any).restore === 'function') {
      (globalThis.fetch as any).restore();
    }
  }
}

export function createHttpMock() {
  return new HttpMock();
}
