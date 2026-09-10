import * as cp from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("../../src/config", () => ({
  getConfig: mocks.getConfig
}));

vi.mock("../../src/utils", () => ({
  getPathFromStr: (value: string) => value.replace(/\\/g, "/"),
  isValidCommitHash: (hash: string) => /^[0-9a-f]{4,40}$/i.test(hash)
}));

import { DataSource } from "../../src/dataSource";

function mockProcess(stdout = "", code = 0) {
  return {
    stdout: {
      on: vi.fn((event: string, handler: (value: string) => void) => {
        if (event === "data" && stdout !== "") handler(stdout);
      })
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, handler: (value?: unknown) => void) => {
      if (event === "close") handler(code);
    })
  };
}

describe("DataSource external diff tool lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({
      gitPath: () => "git",
      dateType: () => "Author Date",
      useMailmap: () => false,
      showSignatureStatus: () => false
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers a configured GUI tool and parses values without a shell", async () => {
    vi.mocked(cp.spawn).mockImplementation(
      () =>
        mockProcess(
          "diff.guitool\nKDiff3; kdiff3 --pathless $(rm -rf /)\0diff.tool\nmeld\0"
        ) as never
    );
    const dataSource = new DataSource();

    await expect(dataSource.getDiffTool("/test/repo")).resolves.toEqual({
      mode: "gui",
      name: "KDiff3; kdiff3 --pathless $(rm -rf /)"
    });
    expect(cp.spawn).toHaveBeenCalledWith(
      "git",
      ["config", "--null", "--get-regexp", "^(diff)\\.(guitool|tool)$"],
      expect.objectContaining({ cwd: "/test/repo" })
    );
  });

  it("falls back to the terminal tool", async () => {
    vi.mocked(cp.spawn).mockImplementation(() => mockProcess("diff.tool\nmeld\0") as never);
    const dataSource = new DataSource();

    await expect(dataSource.getDiffTool("/test/repo")).resolves.toEqual({
      mode: "terminal",
      name: "meld"
    });
  });

  it("returns null when no diff tool is configured", async () => {
    vi.mocked(cp.spawn).mockImplementation(() => mockProcess("", 1) as never);
    const dataSource = new DataSource();

    await expect(dataSource.getDiffTool("/test/repo")).resolves.toBeNull();
  });
});
