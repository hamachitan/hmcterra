import { expect, test, vi } from "vitest";
import { checkPackager } from "../src/lints/checkPackager.ts";
import { checkChangelog } from "../src/lints/checkChangelog.ts";

vi.mock("../src/utils/rpm.ts", () => ({
  runRpmspec: vi.fn(),
}));

import { runRpmspec } from "../src/utils/rpm.ts";

const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

test("processes PR with new spec file missing packager", async () => {
  const mockRunRpmspec = runRpmspec as any;
  mockRunRpmspec.mockResolvedValue("(none)");

  const app = {
    log: { info: () => {}, error: () => {}, warn: () => {} },
  } as any;
  const file = {
    filename: "test-package.spec",
    status: "added" as const,
    sha: "dummy",
  } as any;
  const result1 = await checkPackager({
    context: {} as any,
    app,
    file,
    specContent,
  });
  const result2 = await checkChangelog({
    context: {} as any,
    app,
    file,
    specContent,
  });
  expect(result1.messages[0]).toContain(
    "The `Packager: name <mail@example.com>` preamble is missing in `test-package.spec`",
  );
  expect(result1.reviewComments).toHaveLength(0);
  expect(result2.reviewComments).toHaveLength(0);
});

test("handles runRpmspec error gracefully", async () => {
  const mockRunRpmspec = runRpmspec as any;
  mockRunRpmspec.mockRejectedValue(new Error("RPM error"));

  const app = { log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as any;
  const file = {
    filename: "test.spec",
    status: "added" as const,
    sha: "dummy",
  } as any;
  const specWithPackager = specContent + "\nPackager: test <test@example.com>";

  const result = await checkPackager({
    context: {} as any,
    app,
    file,
    specContent: specWithPackager,
  });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toEqual([]);
  expect(app.log.error).toHaveBeenCalled();
});
