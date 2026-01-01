import { test, expect } from "vitest";
import { checkPackager } from '../src/lints/checkPackager.js';
import { checkChangelog } from '../src/lints/checkChangelog.js';

const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

test("processes PR with new spec file missing packager", async () => {
  const app = { log: { info: () => { }, error: () => { }, warn: () => { } } } as any;
  const file = { filename: 'test-package.spec', status: 'added' as const, sha: 'dummy' } as any;
  const result1 = await checkPackager({ context: {} as any, app, file, specContent });
  const result2 = await checkChangelog({ context: {} as any, app, file, specContent });
  expect(result1.messages).toEqual([`The \`Packager: name <mail@example.com>\` preamble is missing in \`test-package.spec\` and should be added.`]);
  expect(result1.reviewComments).toHaveLength(0);
  expect(result2.reviewComments).toHaveLength(0);
});