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

import empty_files from "./ci_lints/empty_files.ts";
import file_not_found from "./ci_lints/file_not_found.ts";
import unpackagedFiles from "./ci_lints/unpackaged_files.ts";

export const ciLints: CILintFunction[] = [
  empty_files,
  file_not_found,
  unpackagedFiles,
];
