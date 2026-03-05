import { Context, Probot } from "probot";

export interface CICheckResult {
  comments: string[];
}

export interface CILintParams {
  context: Context<"workflow_run.completed">;
  app: Probot;
  logs: string[];
  pullRequest: { number: number };
}

export interface CILintFunction {
  name: string;
  check: (_params: CILintParams) => Promise<CICheckResult>;
}

import { unpackagedFiles } from "./ci_lints/unpackaged_files.js";

export const ciLints: CILintFunction[] = [
  {
    name: "unpackagedFiles",
    check: unpackagedFiles,
  },
];
