import { describe, expect, it } from "vitest";

import {
  type BranchOptions,
  type FetchOptions,
  normalizeAdvancedOperationOptions,
  type OperationOptionMap,
  type PullOptions,
  type StashOptions,
  type TagOptions,
  toGitArgumentTokens
} from "../../web/advancedOperationOptions";

describe("advanced operation option normalization", () => {
  it("normalizes tag options and preserves valid booleans", () => {
    expect(normalizeAdvancedOperationOptions("tag", undefined)).toEqual<TagOptions>({
      annotated: true,
      pushToRemote: false
    });
    expect(
      normalizeAdvancedOperationOptions("tag", {
        annotated: false,
        pushToRemote: true
      })
    ).toEqual<TagOptions>({
      annotated: false,
      pushToRemote: true
    });
  });

  it("normalizes branch options and preserves valid booleans", () => {
    expect(normalizeAdvancedOperationOptions("branch", null)).toEqual<BranchOptions>({
      checkOut: true,
      forceDelete: false
    });
    expect(
      normalizeAdvancedOperationOptions("branch", {
        checkOut: false,
        forceDelete: true
      })
    ).toEqual<BranchOptions>({
      checkOut: false,
      forceDelete: true
    });
  });

  it("normalizes fetch options and preserves valid booleans", () => {
    expect(normalizeAdvancedOperationOptions("fetch", "invalid")).toEqual<FetchOptions>({
      force: false,
      prune: false,
      pruneTags: false
    });
    expect(
      normalizeAdvancedOperationOptions("fetch", {
        force: true,
        prune: true,
        pruneTags: true
      })
    ).toEqual<FetchOptions>({
      force: true,
      prune: true,
      pruneTags: true
    });
  });

  it("normalizes pull options and preserves valid booleans", () => {
    expect(normalizeAdvancedOperationOptions("pull", 42)).toEqual<PullOptions>({
      noFastForward: false,
      squash: false,
      rebase: false,
      ignoreDate: false
    });
    expect(
      normalizeAdvancedOperationOptions("pull", {
        noFastForward: true,
        squash: true,
        rebase: true,
        ignoreDate: true
      })
    ).toEqual<PullOptions>({
      noFastForward: true,
      squash: true,
      rebase: true,
      ignoreDate: true
    });
  });

  it("normalizes stash options and preserves valid booleans", () => {
    expect(normalizeAdvancedOperationOptions("stash", [])).toEqual<StashOptions>({
      reinstateIndex: false,
      includeUntracked: false
    });
    expect(
      normalizeAdvancedOperationOptions("stash", {
        reinstateIndex: true,
        includeUntracked: true
      })
    ).toEqual<StashOptions>({
      reinstateIndex: true,
      includeUntracked: true
    });
  });

  it("rejects each invalid boolean independently and ignores unknown fields", () => {
    expect(
      normalizeAdvancedOperationOptions("tag", {
        annotated: "true",
        pushToRemote: 1,
        unsupported: true
      })
    ).toEqual<TagOptions>({ annotated: true, pushToRemote: false });
    expect(
      normalizeAdvancedOperationOptions("branch", {
        checkOut: null,
        forceDelete: "yes"
      })
    ).toEqual<BranchOptions>({ checkOut: true, forceDelete: false });
    expect(
      normalizeAdvancedOperationOptions("fetch", {
        force: 0,
        prune: "",
        pruneTags: undefined
      })
    ).toEqual<FetchOptions>({ force: false, prune: false, pruneTags: false });
    expect(
      normalizeAdvancedOperationOptions("pull", {
        noFastForward: Symbol.for("invalid"),
        squash: NaN,
        rebase: {},
        ignoreDate: false
      })
    ).toEqual<PullOptions>({
      noFastForward: false,
      squash: false,
      rebase: false,
      ignoreDate: false
    });
    expect(
      normalizeAdvancedOperationOptions("stash", {
        reinstateIndex: null,
        includeUntracked: new Date(0)
      })
    ).toEqual<StashOptions>({ reinstateIndex: false, includeUntracked: false });
  });
});

describe("advanced operation git argument tokens", () => {
  it("maps every true option to its git token in stable order", () => {
    const options: OperationOptionMap = {
      tag: { annotated: true, pushToRemote: true },
      branch: { checkOut: true, forceDelete: true },
      fetch: { force: true, prune: true, pruneTags: true },
      pull: {
        noFastForward: true,
        squash: true,
        rebase: true,
        ignoreDate: true
      },
      stash: { reinstateIndex: true, includeUntracked: true }
    };

    expect(toGitArgumentTokens("tag", options.tag)).toEqual(["--annotated", "--push"]);
    expect(toGitArgumentTokens("branch", options.branch)).toEqual(["--checkout", "--force-delete"]);
    expect(toGitArgumentTokens("fetch", options.fetch)).toEqual([
      "--force",
      "--prune",
      "--prune-tags"
    ]);
    expect(toGitArgumentTokens("pull", options.pull)).toEqual([
      "--no-ff",
      "--squash",
      "--rebase",
      "--ignore-date"
    ]);
    expect(toGitArgumentTokens("stash", options.stash)).toEqual(["--index", "--include-untracked"]);
  });

  it("omits every false option", () => {
    const options: OperationOptionMap = {
      tag: { annotated: false, pushToRemote: true },
      branch: { checkOut: false, forceDelete: true },
      fetch: { force: false, prune: true, pruneTags: false },
      pull: {
        noFastForward: true,
        squash: false,
        rebase: true,
        ignoreDate: false
      },
      stash: { reinstateIndex: false, includeUntracked: true }
    };

    expect(toGitArgumentTokens("tag", options.tag)).toEqual(["--push"]);
    expect(toGitArgumentTokens("branch", options.branch)).toEqual(["--force-delete"]);
    expect(toGitArgumentTokens("fetch", options.fetch)).toEqual(["--prune"]);
    expect(toGitArgumentTokens("pull", options.pull)).toEqual(["--no-ff", "--rebase"]);
    expect(toGitArgumentTokens("stash", options.stash)).toEqual(["--include-untracked"]);
  });
});
