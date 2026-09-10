import { describe, expect, it } from "vitest";

import { buildExternalDirDiffArgs, buildQuotedExternalDiffCommand } from "../../src/externalDiff";
import { UNCOMMITTED_CHANGES_HASH } from "../../src/types";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("external directory diff target arguments", () => {
  it("builds a commit self-diff", () => {
    expect(buildExternalDirDiffArgs(HASH_A, HASH_A)).toEqual([
      "difftool",
      "--dir-diff",
      `${HASH_A}^..${HASH_A}`
    ]);
  });

  it("builds an uncommitted self-diff", () => {
    expect(buildExternalDirDiffArgs(UNCOMMITTED_CHANGES_HASH, UNCOMMITTED_CHANGES_HASH)).toEqual([
      "difftool",
      "--dir-diff",
      "HEAD"
    ]);
  });

  it("builds a commit-to-working-tree diff using the existing uncommitted normalization", () => {
    expect(buildExternalDirDiffArgs(UNCOMMITTED_CHANGES_HASH, HASH_A)).toEqual([
      "difftool",
      "--dir-diff",
      HASH_A
    ]);
  });

  it("builds a commit-to-commit range diff", () => {
    expect(buildExternalDirDiffArgs(HASH_A, HASH_B)).toEqual([
      "difftool",
      "--dir-diff",
      `${HASH_A}..${HASH_B}`
    ]);
  });

  it("rejects targets outside the existing uncommitted normalization", () => {
    expect(buildExternalDirDiffArgs(HASH_A, UNCOMMITTED_CHANGES_HASH)).toBeNull();
    expect(buildExternalDirDiffArgs("HEAD", HASH_A)).toBeNull();
    expect(buildExternalDirDiffArgs(HASH_A, "HEAD")).toBeNull();
    expect(buildExternalDirDiffArgs("", HASH_A)).toBeNull();
    expect(buildExternalDirDiffArgs(`${HASH_A}..${HASH_B}`, HASH_A)).toBeNull();
  });
});

describe("quoted terminal external diff command", () => {
  it("quotes each argument without interpreting repository-controlled values", () => {
    expect(buildQuotedExternalDiffCommand(["difftool", "--dir-diff", `${HASH_A}..${HASH_B}`])).toBe(
      `git difftool --dir-diff ${HASH_A}..${HASH_B}`
    );
    expect(buildQuotedExternalDiffCommand(["difftool", "--dir-diff", "HEAD"])).toBe(
      "git difftool --dir-diff HEAD"
    );
    expect(buildQuotedExternalDiffCommand(["difftool", "--dir-diff", "a b'; rm -rf /"])).toBe(
      "git difftool --dir-diff 'a b'\\''; rm -rf /'"
    );
  });
});
