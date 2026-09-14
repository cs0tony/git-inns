import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOST_VIEW_PREFERENCES,
  findRepositoryForFilePath,
  normalizeHostViewPreferences
} from "../../src/hostViewPreferences";

describe("normalizeHostViewPreferences", () => {
  it("returns the specified defaults", () => {
    expect(DEFAULT_HOST_VIEW_PREFERENCES).toEqual({
      integratedTerminalShell: "",
      openToActiveEditorRepository: false,
      retainContextWhenHidden: true
    });
    expect(normalizeHostViewPreferences(undefined)).toEqual(DEFAULT_HOST_VIEW_PREFERENCES);
  });

  it("normalizes valid settings and trims the shell path", () => {
    expect(
      normalizeHostViewPreferences({
        integratedTerminalShell: " /bin/zsh ",
        openToActiveEditorRepository: true,
        retainContextWhenHidden: false
      })
    ).toEqual({
      integratedTerminalShell: "/bin/zsh",
      openToActiveEditorRepository: true,
      retainContextWhenHidden: false
    });
  });

  it("falls back safely for malformed and partial settings", () => {
    expect(normalizeHostViewPreferences(null)).toEqual(DEFAULT_HOST_VIEW_PREFERENCES);
    expect(
      normalizeHostViewPreferences({
        integratedTerminalShell: 42,
        openToActiveEditorRepository: "yes",
        retainContextWhenHidden: 1
      })
    ).toEqual(DEFAULT_HOST_VIEW_PREFERENCES);
    expect(
      normalizeHostViewPreferences({
        integratedTerminalShell: "/bin/sh\u0000",
        openToActiveEditorRepository: false,
        retainContextWhenHidden: true
      }).integratedTerminalShell
    ).toBe("");
  });
});

describe("findRepositoryForFilePath", () => {
  it("matches a file inside an exact registered repository", () => {
    expect(findRepositoryForFilePath(["/workspaces/repo"], "/workspaces/repo/src/index.ts")).toBe(
      "/workspaces/repo"
    );
  });

  it("uses longest-prefix matching for nested repositories", () => {
    const repositories = ["/workspaces/team", "/workspaces/team/important-repo"];

    expect(
      findRepositoryForFilePath(repositories, "/workspaces/team/important-repo/src/index.ts")
    ).toBe("/workspaces/team/important-repo");
    expect(findRepositoryForFilePath(repositories, "/workspaces/team/docs/README.md")).toBe(
      "/workspaces/team"
    );
  });

  it("normalizes Windows separators and compares Windows paths case-insensitively", () => {
    const repositories = ["C:\\Users\\team\\repo"];

    expect(findRepositoryForFilePath(repositories, "C:/Users/team/repo/src/app.ts")).toBe(
      "C:\\Users\\team\\repo"
    );
    expect(findRepositoryForFilePath(repositories, "c:\\Users\\team\\REPO\\SRC\\app.ts")).toBe(
      "C:\\Users\\team\\repo"
    );
  });

  it("only treats a prefix as a path-segment boundary", () => {
    const repositories = ["/teams/project", "/teams/project-v2"];

    expect(findRepositoryForFilePath(repositories, "/teams/project-v2/src/index.ts")).toBe(
      "/teams/project-v2"
    );
    expect(findRepositoryForFilePath(repositories, "/teams/project-v2-file.txt")).toBeNull();
  });

  it("resolves normalized input deterministically when registrations are ambiguous", () => {
    expect(findRepositoryForFilePath(["/repo/", "/repo"], "/repo/file.ts")).toBe("/repo");
  });

  it("supports the repository map used by host state", () => {
    expect(
      findRepositoryForFilePath(
        { "/workspaces/repo": { columnWidths: null } },
        "/workspaces/repo/README.md"
      )
    ).toBe("/workspaces/repo");
  });

  it("does not match invalid input, repositories, or paths outside every repository", () => {
    const repositories = ["/repo", "/outside/../repo", "", "/repo/nested\u0000"];

    expect(findRepositoryForFilePath(repositories, "/other/file.ts")).toBeNull();
    expect(findRepositoryForFilePath(repositories, "/repo/../../other/file.ts")).toBeNull();
    expect(findRepositoryForFilePath([], "/repo/file.ts")).toBeNull();
    expect(findRepositoryForFilePath(repositories, 42)).toBeNull();
  });
});
