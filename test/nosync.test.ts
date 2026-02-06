import { describe, test, expect, vi, beforeEach } from "vitest";
import NosyncCommand from "../src/cmds/nosync.js";

describe("NosyncCommand", () => {
  let mockOctokit: any;
  let mockCtx: any;
  let mockBot: any;

  beforeEach(() => {
    mockOctokit = {
      issues: {
        listLabelsOnIssue: vi.fn(),
        removeLabel: vi.fn()
      }
    };

    mockCtx = {
      octokit: mockOctokit,
      issue: vi.fn().mockImplementation((overrides: any) => ({
        owner: "hiimbex",
        repo: "testing-things",
        issue_number: 1,
        ...overrides
      }))
    };

    mockBot = {};
  });

  test("removes all sync-* labels when no args provided", async () => {
    mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
      data: [
        { name: "sync-frawhide" },
        { name: "sync-f40" },
        { name: "bug" }
      ]
    });
    mockOctokit.issues.removeLabel.mockResolvedValue({});

    const cmd = new NosyncCommand();
    const result = await cmd.exec(mockCtx, mockBot, []);

    expect(result).toBe('');
    expect(mockOctokit.issues.listLabelsOnIssue).toHaveBeenCalled();
    expect(mockOctokit.issues.removeLabel).toHaveBeenCalledTimes(2);

    const removedLabels = mockOctokit.issues.removeLabel.mock.calls.map((call: any[]) => call[0].name);
    expect(removedLabels).toContain("sync-frawhide");
    expect(removedLabels).toContain("sync-f40");
  });

  test("removes specified sync labels when args provided", async () => {
    mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
      data: [
        { name: "sync-frawhide" },
        { name: "sync-f40" },
        { name: "bug" }
      ]
    });
    mockOctokit.issues.removeLabel.mockResolvedValue({});

    const cmd = new NosyncCommand();
    const result = await cmd.exec(mockCtx, mockBot, ["frawhide"]);

    expect(result).toBe('');
    expect(mockOctokit.issues.removeLabel).toHaveBeenCalledTimes(1);

    const removedLabels = mockOctokit.issues.removeLabel.mock.calls.map((call: any[]) => call[0].name);
    expect(removedLabels).toContain("sync-frawhide");
    expect(removedLabels).not.toContain("sync-f40");
  });

  test("removes multiple specified sync labels when multiple args provided", async () => {
    mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
      data: [
        { name: "sync-frawhide" },
        { name: "sync-f40" },
        { name: "sync-f41" },
        { name: "bug" }
      ]
    });
    mockOctokit.issues.removeLabel.mockResolvedValue({});

    const cmd = new NosyncCommand();
    const result = await cmd.exec(mockCtx, mockBot, ["frawhide", "f41"]);

    expect(result).toBe('');
    expect(mockOctokit.issues.removeLabel).toHaveBeenCalledTimes(2);

    const removedLabels = mockOctokit.issues.removeLabel.mock.calls.map((call: any[]) => call[0].name);
    expect(removedLabels).toContain("sync-frawhide");
    expect(removedLabels).toContain("sync-f41");
    expect(removedLabels).not.toContain("sync-f40");
  });

  test("does not remove non-matching labels", async () => {
    mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
      data: [
        { name: "sync-frawhide" },
        { name: "sync-f40" },
        { name: "bug" }
      ]
    });
    mockOctokit.issues.removeLabel.mockResolvedValue({});

    const cmd = new NosyncCommand();
    const result = await cmd.exec(mockCtx, mockBot, ["frawhide"]);

    expect(result).toBe('');
    expect(mockOctokit.issues.removeLabel).toHaveBeenCalledTimes(1);

    const removedLabels = mockOctokit.issues.removeLabel.mock.calls.map((call: any[]) => call[0].name);
    expect(removedLabels).not.toContain("sync-f40");
    expect(removedLabels).not.toContain("bug");
  });

  test("handles case where label does not exist", async () => {
    mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
      data: [
        { name: "sync-f40" },
        { name: "bug" }
      ]
    });
    mockOctokit.issues.removeLabel.mockResolvedValue({});

    const cmd = new NosyncCommand();
    const result = await cmd.exec(mockCtx, mockBot, ["nonexistent"]);

    expect(result).toBe('');
    expect(mockOctokit.issues.removeLabel).not.toHaveBeenCalled();
  });

  test("handles case with no sync labels", async () => {
    mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
      data: [
        { name: "bug" },
        { name: "enhancement" }
      ]
    });
    mockOctokit.issues.removeLabel.mockResolvedValue({});

    const cmd = new NosyncCommand();
    const result = await cmd.exec(mockCtx, mockBot, []);

    expect(result).toBe('');
    expect(mockOctokit.issues.removeLabel).not.toHaveBeenCalled();
  });
});
