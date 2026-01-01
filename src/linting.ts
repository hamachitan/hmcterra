export interface CheckResult {
  messages: string[];
  reviewComments: Array<{
    path: string;
    position: number;
    body: string;
  }>;
}

export interface LintParams {
  context?: unknown;
  app: unknown;
  file: unknown;
  specContent: string;
}

export interface LintFunction {
  name: string;
  check: (_params: LintParams) => Promise<CheckResult>;
}

import { checkReleaseBump } from "./lints/checkReleaseBump.js";
import { checkPackager } from "./lints/checkPackager.js";
import { checkChangelog } from "./lints/checkChangelog.js";

export const lints: LintFunction[] = [
  {
    name: 'releaseBump',
    check: checkReleaseBump
  },
  {
    name: 'packager',
    check: checkPackager
  },
  {
    name: 'changelog',
    check: checkChangelog
  }
];