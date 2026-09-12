import { describe, expect, it } from "vitest";

import {
  appendVisibilityGitArgs,
  DEFAULT_REPOSITORY_VISIBILITY,
  filterRemoteHeadRefs,
  normalizeRepositoryVisibility,
  shouldIncludeUntrackedFiles
} from "../../src/repositoryVisibility";

describe("repository visibility", () => {
  it("exposes all-visible defaults", () => {
    expect(DEFAULT_REPOSITORY_VISIBILITY).toEqual({
      showTags: true,
      showStashes: true,
      showRemoteHeads: true,
      showUntrackedFiles: true
    });
  });

  it("normalizes every field independently and preserves valid booleans", () => {
    expect(
      normalizeRepositoryVisibility({
        showTags: false,
        showStashes: "yes",
        showRemoteHeads: null,
        showUntrackedFiles: true
      })
    ).toEqual({
      showTags: false,
      showStashes: true,
      showRemoteHeads: true,
      showUntrackedFiles: true
    });

    expect(
      normalizeRepositoryVisibility({
        showTags: 1,
        showStashes: false,
        showRemoteHeads: 0,
        showUntrackedFiles: ""
      })
    ).toEqual({
      showTags: true,
      showStashes: false,
      showRemoteHeads: true,
      showUntrackedFiles: true
    });
  });

  it("normalizes missing and non-object values to defaults", () => {
    expect(normalizeRepositoryVisibility(null)).toEqual(DEFAULT_REPOSITORY_VISIBILITY);
    expect(normalizeRepositoryVisibility(undefined)).toEqual(DEFAULT_REPOSITORY_VISIBILITY);
    expect(normalizeRepositoryVisibility("visible")).toEqual(DEFAULT_REPOSITORY_VISIBILITY);
    expect(normalizeRepositoryVisibility([])).toEqual(DEFAULT_REPOSITORY_VISIBILITY);
  });

  it("appends only the flags required by visibility settings", () => {
    const args = ["log", "--max-count=100"];

    expect(
      appendVisibilityGitArgs(args, {
        showTags: false,
        showStashes: true,
        showRemoteHeads: true,
        showUntrackedFiles: true
      })
    ).toEqual(["log", "--max-count=100", "--no-tags", "--all"]);

    expect(
      appendVisibilityGitArgs(args, {
        showTags: true,
        showStashes: false,
        showRemoteHeads: true,
        showUntrackedFiles: true
      })
    ).toEqual(["log", "--max-count=100"]);
    expect(args).toEqual(["log", "--max-count=100"]);
  });

  it("does not duplicate visibility flags that are already present", () => {
    const args = ["log", "--no-tags", "--all"];

    expect(
      appendVisibilityGitArgs(args, {
        showTags: false,
        showStashes: true,
        showRemoteHeads: false,
        showUntrackedFiles: false
      })
    ).toEqual(["log", "--no-tags", "--all"]);
    expect(args).toEqual(["log", "--no-tags", "--all"]);
  });

  it("filters remote-head refs while retaining local refs and input order", () => {
    const refs = [
      { name: "main", remote: false },
      { name: "origin/main", remote: true },
      { name: "feature/no-remote-flag" }
    ];

    expect(
      filterRemoteHeadRefs(refs, {
        showTags: true,
        showStashes: true,
        showRemoteHeads: false,
        showUntrackedFiles: true
      })
    ).toEqual([refs[0], refs[2]]);

    expect(
      filterRemoteHeadRefs(refs, {
        showTags: true,
        showStashes: true,
        showRemoteHeads: true,
        showUntrackedFiles: true
      })
    ).toEqual(refs);
    expect(refs).toHaveLength(3);
  });

  it("reports whether untracked files should be included", () => {
    expect(
      shouldIncludeUntrackedFiles({
        showTags: true,
        showStashes: true,
        showRemoteHeads: true,
        showUntrackedFiles: false
      })
    ).toBe(false);

    expect(
      shouldIncludeUntrackedFiles({
        showTags: false,
        showStashes: false,
        showRemoteHeads: false,
        showUntrackedFiles: true
      })
    ).toBe(true);
  });
});
