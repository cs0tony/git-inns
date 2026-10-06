import * as cp from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configValues = vi.hoisted(() => ({
  fetchAndPruneTags: false,
  includeCommitsMentionedByReflogs: false,
  onlyFollowFirstParent: false,
  showSignatureStatus: false,
  useMailmap: false
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn()
  }
}));

vi.mock("../../src/config", () => ({
  CUSTOM_BRANCH_GLOB_ARGUMENT_PREFIX: "--glob=",
  getConfig: vi.fn(() => ({
    dateType: () => "Author Date",
    fetchAndPruneTags: () => configValues.fetchAndPruneTags,
    customBranchGlobArguments: () => [],
    includeCommitsMentionedByReflogs: () => configValues.includeCommitsMentionedByReflogs,
    onlyFollowFirstParent: () => configValues.onlyFollowFirstParent,
    showSignatureStatus: () => configValues.showSignatureStatus,
    useMailmap: () => configValues.useMailmap
  }))
}));

vi.mock("../../src/gitExecutable", () => ({
  DEFAULT_GIT_PATH: "git",
  resolveGitExecutable: vi.fn(async () => "git")
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

import { DataSource, parseGitSignatureStatus } from "../../src/dataSource";
import { DEFAULT_REPOSITORY_VISIBILITY } from "../../src/repositoryVisibility";
import type { ArchiveFormat, CommitOrdering, GitCommit } from "../../src/types";

const REPO = "/test/repo";
const HASH = "abc123def456";
const SEP = "XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb";
const SPAWN_OPTS = { cwd: REPO, env: { ...process.env, LC_ALL: "C" } };

function resetConfig() {
  configValues.fetchAndPruneTags = false;
  configValues.includeCommitsMentionedByReflogs = false;
  configValues.onlyFollowFirstParent = false;
  configValues.showSignatureStatus = false;
  configValues.useMailmap = false;
}

function mockProcess(stdout = "", exitCode = 0) {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const proc = new EventEmitter();
  Object.assign(proc, { stdout: stdoutEmitter, stderr: stderrEmitter });
  queueMicrotask(() => {
    if (stdout !== "") stdoutEmitter.emit("data", stdout);
    proc.emit("close", exitCode);
  });
  return proc as unknown as cp.ChildProcess;
}

function defaultLogFormat() {
  return ["%H", "%P", "%an", "%ae", "%at", "%s"].join(SEP);
}

function mailmapLogFormat() {
  return ["%H", "%P", "%aN", "%aE", "%at", "%s"].join(SEP);
}

function commitDetailsFormat(withSignature: boolean) {
  const fields = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce"];
  if (withSignature) fields.push("%G?", "%GK", "%GS", "%GF", "%GP", "%GT");
  return `--format=${fields.join(SEP)}%n%B`;
}

function getPrivateLogMethod(ds: DataSource) {
  return (
    ds as unknown as {
      getGitLog: (
        repo: string,
        branches: string[],
        count: number,
        showRemoteBranches: boolean,
        authors: string[],
        commitOrdering: CommitOrdering,
        visibility: typeof DEFAULT_REPOSITORY_VISIBILITY
      ) => Promise<GitCommit[]>;
    }
  ).getGitLog.bind(ds);
}

describe("graph parity backend foundation", () => {
  const spawnMock = vi.mocked(cp.spawn);

  beforeEach(() => {
    resetConfig();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds prune-tags to fetch only when enabled", async () => {
    spawnMock.mockImplementation(() => mockProcess());
    const ds = new DataSource();

    await expect(ds.fetch(REPO)).resolves.toBeNull();
    expect(spawnMock).toHaveBeenLastCalledWith("git", ["fetch", "--all", "--prune"], SPAWN_OPTS);

    configValues.fetchAndPruneTags = true;
    await expect(ds.fetch(REPO)).resolves.toBeNull();
    expect(spawnMock).toHaveBeenLastCalledWith(
      "git",
      ["fetch", "--all", "--prune", "--prune-tags"],
      SPAWN_OPTS
    );
  });

  it("constructs log options from parity settings", async () => {
    spawnMock.mockImplementation(() => mockProcess());
    const ds = new DataSource();
    const getGitLog = getPrivateLogMethod(ds);

    await getGitLog(REPO, [], 10, false, [], "date", DEFAULT_REPOSITORY_VISIBILITY);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "git",
      [
        "log",
        "--max-count=10",
        `--format=${defaultLogFormat()}`,
        "--date-order",
        "--branches",
        "--tags"
      ],
      SPAWN_OPTS
    );

    configValues.includeCommitsMentionedByReflogs = true;
    configValues.onlyFollowFirstParent = true;
    await getGitLog(REPO, [], 10, false, [], "date", DEFAULT_REPOSITORY_VISIBILITY);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "git",
      [
        "log",
        "--max-count=10",
        `--format=${defaultLogFormat()}`,
        "--date-order",
        "--first-parent",
        "--reflog",
        "--branches",
        "--tags"
      ],
      SPAWN_OPTS
    );

    await getGitLog(REPO, ["main"], 10, false, [], "date", DEFAULT_REPOSITORY_VISIBILITY);
    const args = vi.mocked(cp.spawn).mock.lastCall![1] as string[];
    expect(args).toContain("--first-parent");
    expect(args).not.toContain("--reflog");
  });

  it("uses mailmap-aware placeholders only when configured", async () => {
    spawnMock.mockImplementation(() => mockProcess());
    const disabled = getPrivateLogMethod(new DataSource());
    await disabled(REPO, [], 10, false, [], "date", DEFAULT_REPOSITORY_VISIBILITY);
    expect(String(vi.mocked(cp.spawn).mock.lastCall![1])).toContain(
      `--format=${defaultLogFormat()}`
    );

    configValues.useMailmap = true;
    const enabled = getPrivateLogMethod(new DataSource());
    await enabled(REPO, [], 10, false, [], "date", DEFAULT_REPOSITORY_VISIBILITY);
    expect(String(vi.mocked(cp.spawn).mock.lastCall![1])).toContain(
      `--format=${mailmapLogFormat()}`
    );
  });

  it("parses signature fields returned by Git", () => {
    expect(parseGitSignatureStatus(["G", "KEY", "Signer", "FP", "PRIMARY", "ultimate"])).toEqual({
      fingerprint: "FP",
      key: "KEY",
      primaryKeyFingerprint: "PRIMARY",
      signer: "Signer",
      status: "G",
      trustLevel: "ultimate"
    });
    expect(parseGitSignatureStatus(["N", "", "", "", "", ""])).toEqual({
      fingerprint: "",
      key: "",
      primaryKeyFingerprint: "",
      signer: "",
      status: "N",
      trustLevel: ""
    });
    expect(parseGitSignatureStatus([])).toBeNull();
  });

  it("parses signature details only when the setting is enabled", async () => {
    const baseFields = [
      HASH,
      "parent1",
      "Author",
      "author@example.com",
      "1700000000",
      "Committer",
      "committer@example.com"
    ];
    const signatureFields = ["G", "KEY", "Signer", "FP", "PRIMARY", "ultimate"];
    let showFormat: string | undefined;

    spawnMock.mockImplementation(() => mockProcess(`${baseFields.join(SEP)}\nBody\n`));
    const disabledDetails = await new DataSource().commitDetails(REPO, HASH, false, false);
    expect(disabledDetails?.signature).toBeNull();
    showFormat = vi
      .mocked(cp.spawn)
      .mock.calls.find((call) => (call[1] as string[])[0] === "show")![1]
      .find((arg) => String(arg).startsWith("--format="));
    expect(showFormat).toBe(commitDetailsFormat(false));

    spawnMock.mockImplementation(() =>
      mockProcess(`${[...baseFields, ...signatureFields].join(SEP)}\nBody\n`)
    );
    configValues.showSignatureStatus = true;
    spawnMock.mockClear();
    const details = await new DataSource().commitDetails(REPO, HASH, false, false);
    expect(details).not.toBeNull();
    showFormat = vi
      .mocked(cp.spawn)
      .mock.calls.find((call) => (call[1] as string[])[0] === "show")![1]
      .find((arg) => String(arg).startsWith("--format="));
    expect(showFormat).toBe(commitDetailsFormat(true));
    expect(details?.signature).toEqual(parseGitSignatureStatus(signatureFields));
  });

  it("rejects unsafe dropCommit requests and uses the safe rebase flow", async () => {
    spawnMock.mockImplementation((_command, args) =>
      mockProcess((args as string[])[0] === "rev-list" ? `${HASH} parent1\n` : "")
    );
    const ds = new DataSource();

    await expect(ds.dropCommit(REPO, "not-a-hash!")).resolves.toBe("Invalid commit hash.");
    expect(spawnMock).not.toHaveBeenCalled();

    await expect(ds.dropCommit(REPO, HASH)).resolves.toBeNull();
    expect(spawnMock).toHaveBeenLastCalledWith(
      "git",
      ["rebase", "--onto", `${HASH}^`, HASH],
      SPAWN_OPTS
    );

    spawnMock.mockImplementation(() => mockProcess(`${HASH} parent1 parent2\n`));
    await expect(ds.dropCommit(REPO, HASH)).resolves.toBe(
      "Only non-merge commits with a parent can be dropped."
    );
  });

  it("validates resetFileToRevision input before restoring", async () => {
    spawnMock.mockImplementation(() => mockProcess());
    const ds = new DataSource();

    await expect(ds.resetFileToRevision(REPO, "--all", "file.txt")).resolves.toBe(
      "Invalid revision."
    );
    await expect(ds.resetFileToRevision(REPO, HASH, "../outside.txt")).resolves.toBe(
      "Invalid file path."
    );
    expect(spawnMock).not.toHaveBeenCalled();

    await expect(ds.resetFileToRevision(REPO, HASH, "src/file.txt")).resolves.toBeNull();
    expect(spawnMock).toHaveBeenLastCalledWith(
      "git",
      ["checkout", HASH, "--", "src/file.txt"],
      SPAWN_OPTS
    );
  });

  it("validates archive format and output before writing through Git", async () => {
    spawnMock.mockImplementation(() => mockProcess());
    const ds = new DataSource();

    await expect(ds.createArchive(REPO, "bad-hash", "zip", "/tmp/archive.zip")).resolves.toBe(
      "Invalid commit hash."
    );
    await expect(
      ds.createArchive(REPO, HASH, "exe" as ArchiveFormat, "/tmp/archive.exe")
    ).resolves.toBe("Invalid archive output path.");
    await expect(ds.createArchive(REPO, HASH, "zip", "archive.zip")).resolves.toBe(
      "Invalid archive output path."
    );
    await expect(ds.createArchive(REPO, HASH, "zip", `${REPO}/archive.zip`)).resolves.toBe(
      "Invalid archive output path."
    );
    expect(spawnMock).not.toHaveBeenCalled();

    for (const format of ["zip", "tar", "tar.gz"] as ArchiveFormat[]) {
      const outputPath = `/tmp/archive.${format}`;
      await expect(ds.createArchive(REPO, HASH, format, outputPath)).resolves.toBeNull();
      expect(spawnMock).toHaveBeenLastCalledWith(
        "git",
        ["archive", `--format=${format}`, `--output=${outputPath}`, HASH],
        SPAWN_OPTS
      );
    }
  });
});
