import { describe, test, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runRpmspec } from "../src/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specFilePath = path.join(__dirname, "anda-srpm-macros.spec");
const specContent = fs.readFileSync(specFilePath, "utf-8");

describe("runRpmspec", () => {
  test("should extract name from spec file", async () => {
    const result = await runRpmspec(specContent, '%{name}');
    expect(result).toBe('anda-srpm-macros');
  });

  test("should extract version from spec file", async () => {
    const result = await runRpmspec(specContent, '%{version}');
    expect(result).toBe('0.2.29');
  });

  test("should extract release from spec file", async () => {
    const result = await runRpmspec(specContent, '%{release}');
    expect(result).toBe('1');
  });

  test("should extract summary from spec file", async () => {
    const result = await runRpmspec(specContent, '%{summary}');
    expect(result).toBe('SRPM macros for extra Fedora packages');
  });

  test("should extract packager from spec file", async () => {
    const result = await runRpmspec(specContent, '%{packager}');
    expect(result).toBe('(none)');
  });

  test("should handle multiple fields", async () => {
    const result = await runRpmspec(specContent, '%{name} %{version} %{release}');
    expect(result).toBe('anda-srpm-macros 0.2.29 1');
  });
});