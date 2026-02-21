import { test, expect, vi, beforeEach } from "vitest";
import { requestPackagerReview } from "../src/lints/requestPackagerReview.js";

vi.mock('../src/utils/rpm.js', () => ({
  runRpmspec: vi.fn()
}));

vi.mock('../src/utils/github.js', () => ({
  getGithubUsernameFromEmail: vi.fn()
}));

import { runRpmspec } from '../src/utils/rpm.js';
import { getGithubUsernameFromEmail } from '../src/utils/github.js';

const specContent = `Name:           test-package
Version:        1.0.0
Release:        1%{?dist}
Summary:        A test package
License:        MIT

%description
%{summary}`;

const baseContext = {
  pullRequest: vi.fn().mockReturnValue({}),
  octokit: {
    pulls: {
      requestReviewers: vi.fn().mockResolvedValue({})
    }
  }
} as any;

const app = { log: { info: () => { }, error: vi.fn(), warn: () => { } } } as any;
const file = { filename: 'test-package.spec', status: 'added' as const, sha: 'dummy' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

test("requests review from packager GitHub user", async () => {
  const mockRunRpmspec = runRpmspec as any;
  const mockGetGithubUsername = getGithubUsernameFromEmail as any;
  mockRunRpmspec.mockResolvedValue('Some Person <some@example.com>');
  mockGetGithubUsername.mockResolvedValue('someuser');

  await requestPackagerReview({ context: baseContext, app, file, specContent });

  expect(baseContext.octokit.pulls.requestReviewers).toHaveBeenCalled();
});

test("does nothing when packager is missing", async () => {
  const mockRunRpmspec = runRpmspec as any;
  mockRunRpmspec.mockResolvedValue('(none)');

  await requestPackagerReview({ context: baseContext, app, file, specContent });

  expect(baseContext.octokit.pulls.requestReviewers).not.toHaveBeenCalled();
});

test("does nothing when packager email has no GitHub user", async () => {
  const mockRunRpmspec = runRpmspec as any;
  const mockGetGithubUsername = getGithubUsernameFromEmail as any;
  mockRunRpmspec.mockResolvedValue('Some Person <some@example.com>');
  mockGetGithubUsername.mockResolvedValue(null);

  await requestPackagerReview({ context: baseContext, app, file, specContent });

  expect(baseContext.octokit.pulls.requestReviewers).not.toHaveBeenCalled();
});
