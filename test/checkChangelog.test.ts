import { test, expect, vi } from "vitest";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specContent = fs.readFileSync(path.join(__dirname, 'anda-srpm-macros.spec'), 'utf8');

vi.mock('../src/utils/rpm.js', () => ({
  runRpmspec: vi.fn()
}));

import { checkChangelog } from '../src/lints/checkChangelog.js';
import { runRpmspec } from '../src/utils/rpm.js';

test("suggests replacing %autochangelog with proper changelog", async () => {
  const mockRunRpmspec = runRpmspec as any;
  mockRunRpmspec.mockResolvedValueOnce('some packager <some_packager@example.com>');
  mockRunRpmspec.mockResolvedValueOnce('0.2.29-1');

  const app = { log: { info: vi.fn(), error: vi.fn() } } as any;
  const file = { filename: 'test.spec', status: 'added' as const, sha: 'dummy' } as any;

  const result = await checkChangelog({ context: {} as any, app, file, specContent });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toHaveLength(1);
  expect(result.reviewComments[0].body).toContain('`%autochangelog` is not supported in Terra');
  expect(result.reviewComments[0].body).toContain('some packager <some_packager@example.com>');
});

test("suggests adding changelog when missing", async () => {
  const modifiedSpecContent = specContent.replace('%autochangelog', '').trim();

  const mockRunRpmspec = runRpmspec as any;
  mockRunRpmspec.mockResolvedValueOnce('(none) (none)'); // changelogQuery
  mockRunRpmspec.mockResolvedValueOnce('some packager <some_packager@example.com>');
  mockRunRpmspec.mockResolvedValueOnce('0.2.29-1');

  const app = { log: { info: vi.fn(), error: vi.fn() } } as any;
  const file = { filename: 'test.spec', status: 'added' as const, sha: 'dummy' } as any;

  const result = await checkChangelog({ context: {} as any, app, file, specContent: modifiedSpecContent });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toHaveLength(1);
  expect(result.reviewComments[0].position).toEqual(44);
  expect(result.reviewComments[0].body).toContain('Missing changelog');
  expect(result.reviewComments[0].body).toContain('some packager <some_packager@example.com>');
});

test("returns empty for file with existing changelog", async () => {
  const modifiedSpecContent = specContent.replace('%autochangelog', '%changelog\n* Tue Jan 02 2024 some packager <some_packager@example.com> - 0.2.29-1\n- Initial package');

  const app = { log: { info: vi.fn(), error: vi.fn() } } as any;
  const file = { filename: 'test.spec', status: 'added' as const, sha: 'dummy' } as any;

  const result = await checkChangelog({ context: {} as any, app, file, specContent: modifiedSpecContent });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toHaveLength(0);
});

test("returns empty for non-added file", async () => {
  const app = { log: { info: vi.fn(), error: vi.fn() } } as any;
  const file = { filename: 'test.spec', status: 'modified' as const, sha: 'dummy' } as any;

  const result = await checkChangelog({ context: {} as any, app, file, specContent });

  expect(result.messages).toEqual([]);
  expect(result.reviewComments).toHaveLength(0);
});
