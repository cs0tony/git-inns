import * as vscode from "vscode";

import { t } from "./i18n";

type CommandHandler = (...args: unknown[]) => unknown;

export interface RepositoryQuickPickItem extends vscode.QuickPickItem {
  repo: string;
}

export interface CommandHost {
  getActiveTextEditor(): vscode.TextEditor | undefined;
  showOpenDialog(
    options: vscode.OpenDialogOptions
  ): Thenable<readonly vscode.Uri[] | undefined> | readonly vscode.Uri[] | undefined;
  showQuickPick<T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: vscode.QuickPickOptions
  ): Thenable<T | undefined> | T | undefined;
  showInformationMessage(
    message: string,
    options?: vscode.MessageOptions
  ): Thenable<string | undefined> | string | undefined;
  showErrorMessage(
    message: string,
    options?: vscode.MessageOptions
  ): Thenable<string | undefined> | string | undefined;
  showWarningMessage(
    message: string,
    options?: vscode.MessageOptions,
    ...items: readonly string[]
  ): Thenable<string | undefined> | string | undefined;
  showTextDocument(
    document: vscode.TextDocument,
    options?: vscode.TextDocumentShowOptions
  ): Thenable<vscode.TextEditor>;
  withProgress<T>(
    options: vscode.ProgressOptions,
    task: () => Promise<T>
  ): Thenable<T> | Promise<T>;
}

export interface CommandManagerDependencies {
  dataSource: {
    fetch: (repo: string) => Promise<string | null>;
  };
  diffDocScheme: string;
  extensionState: {
    getLastActiveRepo(): string | null;
  };
  extensionVersion: string;
  getGitVersion(): Promise<string>;
  host: CommandHost;
  repoManager: {
    getRepos(): Record<string, unknown>;
    registerRepoFromUri(uri: vscode.Uri): Promise<boolean>;
    removeRepoAndRefresh(repo: string): Promise<void>;
  };
}

const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/\/?)(?:[^\s/@]*)@/gi;

export function redactUrlUserInfo(message: string): string {
  return message.replace(URL_USERINFO_PATTERN, (_match: string, scheme: string) => `${scheme}***@`);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

function createRedactedError(error: unknown): Error {
  return new Error(redactUrlUserInfo(getErrorMessage(error)));
}

export class CommandManager {
  private readonly outputChannel: Pick<vscode.OutputChannel, "appendLine">;

  constructor(outputChannel: Pick<vscode.OutputChannel, "appendLine">) {
    this.outputChannel = outputChannel;
  }

  public register(command: string, handler: CommandHandler): vscode.Disposable {
    return vscode.commands.registerCommand(command, (...args: unknown[]) => {
      this.outputChannel.appendLine(`Executing command: ${command}`);

      try {
        const result = handler(...args);
        if (!isPromise(result)) return result;
        return result.catch(async (error: unknown) => {
          await this.logCommandFailure(command, error);
          throw createRedactedError(error);
        });
      } catch (error) {
        this.logCommandFailure(command, error);
        throw createRedactedError(error);
      }
    });
  }

  private logCommandFailure(command: string, error: unknown): void {
    this.outputChannel.appendLine(
      `Command failed: ${command}: ${redactUrlUserInfo(getErrorMessage(error))}`
    );
  }
}

export class RepositoryCommandService {
  private readonly dependencies: CommandManagerDependencies;

  constructor(dependencies: CommandManagerDependencies) {
    this.dependencies = dependencies;
  }

  public async addRepository(): Promise<void> {
    const selected = await this.dependencies.host.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: t("Add Repository")
    });
    const folder = selected?.[0];
    if (folder === undefined) return;

    const repoPath = normalizeFolderPath(folder);
    const registered = await this.dependencies.repoManager.registerRepoFromUri(folder);
    if (registered) {
      void this.dependencies.host.showInformationMessage(
        t("Added {0} to Git Keizu.", getRepositoryName(repoPath))
      );
      return;
    }

    void this.dependencies.host.showErrorMessage(
      t("{0} is not a Git repository.", getRepositoryName(repoPath))
    );
  }

  public async removeRepository(): Promise<void> {
    const selected = await this.pickRepository(t("Select a repository to remove."));
    if (selected === undefined) return;

    const repositoryName = getRepositoryName(selected.repo);
    const confirmation = await this.dependencies.host.showWarningMessage(
      t("Remove {0} from Git Keizu? This does not delete files on disk.", repositoryName),
      { modal: true },
      t("Remove")
    );
    if (confirmation !== t("Remove")) return;

    await this.dependencies.repoManager.removeRepoAndRefresh(selected.repo);
    void this.dependencies.host.showInformationMessage(
      t("Removed {0} from Git Keizu.", repositoryName)
    );
  }

  public async fetch(): Promise<void> {
    const repos = this.dependencies.repoManager.getRepos();
    const defaultRepo = selectRepository(
      repos,
      this.dependencies.extensionState.getLastActiveRepo()
    );
    if (Object.keys(repos).length === 0) {
      void this.dependencies.host.showInformationMessage(t("No known repositories are available."));
      return;
    }

    const selected =
      defaultRepo ?? (await this.pickRepository(t("Select a repository to fetch.")))?.repo;
    if (selected === undefined) return;

    const status = await this.dependencies.host.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("Fetching {0}...", getRepositoryName(selected))
      },
      () => this.dependencies.dataSource.fetch(selected)
    );

    if (status !== null) {
      throw new Error(redactUrlUserInfo(status));
    }

    void this.dependencies.host.showInformationMessage(
      t("Fetched {0}.", getRepositoryName(selected))
    );
  }

  public async openActiveDiffFile(): Promise<void> {
    const activeEditor = this.dependencies.host.getActiveTextEditor();
    if (
      activeEditor === undefined ||
      activeEditor.document.uri.scheme !== this.dependencies.diffDocScheme
    ) {
      void this.dependencies.host.showInformationMessage(
        t("Open a Git Keizu revision file first.")
      );
      return;
    }

    await this.dependencies.host.showTextDocument(activeEditor.document);
  }

  public async showVersion(): Promise<void> {
    const gitVersion = await this.dependencies.getGitVersion();
    await this.dependencies.host.showInformationMessage(
      `${t("Git Keizu version: {0}", this.dependencies.extensionVersion)}\n${gitVersion}`,
      { modal: true }
    );
  }

  private async pickRepository(placeHolder: string): Promise<RepositoryQuickPickItem | undefined> {
    const items = createRepositoryQuickPickItems(this.dependencies.repoManager.getRepos());
    if (items.length === 0) {
      void this.dependencies.host.showInformationMessage(t("No known repositories are available."));
      return undefined;
    }

    return this.dependencies.host.showQuickPick(items, {
      matchOnDescription: true,
      placeHolder
    });
  }
}

export function selectRepository(
  repos: Record<string, unknown>,
  lastActiveRepo: string | null
): string | null {
  const repoPaths = Object.keys(repos).sort();
  if (lastActiveRepo !== null && lastActiveRepo in repos) return lastActiveRepo;
  return repoPaths.length === 1 ? repoPaths[0] : null;
}

export function createRepositoryQuickPickItems(
  repos: Record<string, unknown>
): RepositoryQuickPickItem[] {
  return Object.keys(repos)
    .sort()
    .map((repo) => ({
      description: repo,
      label: getRepositoryName(repo),
      repo
    }));
}

function normalizeFolderPath(uri: vscode.Uri): string {
  return uri.fsPath.replace(/\\/g, "/");
}

function getRepositoryName(repoPath: string): string {
  const name = repoPath.split("/").filter(Boolean).at(-1);
  return name ?? repoPath;
}
