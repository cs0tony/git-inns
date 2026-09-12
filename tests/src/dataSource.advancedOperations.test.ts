import * as cp from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn()
    }))
  }
}));

const fetchAndPruneTagsMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../src/config", () => ({
  CUSTOM_BRANCH_GLOB_ARGUMENT_PREFIX: "--glob=",
  getConfig: vi.fn(() => ({
    gitPath: () => ["git"],
    dateType: () => "Author Date",
    fetchAndPruneTags: fetchAndPruneTagsMock,
    useMailmap: () => false,
    showSignatureStatus: () => false
  }))
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

import * as configModule from "../../src/config";
import { DataSource } from "../../src/dataSource";

const REPO = "/test/repo";
const SPAWN_OPTIONS = { cwd: REPO, env: { ...process.env, LC_ALL: "C" } };

function createSuccessfulProcess() {
  const process = new EventEmitter();
  Object.assign(process, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  });

  queueMicrotask(() => {
    process.emit("close", 0);
  });
  return process;
}

describe("DataSource advanced fetch and pull options", () => {
  const spawnMock = vi.mocked(cp.spawn);
  let dataSource: DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configModule.getConfig).mockClear();
    fetchAndPruneTagsMock.mockReturnValue(false);
    spawnMock.mockImplementation(() => createSuccessfulProcess() as cp.ChildProcess);
    dataSource = new DataSource();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves legacy all-remote pruning behavior when fetch options are absent", async () => {
    await dataSource.fetch(REPO);

    expect(spawnMock).toHaveBeenCalledWith("git", ["fetch", "--all", "--prune"], SPAWN_OPTIONS);
  });

  it("builds fetch arguments only from explicitly provided options", async () => {
    await dataSource.fetch(REPO, { force: true, prune: false, pruneTags: true });

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["fetch", "--all", "--force", "--prune-tags"],
      SPAWN_OPTIONS
    );
    expect(fetchAndPruneTagsMock).not.toHaveBeenCalled();
  });

  it("normalizes malformed fetch values to false", async () => {
    await dataSource.fetch(REPO, {
      force: "yes",
      prune: 1,
      pruneTags: true
    } as unknown as Parameters<DataSource["fetch"]>[1]);

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["fetch", "--all", "--prune-tags"],
      SPAWN_OPTIONS
    );
  });

  it("builds pull arguments for compatible options", async () => {
    await dataSource.pull(REPO, { rebase: true, ignoreDate: true });

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["pull", "--rebase", "--ignore-date"],
      SPAWN_OPTIONS
    );
  });

  it("normalizes missing pull values to false", async () => {
    await dataSource.pull(REPO);

    expect(spawnMock).toHaveBeenCalledWith("git", ["pull"], SPAWN_OPTIONS);
  });

  it("rejects multiple pull integration modes without invoking Git", async () => {
    const result = await dataSource.pull(REPO, {
      noFastForward: true,
      squash: true,
      rebase: true
    });

    expect(result).toBe("At most one of no-fast-forward, squash, or rebase may be selected.");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects ignore-date without rebase without invoking Git", async () => {
    const result = await dataSource.pull(REPO, { ignoreDate: true });

    expect(result).toBe("Ignore date may only be used with rebase.");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
