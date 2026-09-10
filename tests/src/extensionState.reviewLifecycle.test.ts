import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock("../../src/utils", () => ({
  getPathFromStr: vi.fn((value: string) => value),
  isValidCommitHash: vi.fn((value: string) => /^[0-9a-f]{4,40}$/i.test(value))
}));

import type { ExtensionContext } from "vscode";

import { ExtensionState } from "../../src/extensionState";
import type { GitRepoSet } from "../../src/types";

const COMMIT = "abcdef123456";

function createState(initial: GitRepoSet = {}) {
  const storage = structuredClone(initial);
  const workspaceState = {
    get: vi.fn((_key: string, defaultValue: unknown) =>
      Object.keys(storage).length === 0 ? defaultValue : storage
    ),
    update: vi.fn(async (_key: string, value: GitRepoSet) => {
      const next = structuredClone(value);
      Object.keys(storage).forEach((key) => delete storage[key]);
      Object.assign(storage, next);
    })
  };
  const state = new ExtensionState({
    globalState: { get: vi.fn(), update: vi.fn() },
    globalStoragePath: "/storage",
    workspaceState
  } as unknown as ExtensionContext);

  return { state, workspaceState };
}

describe("ExtensionState workspace review lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists one active review per repository", async () => {
    const { state } = createState({
      "/one": { columnWidths: null },
      "/two": { columnWidths: null }
    });

    await state.startCodeReview("/one", "review-1", COMMIT, "abcdef654321", ["a.ts"]);
    await state.startCodeReview("/two", "review-2", COMMIT, null, ["b.ts"]);

    expect(state.getActiveCodeReviews()).toMatchObject({
      "/one": { id: "review-1" },
      "/two": { id: "review-2" }
    });
  });

  it("ends a selected review and clears only that repository", async () => {
    const { state } = createState({
      "/one": { columnWidths: null },
      "/two": { columnWidths: null }
    });
    await state.startCodeReview("/one", "review-1", COMMIT, null, ["a.ts"]);
    await state.startCodeReview("/two", "review-2", COMMIT, null, ["b.ts"]);

    await expect(state.endCodeReview("/one")).resolves.toBe(true);

    expect(state.getActiveCodeReview("/one")).toBeNull();
    expect(state.getActiveCodeReview("/two")?.id).toBe("review-2");
  });

  it("ends all reviews in one persisted transition and reports count", async () => {
    const { state, workspaceState } = createState({
      "/one": { columnWidths: null },
      "/two": { columnWidths: null },
      "/clean": { columnWidths: null }
    });
    await state.startCodeReview("/one", "review-1", COMMIT, null, ["a.ts"]);
    await state.startCodeReview("/two", "review-2", COMMIT, null, ["b.ts"]);
    workspaceState.update.mockClear();

    await expect(state.endAllCodeReviews()).resolves.toBe(2);

    expect(state.getActiveCodeReviews()).toEqual({});
    expect(workspaceState.update).toHaveBeenCalledTimes(1);
  });

  it("does not persist when all reviews are already inactive", async () => {
    const { state, workspaceState } = createState({
      "/one": { columnWidths: null }
    });

    await expect(state.endAllCodeReviews()).resolves.toBe(0);
    expect(workspaceState.update).not.toHaveBeenCalled();
  });
});
