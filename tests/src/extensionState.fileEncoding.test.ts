import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn()
}));
vi.mock("../../src/utils", () => ({
  getPathFromStr: (value: string) => value.replace(/\\/g, "/"),
  isValidCommitHash: (value: string) => /^[0-9a-f]{4,40}$/i.test(value)
}));

import type { ExtensionContext, Memento } from "vscode";

import { ExtensionState } from "../../src/extensionState";

interface MockMemento extends Pick<Memento, "get" | "update"> {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createState(storage: Record<string, unknown> = {}) {
  const workspaceState: MockMemento = {
    get: vi.fn((key: string, fallback: unknown) => storage[key] ?? fallback),
    update: vi.fn(async (key: string, value: unknown) => {
      storage[key] = value;
    })
  };
  const context = {
    globalState: workspaceState,
    workspaceState,
    globalStoragePath: "/storage"
  } as unknown as ExtensionContext;
  return { state: new ExtensionState(context), workspaceState };
}

describe("per-repository and per-file encoding overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a file override before a repository override", async () => {
    const storage: Record<string, unknown> = {
      repoStates: {
        "/repo": {
          columnWidths: null,
          encoding: "shift_jis",
          fileEncodings: { "src/file.ts": "windows-1252" }
        }
      }
    };
    const { state } = createState(storage);

    expect(state.getFileEncoding("/repo", "src/file.ts")).toBe("windows-1252");
    expect(state.getFileEncoding("/repo", "src/other.ts")).toBe("shift_jis");
    expect(state.getFileEncoding("/repo", "../secret")).toBeNull();
  });

  it("persists valid overrides using the existing repo-state key", async () => {
    const { state, workspaceState } = createState({
      repoStates: { "/repo": { columnWidths: null } }
    });

    expect(await state.setFileEncoding("/repo", null, "SHIFT-JIS")).toBe(true);
    expect(await state.setFileEncoding("/repo", "src\\file.ts", "windows-1252")).toBe(true);

    expect(workspaceState.update).toHaveBeenLastCalledWith("repoStates", {
      "/repo": {
        columnWidths: null,
        encoding: "shift_jis",
        fileEncodings: { "src/file.ts": "windows-1252" }
      }
    });
  });

  it("rejects invalid repositories, paths, and encodings", async () => {
    const { state, workspaceState } = createState();

    await expect(state.setFileEncoding("", "src/file.ts", "utf8")).resolves.toBe(false);
    await expect(state.setFileEncoding("/repo", "../file.ts", "utf8")).resolves.toBe(false);
    await expect(state.setFileEncoding("/repo", "src/file.ts", "unknown")).resolves.toBe(false);
    expect(workspaceState.update).not.toHaveBeenCalled();
  });

  it("clears an override and removes empty encoding maps", async () => {
    const storage: Record<string, unknown> = {
      repoStates: {
        "/repo": {
          columnWidths: null,
          fileEncodings: { "src/file.ts": "utf-16le", "src/kept.ts": "euc-jp" }
        }
      }
    };
    const { state } = createState(storage);

    await expect(state.setFileEncoding("/repo", "src/file.ts", null)).resolves.toBe(true);
    expect(state.getRepos()["/repo"]?.fileEncodings).toEqual({ "src/kept.ts": "euc-jp" });
  });
});
