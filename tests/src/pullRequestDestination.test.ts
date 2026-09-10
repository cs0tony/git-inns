import { describe, expect, it } from "vitest";

import { isSafePullRequestBranch } from "../../src/pullRequest";

describe("isSafePullRequestBranch", () => {
  it("accepts existing-style branch names", () => {
    expect(isSafePullRequestBranch("main")).toBe(true);
    expect(isSafePullRequestBranch("feature/one")).toBe(true);
    expect(isSafePullRequestBranch("release-1.2")).toBe(true);
  });

  it("rejects values unsafe for generated pull-request URLs", () => {
    expect(isSafePullRequestBranch(undefined)).toBe(false);
    expect(isSafePullRequestBranch("")).toBe(false);
    expect(isSafePullRequestBranch(" release")).toBe(false);
    expect(isSafePullRequestBranch("release..v1")).toBe(false);
    expect(isSafePullRequestBranch("release?x")).toBe(false);
    expect(isSafePullRequestBranch("release.lock")).toBe(false);
  });
});
