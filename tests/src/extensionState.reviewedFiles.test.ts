import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock("../../src/utils", () => ({
  getPathFromStr: vi.fn((value: string) => value.replace(/\\/g, "/")),
  isValidCommitHash: vi.fn((value: string) => /^[0-9a-f]{4,40}$/i.test(value))
}));

import type { ExtensionContext } from "vscode";

import { ExtensionState } from "../../src/extensionState";
import type { ReviewedFilesByRepo } from "../../src/types";

const COMMIT_HASH = "abc123def456";

interface MockMemento {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createState(storage: ReviewedFilesByRepo = {}) {
  const workspaceState: MockMemento = {
    get: vi.fn((_key: string, defaultValue: ReviewedFilesByRepo) => {
      if (Object.keys(storage).length === 0) return defaultValue;
      return storage;
    }),
    update: vi.fn(async (_key: string, value: ReviewedFilesByRepo) => {
      const next = structuredClone(value);
      Object.keys(storage).forEach((key) => delete storage[key]);
      Object.assign(storage, next);
    })
  };

  const state = new ExtensionState({
    globalState: { get: vi.fn(), update: vi.fn() },
    workspaceState,
    globalStoragePath: "/storage"
  } as unknown as ExtensionContext);

  return { state, workspaceState };
}

describe("ExtensionState reviewed files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes, deduplicates, and sorts reviewed paths", async () => {
    const { state } = createState();

    await state.setFileReviewed("/repo", COMMIT_HASH, "b.ts", true);

    expect(state.getReviewedFiles("/repo", COMMIT_HASH)).toEqual(["b.ts"]);
  });

  it("persists valid repository-relative paths and returns the sorted unique set", async () => {
    const { state } = createState();

    await state.setFileReviewed("/repo", COMMIT_HASH, "a.ts", true);
    await state.setFileReviewed("/repo", COMMIT_HASH, "b.ts", true);

    expect(state.getReviewedFiles("/repo", COMMIT_HASH)).toEqual(["a.ts", "b.ts"]);
  });

  it("normalizes backslashes and removes a file without leaving empty state", async () => {
    const storage: ReviewedFilesByRepo = {
      "/repo": { [COMMIT_HASH]: ["a.ts", "src\\b.ts"] }
    };
    const { state, workspaceState } = createState(storage);

    await state.setFileReviewed("/repo", COMMIT_HASH, "src/b.ts", false);

    expect(state.getReviewedFiles("/repo", COMMIT_HASH)).toEqual(["a.ts"]);
    expect(workspaceState.update).toHaveBeenCalledWith("reviewedFiles", {
      "/repo": { [COMMIT_HASH]: ["a.ts"] }
    });
  });

  it("rejects empty, absolute, traversal, and control-character paths", async () => {
    const storage: ReviewedFilesByRepo = {
      "/repo": { [COMMIT_HASH]: ["a.ts"] }
    };
    const { state } = createState(storage);

    for (const filePath of ["", "/a.ts", "C:/a.ts", "../a.ts", "a/../a.ts", "a\u0000.ts"]) {
      await expect(state.setFileReviewed("/repo", COMMIT_HASH, filePath, true)).resolves.toBe(
        false
      );
    }

    expect(state.getReviewedFiles("/repo", COMMIT_HASH)).toEqual(["a.ts"]);
  });

  it("rejects invalid commit hashes and repositories", async () => {
    const { state } = createState();

    await expect(state.setFileReviewed("/repo", "*", "a.ts", true)).resolves.toBe(false);
    await expect(state.setFileReviewed("", COMMIT_HASH, "a.ts", true)).resolves.toBe(false);
    expect(state.getReviewedFiles("/repo", "bad")).toEqual([]);
    expect(state.getReviewedFiles("", COMMIT_HASH)).toEqual([]);
  });

  it("reports a persistence failure without claiming success", async () => {
    const { state, workspaceState } = createState();
    workspaceState.update.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(state.setFileReviewed("/repo", COMMIT_HASH, "a.ts", true)).resolves.toBe(false);
    expect(state.getReviewedFiles("/repo", COMMIT_HASH)).toEqual([]);
  });
});

describe("ExtensionState active code review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts, persists, and ends a normalized review", async () => {
    const { state } = createState();
    await state.setFileReviewed("/repo", COMMIT_HASH, "b.ts", true);

    const review = await state.startCodeReview("/repo", "review-1", COMMIT_HASH, null, [
      "src\\b.ts",
      "a.ts",
      "a.ts"
    ]);

    expect(review).toEqual({
      id: "review-1",
      commitHash: COMMIT_HASH,
      compareWithHash: null,
      files: ["a.ts", "src/b.ts"],
      startedAt: expect.any(Number)
    });
    expect(state.getActiveCodeReview("/repo")).toEqual(review);

    await expect(state.endCodeReview("/repo")).resolves.toBe(true);
    expect(state.getActiveCodeReview("/repo")).toBeNull();
  });

  it("rejects unsafe reviews", async () => {
    const { state } = createState();

    await expect(
      state.startCodeReview("", "review", COMMIT_HASH, null, ["a.ts"])
    ).resolves.toBeNull();
    await expect(
      state.startCodeReview("/repo", "", COMMIT_HASH, null, ["a.ts"])
    ).resolves.toBeNull();
    await expect(
      state.startCodeReview("/repo", "review", "bad", null, ["a.ts"])
    ).resolves.toBeNull();
    await expect(
      state.startCodeReview("/repo", "review", COMMIT_HASH, "../bad", ["a.ts"])
    ).resolves.toBeNull();
    await expect(
      state.startCodeReview("/repo", "review", COMMIT_HASH, null, [])
    ).resolves.toBeNull();
  });
});
