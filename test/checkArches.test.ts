import { Buffer } from "node:buffer";
import { expect, test, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkArches } from "../src/lints/checkArches.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archesSpec = fs.readFileSync(path.join(__dirname, "arches.spec"), "utf8");
const archesMacroSpec = fs.readFileSync(
  path.join(__dirname, "arches-macro.spec"),
  "utf8",
);
const noarchSpec = fs.readFileSync(path.join(__dirname, "noarch.spec"), "utf8");

const file = (filename: string) =>
  ({ filename, status: "added" as const, sha: "dummy" }) as any;

const anda = (arches: string[]) =>
  `project pkg {
  arches = [${arches.map((arch) => `"${arch}"`).join(", ")}]
  rpm {
    spec = "test.spec"
  }
}`;

function makeApp() {
  return {
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  } as any;
}

function makeContext(andaContent: string | null) {
  return {
    payload: { pull_request: { head: { sha: "abc123" } } },
    repo: (args: unknown) => args,
    octokit: {
      repos: {
        getContent: vi.fn().mockImplementation(async () => {
          if (andaContent === null) {
            throw Object.assign(new Error("Not Found"), { status: 404 });
          }
          return {
            data: { content: Buffer.from(andaContent).toString("base64") },
          };
        }),
      },
    },
  } as any;
}

test("flags arches not allowed by ExclusiveArch", async () => {
  const result = await checkArches({
    context: makeContext(anda(["x86_64", "aarch64"])),
    app: makeApp(),
    file: file("arches.spec"),
    specContent: archesSpec,
  });

  expect(result.reviewComments).toEqual([]);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toContain("`aarch64`");
  expect(result.messages[0]).toContain("`ExclusiveArch`");
});

test("allows arches permitted by ExclusiveArch", async () => {
  const result = await checkArches({
    context: makeContext(anda(["x86_64"])),
    app: makeApp(),
    file: file("arches.spec"),
    specContent: archesSpec,
  });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toEqual([]);
});

test("expands macros in ExclusiveArch", async () => {
  const result = await checkArches({
    context: makeContext(anda(["i386", "x86_64"])),
    app: makeApp(),
    file: file("arches-macro.spec"),
    specContent: archesMacroSpec,
  });

  expect(result.messages).toEqual([]);
});

test("flags noarch packages built for multiple arches", async () => {
  const result = await checkArches({
    context: makeContext(anda(["x86_64", "aarch64"])),
    app: makeApp(),
    file: file("noarch.spec"),
    specContent: noarchSpec,
  });

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toContain("`BuildArch: noarch`");
});

test("allows noarch packages built for a single arch", async () => {
  const result = await checkArches({
    context: makeContext(anda(["aarch64"])),
    app: makeApp(),
    file: file("noarch.spec"),
    specContent: noarchSpec,
  });

  expect(result.messages).toEqual([]);
});

test("skips when anda.hcl is missing", async () => {
  const result = await checkArches({
    context: makeContext(null),
    app: makeApp(),
    file: file("arches.spec"),
    specContent: archesSpec,
  });

  expect(result.messages).toEqual([]);
});

test("skips when anda.hcl has no arches", async () => {
  const result = await checkArches({
    context: makeContext("project pkg {}"),
    app: makeApp(),
    file: file("arches.spec"),
    specContent: archesSpec,
  });

  expect(result.messages).toEqual([]);
});

test("handles invalid specs gracefully", async () => {
  const app = makeApp();
  const result = await checkArches({
    context: makeContext(anda(["x86_64"])),
    app,
    file: file("invalid.spec"),
    specContent: "this is not a spec\n",
  });

  expect(result.messages).toEqual([]);
  expect(app.log.error).toHaveBeenCalled();
});
