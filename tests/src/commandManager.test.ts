import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const outputChannel = { appendLine: vi.fn() };
  const host = {
    getActiveTextEditor: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    showWarningMessage: vi.fn(),
    withProgress: vi.fn()
  };

  class MockUri {
    fsPath: string;
    scheme: string;

    constructor(fsPath: string, scheme = "file") {
      this.fsPath = fsPath;
      this.scheme = scheme;
    }

    static file(fsPath: string): MockUri {
      return new MockUri(fsPath);
    }
  }

  return { MockUri, commandHandlers, host, outputChannel };
});

vi.mock("vscode", () => ({
  ProgressLocation: { Notification: 15 },
  Uri: mocks.MockUri,
  commands: {
    registerCommand: vi.fn((command: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commandHandlers.set(command, handler);
      return { dispose: vi.fn(), label: command };
    })
  }
}));

vi.mock("../../src/i18n", () => ({
  t: (message: string, ...args: unknown[]) =>
    args.length === 0
      ? message
      : message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)]))
}));

import {
  CommandManager,
  type CommandManagerDependencies,
  createRepositoryQuickPickItems,
  RepositoryCommandService,
  selectRepository
} from "../../src/commandManager";

const FIRST_REPO = "/workspaces/first-repo";
const SECOND_REPO = "/workspaces/second-repo";
const REMOVE_BUTTON = "Remove";

function createDependencies(
  overrides: Partial<CommandManagerDependencies> = {}
): CommandManagerDependencies {
  return {
    dataSource: {
      fetch: vi.fn().mockResolvedValue(null)
    },
    diffDocScheme: "git-keizu",
    extensionState: {
      getLastActiveRepo: vi.fn().mockReturnValue(null)
    },
    extensionVersion: "1.2.3",
    getGitVersion: vi.fn().mockResolvedValue("git version 2.51.0"),
    host: mocks.host,
    repoManager: {
      getRepos: vi.fn().mockReturnValue({}),
      registerRepoFromUri: vi.fn().mockResolvedValue(true),
      removeRepoAndRefresh: vi.fn().mockResolvedValue(undefined)
    },
    ...overrides
  };
}

function createService(
  overrides: Partial<CommandManagerDependencies> = {}
): RepositoryCommandService {
  return new RepositoryCommandService(createDependencies(overrides));
}

describe("CommandManager diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.commandHandlers.clear();
    mocks.outputChannel.appendLine.mockClear();
  });

  it("logs successful command invocations and preserves return values", () => {
    const manager = new CommandManager(mocks.outputChannel);
    const disposable = manager.register("git-keizu.test", () => "result");

    expect(disposable).toBeDefined();
    expect(mocks.commandHandlers.get("git-keizu.test")?.()).toBe("result");
    expect(mocks.outputChannel.appendLine).toHaveBeenCalledWith(
      "Executing command: git-keizu.test"
    );
    expect(mocks.outputChannel.appendLine).toHaveBeenCalledTimes(1);
  });

  it("logs and redacts credentials from asynchronous command failures", async () => {
    const manager = new CommandManager(mocks.outputChannel);
    const error = new Error("failed for https://user:token@example.com/repo.git");
    manager.register("git-keizu.failure", () => Promise.reject(error));

    await expect(mocks.commandHandlers.get("git-keizu.failure")?.()).rejects.toThrow(
      "failed for https://***@example.com/repo.git"
    );
    expect(mocks.outputChannel.appendLine).toHaveBeenCalledWith(
      "Command failed: git-keizu.failure: failed for https://***@example.com/repo.git"
    );
  });
});

describe("RepositoryCommandService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.host.showErrorMessage.mockResolvedValue(undefined);
    mocks.host.showInformationMessage.mockResolvedValue(undefined);
    mocks.host.showOpenDialog.mockResolvedValue([]);
    mocks.host.showQuickPick.mockResolvedValue(undefined);
    mocks.host.showTextDocument.mockResolvedValue({ label: "editor" });
    mocks.host.showWarningMessage.mockResolvedValue(undefined);
    mocks.host.withProgress.mockImplementation(async (_options, task) => await task());
  });

  it("adds a selected folder and shows a success notification", async () => {
    const registerRepoFromUri = vi.fn().mockResolvedValue(true);
    const service = createService({
      repoManager: {
        getRepos: vi.fn().mockReturnValue({}),
        registerRepoFromUri,
        removeRepoAndRefresh: vi.fn()
      }
    });
    mocks.host.showOpenDialog.mockResolvedValue([mocks.MockUri.file(FIRST_REPO)]);

    await service.addRepository();

    expect(mocks.host.showOpenDialog).toHaveBeenCalledWith({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Add Repository"
    });
    expect(registerRepoFromUri).toHaveBeenCalledWith(mocks.MockUri.file(FIRST_REPO));
    expect(mocks.host.showInformationMessage).toHaveBeenCalledWith(
      "Added first-repo to Git Keizu."
    );
    expect(mocks.host.showErrorMessage).not.toHaveBeenCalled();
  });

  it("reports when a selected folder is not a Git repository", async () => {
    const service = createService({
      repoManager: {
        getRepos: vi.fn().mockReturnValue({}),
        registerRepoFromUri: vi.fn().mockResolvedValue(false),
        removeRepoAndRefresh: vi.fn()
      }
    });
    mocks.host.showOpenDialog.mockResolvedValue([mocks.MockUri.file(FIRST_REPO)]);

    await service.addRepository();

    expect(mocks.host.showErrorMessage).toHaveBeenCalledWith("first-repo is not a Git repository.");
    expect(mocks.host.showInformationMessage).not.toHaveBeenCalled();
  });

  it("returns without confirmation when repository removal is cancelled", async () => {
    const removeRepoAndRefresh = vi.fn();
    const service = createService({
      repoManager: {
        getRepos: vi.fn().mockReturnValue({ [FIRST_REPO]: {} }),
        registerRepoFromUri: vi.fn(),
        removeRepoAndRefresh
      }
    });
    mocks.host.showQuickPick.mockResolvedValue({
      description: FIRST_REPO,
      label: "first-repo",
      repo: FIRST_REPO
    });

    await service.removeRepository();

    expect(mocks.host.showQuickPick).toHaveBeenCalledWith(
      createRepositoryQuickPickItems({ [FIRST_REPO]: {} }),
      {
        matchOnDescription: true,
        placeHolder: "Select a repository to remove."
      }
    );
    expect(mocks.host.showWarningMessage).toHaveBeenCalledWith(
      "Remove first-repo from Git Keizu? This does not delete files on disk.",
      { modal: true },
      REMOVE_BUTTON
    );
    expect(removeRepoAndRefresh).not.toHaveBeenCalled();
  });

  it("removes the selected repository only after explicit confirmation", async () => {
    const removeRepoAndRefresh = vi.fn().mockResolvedValue(undefined);
    const service = createService({
      repoManager: {
        getRepos: vi.fn().mockReturnValue({ [FIRST_REPO]: {} }),
        registerRepoFromUri: vi.fn(),
        removeRepoAndRefresh
      }
    });
    mocks.host.showQuickPick.mockResolvedValue({
      description: FIRST_REPO,
      label: "first-repo",
      repo: FIRST_REPO
    });
    mocks.host.showWarningMessage.mockResolvedValue(REMOVE_BUTTON);

    await service.removeRepository();

    expect(removeRepoAndRefresh).toHaveBeenCalledWith(FIRST_REPO);
    expect(mocks.host.showInformationMessage).toHaveBeenCalledWith(
      "Removed first-repo from Git Keizu."
    );
  });

  it("uses the active repository directly and fetches with existing default options", async () => {
    const fetch = vi.fn().mockResolvedValue(null);
    const service = createService({
      dataSource: { fetch },
      extensionState: { getLastActiveRepo: vi.fn().mockReturnValue(FIRST_REPO) },
      repoManager: {
        getRepos: vi.fn().mockReturnValue({ [FIRST_REPO]: {}, [SECOND_REPO]: {} }),
        registerRepoFromUri: vi.fn(),
        removeRepoAndRefresh: vi.fn()
      }
    });

    await service.fetch();

    expect(mocks.host.showQuickPick).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(FIRST_REPO);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.host.withProgress).toHaveBeenCalledWith(
      {
        location: 15,
        title: "Fetching first-repo..."
      },
      expect.any(Function)
    );
    expect(mocks.host.showInformationMessage).toHaveBeenCalledWith("Fetched first-repo.");
  });

  it("requires a QuickPick when multiple repositories exist and none is active", async () => {
    const repos = { [FIRST_REPO]: {}, [SECOND_REPO]: {} };
    const service = createService({
      repoManager: {
        getRepos: vi.fn().mockReturnValue(repos),
        registerRepoFromUri: vi.fn(),
        removeRepoAndRefresh: vi.fn()
      }
    });

    await service.fetch();

    expect(mocks.host.showQuickPick).toHaveBeenCalledWith(createRepositoryQuickPickItems(repos), {
      matchOnDescription: true,
      placeHolder: "Select a repository to fetch."
    });
  });

  it("redacts credentials while preserving the actionable fetch failure", async () => {
    const fetch = vi.fn().mockResolvedValue("failed for https://user:token@example.com/repo.git");
    const service = createService({
      dataSource: { fetch },
      extensionState: { getLastActiveRepo: vi.fn().mockReturnValue(FIRST_REPO) },
      repoManager: {
        getRepos: vi.fn().mockReturnValue({ [FIRST_REPO]: {} }),
        registerRepoFromUri: vi.fn(),
        removeRepoAndRefresh: vi.fn()
      }
    });

    await expect(service.fetch()).rejects.toThrow("failed for https://***@example.com/repo.git");
    expect(fetch).toHaveBeenCalledWith(FIRST_REPO);
    expect(mocks.host.showInformationMessage).not.toHaveBeenCalled();
  });

  it("shows guidance when the active editor is not a Git Keizu diff document", async () => {
    const service = createService();
    mocks.host.getActiveTextEditor.mockReturnValue({
      document: { uri: { scheme: "file" } }
    });

    await service.openActiveDiffFile();

    expect(mocks.host.showInformationMessage).toHaveBeenCalledWith(
      "Open a Git Keizu revision file first."
    );
    expect(mocks.host.showTextDocument).not.toHaveBeenCalled();
  });

  it("focuses the revision document when the active editor uses DiffDocProvider", async () => {
    const service = createService();
    const document = { uri: { scheme: "git-keizu" } };
    mocks.host.getActiveTextEditor.mockReturnValue({ document });

    await service.openActiveDiffFile();

    expect(mocks.host.showTextDocument).toHaveBeenCalledWith(document);
  });

  it("shows extension and Git diagnostics in a native modal", async () => {
    const service = createService();

    await service.showVersion();

    expect(mocks.host.showInformationMessage).toHaveBeenCalledWith(
      "Git Keizu version: 1.2.3\ngit version 2.51.0",
      { modal: true }
    );
  });
});

describe("repository selection helpers", () => {
  it("prefers the active repository, then a single repository", () => {
    const multiple = { [FIRST_REPO]: {}, [SECOND_REPO]: {} };

    expect(selectRepository(multiple, SECOND_REPO)).toBe(SECOND_REPO);
    expect(selectRepository(multiple, null)).toBeNull();
    expect(selectRepository({ [FIRST_REPO]: {} }, null)).toBe(FIRST_REPO);
    expect(selectRepository({}, FIRST_REPO)).toBeNull();
  });

  it("creates unambiguous repository QuickPick items", () => {
    expect(createRepositoryQuickPickItems({ [SECOND_REPO]: {}, [FIRST_REPO]: {} })).toEqual([
      { description: FIRST_REPO, label: "first-repo", repo: FIRST_REPO },
      { description: SECOND_REPO, label: "second-repo", repo: SECOND_REPO }
    ]);
  });
});
