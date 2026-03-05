import { test, expect } from "vitest";
import { Readable } from "stream";
import { tailMatchingLines } from "../src/utils/logReader.js";

test("tailMatchingLines returns last matching lines without prefix", async () => {
  const input = [
    "1234 rpmbuild │ first line",
    "no match here",
    "1235 rpmbuild │ second line",
    "1236 rpmbuild │ third line",
    "1237 rpmbuild │ fourth line"
  ].join("\n");

  const result = await tailMatchingLines(input, 2);

  expect(result).toEqual(["third line", "fourth line"]);
});

test("tailMatchingLines handles stream chunks and final line without newline", async () => {
  const chunks = [
    "1234 rpmbuild │ alpha\n1235",
    " rpmbuild │ beta\n",
    "1236 rpmbuild │ gamma"
  ];
  const stream = Readable.from(chunks);

  const result = await tailMatchingLines(stream, 10);

  expect(result).toEqual(["alpha", "beta", "gamma"]);
});
