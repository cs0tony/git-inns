import * as childProcess from "node:child_process";

import * as vscode from "vscode";

import { AvatarManager } from "./avatarManager";
import { CommandManager, RepositoryCommandService } from "./commandManager";
import { DataSource } from "./dataSource";
import { DiffDocProvider } from "./diffDocProvider";
import { ExtensionState } from "./extensionState";
import { GitKeizuView } from "./gitGraphView";
import { RepoManager } from "./repoManager";
import { StatusBarItem } from "./statusBarItem";

async function getGitVersion(): Promise<string> {
  const [{ getConfig }, { resolveGitExecutable }] = await Promise.all([
    import("./config"),
    import("./gitExecutable")
  ]);
  const gitPath = await resolveGitExecutable(getConfig().gitPath());
  return new Promise((resolve, reject) => {
    childProcess.execFile(gitPath, ["--version"], (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      const version = stdout.trim();
      resolve(version === "" ? gitPath : version);
    });
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Git Keizu");
  const extensionState = new ExtensionState(context);
  const dataSource = new DataSource();
  // Dependent managers must not start Git commands before the git path is resolved.
  await dataSource.registerGitPath();
  const avatarManager = new AvatarManager(dataSource, extensionState);
  const statusBarItem = new StatusBarItem(context);
  const repoManager = new RepoManager(dataSource, extensionState, statusBarItem);
  const diffDocProvider = new DiffDocProvider(dataSource);
  const commandManager = new CommandManager(outputChannel);
  const repositoryCommands = new RepositoryCommandService({
    dataSource,
    diffDocScheme: DiffDocProvider.scheme,
    extensionState,
    extensionVersion: context.extension.packageJSON.version,
    getGitVersion,
    host: {
      getActiveTextEditor: () => vscode.window.activeTextEditor,
      showErrorMessage: (message, options) =>
        options === undefined
          ? vscode.window.showErrorMessage(message)
          : vscode.window.showErrorMessage(message, options),
      showInformationMessage: (message, options) =>
        options === undefined
          ? vscode.window.showInformationMessage(message)
          : vscode.window.showInformationMessage(message, options),
      showOpenDialog: (options) => vscode.window.showOpenDialog(options),
      showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
      showTextDocument: (document, options) => vscode.window.showTextDocument(document, options),
      showWarningMessage: (message, options, ...items) =>
        options === undefined
          ? vscode.window.showWarningMessage(message)
          : vscode.window.showWarningMessage(message, options, ...items),
      withProgress: (options, task) => vscode.window.withProgress(options, task)
    },
    repoManager
  });

  context.subscriptions.push(
    outputChannel,
    dataSource,
    commandManager.register("git-keizu.view", (arg?: unknown) => {
      // When invoked from SCM title bar, arg is a SourceControl object with rootUri property.
      // When invoked from command palette or programmatically, arg may be a Uri or undefined.
      let rootUri: vscode.Uri | undefined;
      if (arg instanceof vscode.Uri) {
        rootUri = arg;
      } else if (arg !== null && arg !== undefined && typeof arg === "object" && "rootUri" in arg) {
        const candidate = (arg as { rootUri?: unknown }).rootUri;
        if (candidate instanceof vscode.Uri) {
          rootUri = candidate;
        }
      }
      GitKeizuView.createOrShow(
        context.extensionPath,
        dataSource,
        extensionState,
        avatarManager,
        repoManager,
        rootUri
      );
    }),
    commandManager.register("git-keizu.clearAvatarCache", () => {
      avatarManager.clearCache();
    }),
    commandManager.register("git-keizu.resumeActiveReview", async (arg?: unknown) => {
      await GitKeizuView.resumeActiveReview(
        context.extensionPath,
        dataSource,
        extensionState,
        avatarManager,
        repoManager,
        arg
      );
    }),
    commandManager.register("git-keizu.endActiveReview", async (arg?: unknown) => {
      await GitKeizuView.endActiveReview(extensionState, repoManager, arg);
    }),
    commandManager.register("git-keizu.endAllReviews", async () => {
      await GitKeizuView.endAllReviews(extensionState, repoManager);
    }),
    commandManager.register("git-keizu.addRepository", () => repositoryCommands.addRepository()),
    commandManager.register("git-keizu.removeRepository", () =>
      repositoryCommands.removeRepository()
    ),
    commandManager.register("git-keizu.fetch", () => repositoryCommands.fetch()),
    commandManager.register("git-keizu.openActiveDiffFile", () =>
      repositoryCommands.openActiveDiffFile()
    ),
    commandManager.register("git-keizu.version", () => repositoryCommands.showVersion()),
    // Register both the provider instance and the registration disposable: unregistering alone
    // does not release the provider's internal subscription and event emitter.
    diffDocProvider,
    vscode.workspace.registerTextDocumentContentProvider(DiffDocProvider.scheme, diffDocProvider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("git-keizu.showStatusBarItem")) {
        statusBarItem.refresh();
      }
      if (e.affectsConfiguration("git-keizu.dateType")) {
        dataSource.generateGitCommandFormats();
      }
      if (e.affectsConfiguration("git-keizu.maxDepthOfRepoSearch")) {
        repoManager.maxDepthOfRepoSearchChanged();
      }
      if (e.affectsConfiguration("git.path")) {
        // Fire-and-forget: the previous git path stays in effect until resolution completes.
        void dataSource.registerGitPath();
      }
      if (e.affectsConfiguration("git-keizu.menu.showRecentActions")) {
        GitKeizuView.currentPanel?.notifyShowRecentActionsChanged();
      }
    }),
    avatarManager,
    repoManager
  );

  await GitKeizuView.refreshActiveReviewCommandEnablement(extensionState, repoManager);

  outputChannel.appendLine("Extension activated successfully");
}

export function deactivate() {}
