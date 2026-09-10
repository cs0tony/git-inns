import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  getRepositorySettings: vi.fn(),
  repositorySettingsAction: vi.fn(),
  saveRepositorySettingsIssueLinks: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
  getRepos: vi.fn(),
  repoFileWatcherStart: vi.fn(),
  repoFileWatcherStop: vi.fn(),
  messageHandler: { current: null as ((msg: unknown) => Promise<void>) | null }
}));

vi.mock("vscode", () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        onDidReceiveMessage: vi.fn((handler: (msg: unknown) => Promise<void>) => {
          mocks.messageHandler.current = handler;
        }),
        postMessage: mocks.postMessage,
        asWebviewUri: vi.fn((uri: unknown) => uri),
        cspSource: "test-csp",
        html: ""
      },
      onDidDispose: vi.fn(),
      onDidChangeViewState: vi.fn(),
      visible: true,
      iconPath: null,
      dispose: vi.fn()
    }))
  },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p, toString: () => p })) },
  ViewColumn: { One: 1 }
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => ({ toString: () => "test-nonce" }))
}));

vi.mock("../../src/config", () => ({
  MIN_COMMIT_LOAD_COUNT: 1,
  normalizeCommitLoadCount: (value: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(1, value) : fallback,
  getConfig: vi.fn(() => ({
    gitPath: () => "git",
    dateType: () => "Author Date",
    dateFormat: () => "Date & Time",
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
    muteCommitsMergeCommits: () => false,
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
    dialogDefaults: () => ({})
  }))
}));

vi.mock("../../src/i18n", () => ({
  getLocale: vi.fn(() => "en"),
  loadWebviewMessages: vi.fn(async () => ({})),
  t: vi.fn((message: string) => message)
}));

vi.mock("../../src/repoFileWatcher", () => ({
  RepoFileWatcher: function MockRepoFileWatcher() {
    return {
      mute: mocks.mute,
      unmute: mocks.unmute,
      start: mocks.repoFileWatcherStart,
      stop: mocks.repoFileWatcherStop
    };
  }
}));

import type { AvatarManager } from "../../src/avatarManager";
import type { DataSource } from "../../src/dataSource";
import type { ExtensionState } from "../../src/extensionState";
import { GitKeizuView } from "../../src/gitGraphView";
import type { RepoManager } from "../../src/repoManager";
import type { RepositorySettingsData } from "../../src/types";

const REPO = "/test/repo";
const SETTINGS: RepositorySettingsData = {
  repositoryName: "repo",
  repositoryPath: REPO,
  remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
  issueLinks: { enabled: false, regex: "", urlTemplate: "" }
};

function createView(): void {
  const dataSource = {
    getRepositorySettings: mocks.getRepositorySettings,
    repositorySettingsAction: mocks.repositorySettingsAction,
    saveRepositorySettingsIssueLinks: mocks.saveRepositorySettingsIssueLinks
  } as unknown as DataSource;
  const extensionState = {
    getLastActiveRepo: vi.fn(() => REPO),
    isAvatarStorageAvailable: vi.fn(() => false),
    waitForAvatarStorage: vi.fn().mockResolvedValue(undefined),
    setLastActiveRepo: vi.fn()
  } as unknown as ExtensionState;

  GitKeizuView.createOrShow(
    "/test/extension",
    dataSource,
    extensionState,
    { registerView: vi.fn(), deregisterView: vi.fn() } as unknown as AvatarManager,
    {
      getRepos: mocks.getRepos,
      registerViewCallback: vi.fn(),
      deregisterViewCallback: vi.fn(),
      setRepoState: vi.fn(),
      checkReposExist: vi.fn()
    } as unknown as RepoManager
  );
}

describe("GitKeizuView repository settings routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageHandler.current = null;
    GitKeizuView.currentPanel = undefined;
    mocks.getRepos.mockReturnValue({ [REPO]: "Test Repo" });
    mocks.getRepositorySettings.mockResolvedValue({ kind: "ok", data: SETTINGS });
    mocks.repositorySettingsAction.mockResolvedValue(null);
    mocks.saveRepositorySettingsIssueLinks.mockResolvedValue(undefined);
    createView();
  });

  afterEach(() => {
    GitKeizuView.currentPanel?.dispose();
    GitKeizuView.currentPanel = undefined;
  });

  it("requests repository settings and returns typed data", async () => {
    await mocks.messageHandler.current!({ command: "getRepositorySettings", repo: REPO });

    expect(mocks.getRepositorySettings).toHaveBeenCalledWith(REPO);
    expect(mocks.postMessage).toHaveBeenCalledWith({
      command: "repositorySettings",
      repo: REPO,
      data: SETTINGS
    });
  });

  it("returns a typed get error without pretending settings loaded", async () => {
    mocks.getRepositorySettings.mockResolvedValue({ kind: "error", status: "git failed" });
    await mocks.messageHandler.current!({ command: "getRepositorySettings", repo: REPO });

    expect(mocks.postMessage).toHaveBeenCalledWith({
      command: "repositorySettingsError",
      repo: REPO,
      status: "git failed"
    });
  });

  it("persists issue links, reports success, then sends fresh settings", async () => {
    await mocks.messageHandler.current!({
      command: "repositorySettingsAction",
      repo: REPO,
      action: {
        type: "saveIssueLinks",
        settings: { enabled: true, regex: "#\\d+", urlTemplate: "https://x/{0}" }
      }
    });

    expect(mocks.repositorySettingsAction).toHaveBeenCalledWith(REPO, {
      type: "saveIssueLinks",
      settings: { enabled: true, regex: "#\\d+", urlTemplate: "https://x/{0}" }
    });
    expect(mocks.postMessage).toHaveBeenNthCalledWith(1, {
      command: "repositorySettingsAction",
      repo: REPO,
      actionType: "saveIssueLinks",
      status: null
    });
    expect(mocks.postMessage).toHaveBeenNthCalledWith(2, {
      command: "repositorySettings",
      repo: REPO,
      data: SETTINGS
    });
  });

  it("returns remote action failures without a success refresh", async () => {
    mocks.repositorySettingsAction.mockResolvedValue("fatal: remote failed");
    await mocks.messageHandler.current!({
      command: "repositorySettingsAction",
      repo: REPO,
      action: { type: "fetchRemote", name: "origin" }
    });

    expect(mocks.repositorySettingsAction).toHaveBeenCalledWith(REPO, {
      type: "fetchRemote",
      name: "origin"
    });
    expect(mocks.postMessage).toHaveBeenCalledTimes(1);
    expect(mocks.postMessage).toHaveBeenCalledWith({
      command: "repositorySettingsAction",
      repo: REPO,
      actionType: "fetchRemote",
      status: "fatal: remote failed"
    });
  });
});
