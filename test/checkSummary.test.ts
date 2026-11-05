import { expect, test, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkSummary } from "../src/lints/checkSummary.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specContent = fs.readFileSync(
  path.join(__dirname, "summary.spec"),
  "utf8",
);

const file = {
  filename: "summary.spec",
  status: "added" as const,
  sha: "dummy",
} as any;

function makeApp() {
  return {
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  } as any;
}

test("flags summaries ending with a period", async () => {
  const result = await checkSummary({
    context: {} as any,
    app: makeApp(),
    file,
    specContent,
  });

  expect(result.reviewComments).toEqual([]);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toContain(
    "`summary-test`: `Main package summary.`",
  );
  expect(result.messages[0]).toContain(
    "`summary-test-bad`: `Bad subpackage summary.`",
  );
  expect(result.messages[0]).not.toContain("summary-test-good");
});

test("does not flag summaries without a trailing period", async () => {
  const cleanSpec = specContent
    .replace("Main package summary.", "Main package summary")
    .replace("Bad subpackage summary.", "Bad subpackage summary");

  const result = await checkSummary({
    context: {} as any,
    app: makeApp(),
    file,
    specContent: cleanSpec,
  });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toEqual([]);
});

test("handles invalid specs gracefully", async () => {
  const app = makeApp();
  const result = await checkSummary({
    context: {} as any,
    app,
    file,
    specContent: "this is not a spec\n",
  });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toEqual([]);
  expect(app.log.error).toHaveBeenCalled();
});
