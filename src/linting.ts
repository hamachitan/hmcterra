import { checkReleaseBump } from "./lints/checkReleaseBump.js";
import { checkPackager } from "./lints/checkPackager.js";
import { checkChangelog } from "./lints/checkChangelog.js";
import { requestPackagerReview } from "./lints/requestPackagerReview.js";
import { Context, Probot } from "probot";

export interface CheckResult {
  messages: string[];
  reviewComments: Array<{
    path: string;
    position: number;
    body: string;
  }>;
}

export interface LintParams {
  context: Context<"pull_request.opened" | "pull_request.reopened" | "pull_request.review_requested">;
  app: Probot;
  file: { sha: string; filename: string; status: "added" | "removed" | "renamed" | "changed" | "modified" | "copied" | "unchanged"; additions: number; deletions: number; changes: number; blob_url: string; raw_url: string; contents_url: string; patch?: string; previous_filename?: string; };
  specContent: string;
}

export interface LintFunction {
  name: string;
  check: (_params: LintParams) => Promise<CheckResult>;
}

export const lints: LintFunction[] = [
  {
    name: "releaseBump",
    check: checkReleaseBump,
  },
  {
    name: "packager",
    check: checkPackager,
  },
  {
    name: "changelog",
    check: checkChangelog,
  },
  {
    name: "packagerReview",
    check: requestPackagerReview,
  },
];
