import { test, expect } from "vitest";
import { checkReleaseBump } from '../src/lints/checkReleaseBump.js';

const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

test("processes PR with spec file that needs release bump", async () => {
  const app = { log: { info: () => { }, error: () => { }, warn: () => { } } } as any;
  const file = { filename: 'test.spec', status: 'modified' as const, sha: 'dummy' } as any;
  const context = { payload: { pull_request: { base: { ref: 'f40' } } } } as any;
  const result = await checkReleaseBump({ context, app, file, specContent });
  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toHaveLength(0);
});