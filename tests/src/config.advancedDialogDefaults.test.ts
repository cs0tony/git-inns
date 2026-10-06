import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();

vi.mock("vscode", () => ({
  ViewColumn: {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockGet
    }))
  }
}));

import { getConfig } from "../../src/config";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  contributes: {
    configuration: {
      properties: Record<string, { default: unknown }>;
    };
  };
};

function packageDefault(key: string): unknown {
  return packageJson.contributes.configuration.properties[`git-keizu.dialog.${key}`].default;
}

describe("advanced dialog defaults", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation((_key: string, defaultValue: unknown) => defaultValue);
  });

  it("exposes fetchRemote defaults backed by their workspace settings", () => {
    expect(getConfig().dialogDefaults().fetchRemote).toEqual({
      force: packageDefault("fetchRemote.force"),
      prune: packageDefault("fetchRemote.prune"),
      pruneTags: packageDefault("fetchRemote.pruneTags")
    });
  });

  it("maps pullBranch.squash to the squashCommits workspace setting", () => {
    mockGet.mockImplementation((key: string, defaultValue: unknown) =>
      key === "dialog.pullBranch.squashCommits" ? true : defaultValue
    );

    expect(getConfig().dialogDefaults().pullBranch).toEqual({
      noFastForward: false,
      squash: true,
      rebase: false,
      ignoreDate: false
    });
  });

  it("keeps pullBranch package defaults aligned with Config fallbacks", () => {
    expect(getConfig().dialogDefaults().pullBranch).toEqual({
      noFastForward: packageDefault("pullBranch.noFastForward"),
      squash: packageDefault("pullBranch.squashCommits"),
      rebase: packageDefault("pullBranch.rebase"),
      ignoreDate: packageDefault("pullBranch.ignoreDate")
    });
  });
});
