import { expect, test } from "vitest";
import { commands, Invocation } from "../src/command.ts";

test("help lists all commands and usages", async () => {
  const result = await commands.help.exec();

  expect(result).toContain("### Available commands");
  expect(result).toContain("`nosync [branch...]`");
  expect(result).toContain("`changelog [--print|-p] <message>`");
  expect(result).toContain("`bump`");
  expect(result).toContain("`help`");
  expect(result).toContain("Aliases: `man`");
});

test("man is an alias for help", () => {
  expect(commands.man).toBe(commands.help);
});

test("help invocation works", async () => {
  const result = await new Invocation("help").exec({} as any, {} as any);
  expect(result).toContain("Available commands");
});

test("man invocation works", async () => {
  const result = await new Invocation("man").exec({} as any, {} as any);
  expect(result).toContain("Available commands");
});
