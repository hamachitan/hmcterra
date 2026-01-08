import { test, expect, vi } from "vitest";
import { checkPackager } from '../src/lints/checkPackager.js';
import { checkChangelog } from '../src/lints/checkChangelog.js';

const specContentMissingPackager = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

const specContentWithPackager = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT
Packager: test <test@example.com>

%description
%{summary}`;

test("processes PR with new spec file missing packager", async () => {
  const app = { log: { info: () => { }, error: () => { }, warn: () => { } } } as any;
  const file = { filename: 'test-package.spec', status: 'added' as const, sha: 'dummy' } as any;

  const result1 = await checkPackager({ context: {} as any, app, file, specContent: specContentMissingPackager });
  const result2 = await checkChangelog({ context: {} as any, app, file, specContent: specContentMissingPackager });

  expect(result1.messages[0]).toContain('The `Packager: name <mail@example.com>` preamble is missing in `test-package.spec`');
  expect(result1.reviewComments).toHaveLength(0);
  expect(result2.reviewComments).toHaveLength(0);
});

test("handles packager field present correctly", async () => {
  const app = { log: { error: vi.fn() } } as any;
  const file = { filename: 'test.spec', status: 'added' as const, sha: 'dummy' } as any;

  const result = await checkPackager({ context: {} as any, app, file, specContent: specContentWithPackager });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toEqual([]);
});
