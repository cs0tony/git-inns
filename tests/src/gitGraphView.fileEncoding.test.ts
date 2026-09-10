import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  postMessage: vi.fn(),
  encodeDiffDocUri: vi.fn(),
  setFileEncoding: vi.fn(),
  resolveRefToHash: vi.fn(),
  messageHandler: { current: null as ((message: unknown) => Promise<void>) | null }
}));

vi.mock("vscode", () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        onDidReceiveMessage: vi.fn((handler: (message: unknown) => Promise<void>) => {
          mocks.messageHandler.current = handler;
        }),
        postMessage: mocks.postMessage,
        asWebviewUri: vi.fn((uri: unknown) => uri),
        cspSource: "test-csp",
        html: ""
      },
      onDidDispose: vi.fn(),
      onDidChangeViewState: vi.fn(),
      reveal: vi.fn(),
      visible: true,
      iconPath: null,
      dispose: vi.fn()
    }))
  },
  Uri: { file: vi.fn((path: string) => ({ fsPath: path, toString: () => path })) },
  ViewColumn: { One: 1, Two: 2 },
  commands: { executeCommand: mocks.executeCommand }
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => ({ toString: () => "test-nonce" })),
  randomUUID: vi.fn(() => "generated-review-id")
}));

vi.mock("../../src/config", () => ({
  MIN_COMMIT_LOAD_COUNT: 1,
  normalizeCommitLoadCount: (value: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(1, value) : fallback,
  getConfig: vi.fn(() => ({
    gitPath: () => "git",
    dateType: () => "Author Date",
    dateFormat: () => "Date & Time",
    showUncommittedChanges: () => false,
    tabIconColourTheme: () => "colour",
    fetchAvatars: () => false,
    fileEncoding: () => "utf8",
    graphColours: () => ["#0085d9"],
    graphStyle: () => "rounded",
    initialLoadCommits: () => 300,
    keyboardShortcutFind: () => "f",
    keyboardShortcutRefresh: () => "r",
    keyboardShortcutScrollToHead: () => "h",
    keyboardShortcutScrollToStash: () => "s",
    loadMoreCommits: () => 100,
    loadMoreCommitsAutomatically: () => true,
    commitBodyRendering: () => "plain",
    openNewTabEditorGroup: () => 2,
    muteCommitsMergeCommits: () => true,
    muteCommitsNotAncestorsOfHead: () => false,
    commitOrdering: () => "date",
    contextMenuActionsVisibility: () => ({
      branch: {},
      commit: {},
      file: {},
      remoteBranch: {},
      stash: {},
      tag: {},
      uncommitted: {}
    }),
    customBranchGlobPatterns: () => [],
    showCurrentBranchByDefault: () => false,
    showRecentActions: () => true,
    dialogDefaults: () => ({
      merge: { noFastForward: true, squashCommits: false, noCommit: false },
      cherryPick: { recordOrigin: false, noCommit: false },
      stashUncommittedChanges: { includeUntracked: false },
      createWorktree: { openTerminal: true },
      removeWorktree: { deleteBranch: true }
    })
  }))
}));

vi.mock("../../src/diffDocProvider", () => ({
  encodeDiffDocUri: mocks.encodeDiffDocUri
}));

vi.mock("../../src/i18n", () => ({
  getLocale: vi.fn(() => "en"),
  loadWebviewMessages: vi.fn(async () => ({})),
  t: vi.fn((message: string) => message)
}));

vi.mock("../../src/repoFileWatcher", () => ({
  RepoFileWatcher: function MockRepoFileWatcher() {
    return { mute: vi.fn(), unmute: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
}));

import type { AvatarManager } from "../../src/avatarManager";
import type { DataSource } from "../../src/dataSource";
import type { ExtensionState } from "../../src/extensionState";
import { GitKeizuView } from "../../src/gitGraphView";
import type { RepoManager } from "../../src/repoManager";
import type { ResponseMessage } from "../../src/types";

const REPO = "/test/repo";

function createView() {
  const dataSource = {
    resolveRefToHash: mocks.resolveRefToHash
  } as unknown as DataSource;
  const extensionState = {
    getLastActiveRepo: vi.fn(() => null),
    getRepos: vi.fn(() => ({ [REPO]: { columnWidths: null } })),
    isAvatarStorageAvailable: vi.fn(() => false),
    setFileEncoding: mocks.setFileEncoding,
    waitForAvatarStorage: vi.fn().mockResolvedValue(undefined),
    setLastActiveRepo: vi.fn()
  } as unknown as ExtensionState;
  const avatarManager = { registerView: vi.fn(), deregisterView: vi.fn() };
  const repoManager = {
    getRepos: vi.fn(() => ({ [REPO]: { columnWidths: null } })),
    registerViewCallback: vi.fn(),
    deregisterViewCallback: vi.fn(),
    setRepoState: vi.fn(),
    checkReposExist: vi.fn()
  };

  GitKeizuView.createOrShow(
    "/test/extension",
    dataSource,
    extensionState,
    avatarManager as unknown as AvatarManager,
    repoManager as unknown as RepoManager
  );
}

function reopenMessages(): ResponseMessage[] {
  return mocks.postMessage.mock.calls
    .map(([message]) => message as ResponseMessage)
    .filter((message) => message.command === "reopenFile");
}

describe("reopen changed file with encoding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageHandler.current = null;
    GitKeizuView.currentPanel = undefined;
    mocks.executeCommand.mockResolvedValue(undefined);
    mocks.setFileEncoding.mockResolvedValue(true);
    mocks.resolveRefToHash.mockResolvedValue("cafe01");
    mocks.encodeDiffDocUri.mockImplementation((repo: string, filePath: string, commit: string) => ({
      toString: () => `git-keizu:${filePath}?commit=${commit}`
    }));
    createView();
  });

  afterEach(() => {
    GitKeizuView.currentPanel?.dispose();
    GitKeizuView.currentPanel = undefined;
  });

  it("validates the selection, resolves HEAD, opens the file, and persists the override", async () => {
    await mocks.messageHandler.current!({
      command: "reopenFile",
      repo: REPO,
      filePath: "src\\file.ts",
      commitHash: "*",
      encoding: "SHIFT-JIS"
    });

    expect(mocks.resolveRefToHash).toHaveBeenCalledWith(REPO, "HEAD");
    expect(mocks.encodeDiffDocUri).toHaveBeenCalledWith(
      REPO,
      "src/file.ts",
      "cafe01",
      undefined,
      "shift_jis"
    );
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "vscode.open",
      expect.objectContaining({ toString: expect.any(Function) }),
      { preview: true, viewColumn: 2 }
    );
    expect(mocks.setFileEncoding).toHaveBeenCalledWith(REPO, "src/file.ts", "shift_jis");
    expect(reopenMessages()).toEqual([
      { command: "reopenFile", repo: REPO, filePath: "src\\file.ts", encoding: "shift_jis", status: null }
    ]);
  });

  it.each([
    ["an unsupported encoding", { encoding: "unknown" }],
    ["an escaping path", { filePath: "../file.ts" }],
    ["an invalid hash", { commitHash: "not-a-hash" }]
  ])("rejects %s before opening", async (_name, override) => {
    await mocks.messageHandler.current!({
      command: "reopenFile",
      repo: REPO,
      filePath: "src/file.ts",
      commitHash: "cafe01",
      encoding: "utf8",
      ...override
    });

    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(mocks.setFileEncoding).not.toHaveBeenCalled();
    expect(reopenMessages()[0]?.status).toBeTypeOf("string");
  });
});
