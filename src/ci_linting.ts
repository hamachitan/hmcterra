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
  check(_params: CILintParams): Promise<CICheckResult> | CICheckResult;
}

import unpackagedFiles from "./ci_lints/unpackaged_files.ts";

export const ciLints: CILintFunction[] = [
  unpackagedFiles,
];
