import * as crypto from "node:crypto";
import * as path from "node:path";

import * as vscode from "vscode";

import { AvatarManager } from "./avatarManager";
import { getConfig, MIN_COMMIT_LOAD_COUNT, normalizeCommitLoadCount } from "./config";
import { DataSource } from "./dataSource";
import { encodeDiffDocUri } from "./diffDocProvider";
import { ExtensionState } from "./extensionState";
import { isSupportedFileEncoding, normalizeFileEncoding } from "./fileEncoding";
import { getLocale, loadWebviewMessages, t as hostT } from "./i18n";
import { buildPullRequestUrl } from "./pullRequest";
import { isSafeRemoteName } from "./refValidation";
import { RepoFileWatcher } from "./repoFileWatcher";
import { RepoManager } from "./repoManager";
import {
  exportRepositoryConfig,
  parseRepositoryConfig,
  type ShareablePullRequestConfig
} from "./repositoryConfig";
import {
  type ActiveCodeReview,
  type CheckoutBranchResult,
  type GitCommandStatus,
  GitFileChangeType,
  GitKeizuViewState,
  GitRepoSet,
  RequestMessage,
  type RequestPush,
  type ResponseCheckoutBranch,
  ResponseMessage,
  type ResponsePush,
  UNCOMMITTED_CHANGES_HASH
} from "./types";
import {
  abbrevCommit,
  copyToClipboard,
  getPathFromStr,
  getPathFromUri,
  isValidCommitHash,
  openFile
} from "./utils";

const CSS_COLOR_VAR_PREFIX = "--git-keizu-color";
const DEFAULT_PUSH_REMOTE = "origin";
const INVALID_REF_NAME_MESSAGE = "Invalid ref name.";
const BRANCH_ALREADY_EXISTS_MESSAGE = "A branch with this name already exists.";
const INVALID_REMOTE_NAME_MESSAGE = "Invalid remote name.";
const REMOTE_LOOKUP_FAILED_MESSAGE = "Unable to read the remotes of this repository.";
const UNREGISTERED_REMOTE_MESSAGE = "The selected remote is not registered in this repository.";
const HAS_ACTIVE_REVIEWS_CONTEXT = "git-keizu.hasActiveReviews";

interface ActiveCodeReviewChoice {
  readonly repo: string;
  readonly review: ActiveCodeReview;
  readonly title: string;
}

export class GitKeizuView {
  public static currentPanel: GitKeizuView | undefined;

  public static getRepositoryFromCommandArgument(
    arg: unknown,
    repoManager: RepoManager
  ): string | null {
    let candidatePath: string | null = null;
    if (arg instanceof vscode.Uri) {
      candidatePath = getPathFromUri(arg);
    } else if (arg !== null && arg !== undefined && typeof arg === "object") {
      const candidate = arg as { rootUri?: unknown; resourceUri?: unknown };
      if (candidate.rootUri instanceof vscode.Uri) {
        candidatePath = getPathFromUri(candidate.rootUri);
      } else if (candidate.resourceUri instanceof vscode.Uri) {
        candidatePath = getPathFromUri(candidate.resourceUri);
      }
    }

    return candidatePath !== null && candidatePath in repoManager.getRepos()
      ? candidatePath
      : null;
  }

  public static async refreshActiveReviewCommandEnablement(
    extensionState: ExtensionState,
    repoManager: RepoManager
  ): Promise<void> {
    const repos = repoManager.getRepos();
    const hasActiveReview = Object.keys(extensionState.getActiveCodeReviews()).some(
      (repo) => repo in repos
    );
    await vscode.commands.executeCommand("setContext", HAS_ACTIVE_REVIEWS_CONTEXT, hasActiveReview);
  }

  public static async resumeActiveReview(
    extensionPath: string,
    dataSource: DataSource,
    extensionState: ExtensionState,
    avatarManager: AvatarManager,
    repoManager: RepoManager,
    arg?: unknown
  ): Promise<void> {
    const choice = await GitKeizuView.chooseActiveReview(
      extensionState,
      repoManager,
      arg,
      "resume"
    );
    if (choice === null) return;

    if (GitKeizuView.currentPanel === undefined) {
      GitKeizuView.createOrShow(
        extensionPath,
        dataSource,
        extensionState,
        avatarManager,
        repoManager,
        vscode.Uri.file(choice.repo)
      );
    }
    GitKeizuView.currentPanel?.focusCodeReview(choice.repo, choice.review);
  }

  public static async endActiveReview(
    extensionState: ExtensionState,
    repoManager: RepoManager,
    arg?: unknown
  ): Promise<void> {
    const choice = await GitKeizuView.chooseActiveReview(
      extensionState,
      repoManager,
      arg,
      "end"
    );
    if (choice === null) return;

    const ended = await extensionState.endCodeReview(choice.repo);
    await GitKeizuView.refreshActiveReviewCommandEnablement(extensionState, repoManager);
    if (!ended) {
      await vscode.window.showErrorMessage(
        `Unable to end the active code review in ${getRepositoryName(choice.repo)}.`
      );
      return;
    }

    GitKeizuView.currentPanel?.sendCodeReviewUpdate(choice.repo, null);
    await vscode.window.showInformationMessage(
      `Ended the active code review in ${getRepositoryName(choice.repo)}.`
    );
  }

  public static async endAllReviews(
    extensionState: ExtensionState,
    repoManager: RepoManager
  ): Promise<void> {
    const activeCount = Object.keys(extensionState.getActiveCodeReviews()).length;
    if (activeCount === 0) {
      await vscode.window.showInformationMessage("There are no active code reviews.");
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      activeCount === 1
        ? "End the active code review?"
        : `End all ${activeCount} active code reviews?`,
      { modal: true },
      "End All Reviews"
    );
    if (confirmation !== "End All Reviews") return;

    const endedRepos = Object.keys(extensionState.getActiveCodeReviews());
    const endedCount = await extensionState.endAllCodeReviews();
    await GitKeizuView.refreshActiveReviewCommandEnablement(extensionState, repoManager);
    GitKeizuView.currentPanel?.notifyCodeReviewsEnded(endedRepos);
    await vscode.window.showInformationMessage(`Ended ${endedCount} code reviews.`);
  }

  private static async chooseActiveReview(
    extensionState: ExtensionState,
    repoManager: RepoManager,
    arg: unknown,
    operation: "end" | "resume"
  ): Promise<ActiveCodeReviewChoice | null> {
    const activeReviews = extensionState.getActiveCodeReviews();
    const availableRepos = repoManager.getRepos();
    const choices = Object.keys(availableRepos)
      .filter((repo) => activeReviews[repo] !== undefined)
      .map((repo) => ({
        repo,
        review: activeReviews[repo],
        title: getReviewTitle(activeReviews[repo])
      }));

    const selectedRepo =
      arg === null || arg === undefined
        ? null
        : GitKeizuView.getRepositoryFromCommandArgument(arg, repoManager);
    if (choices.length === 0) {
      const message =
        selectedRepo === null
          ? "There are no active code reviews."
          : `There is no active code review in ${getRepositoryName(selectedRepo)}.`;
      await vscode.window.showInformationMessage(message);
      return null;
    }

    if (selectedRepo !== null) {
      const selectedChoice = choices.find((choice) => choice.repo === selectedRepo);
      if (selectedChoice === undefined) {
        await vscode.window.showInformationMessage(
          `There is no active code review in ${getRepositoryName(selectedRepo)}.`
        );
        return null;
      }
      return selectedChoice;
    }

    if (choices.length === 1) return choices[0];

    const verb = operation === "resume" ? "resume" : "end";
    const item = await vscode.window.showQuickPick(
      choices.map((choice, index) => ({
        description: choice.repo,
        detail: choice.title,
        label: getRepositoryName(choice.repo),
        reviewIndex: index
      })),
      {
        canPickMany: false,
        placeHolder: `Select the active code review to ${verb}:`
      }
    );

    return item === undefined ? null : choices[item.reviewIndex];
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionPath: string;
  private readonly avatarManager: AvatarManager;
  private readonly dataSource: DataSource;
  private readonly extensionState: ExtensionState;
  private readonly repoFileWatcher: RepoFileWatcher;
  private readonly repoManager: RepoManager;
  private disposables: vscode.Disposable[] = [];
  private isGraphViewLoaded: boolean = false;
  private isPanelVisible: boolean = true;
  private currentRepo: string | null = null;

  public static createOrShow(
    extensionPath: string,
    dataSource: DataSource,
    extensionState: ExtensionState,
    avatarManager: AvatarManager,
    repoManager: RepoManager,
    rootUri?: vscode.Uri
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GitKeizuView.currentPanel) {
      if (rootUri !== undefined) {
        extensionState.setLastActiveRepo(getPathFromUri(rootUri));
      }
      GitKeizuView.currentPanel.panel.reveal(column);
      if (rootUri !== undefined) {
        GitKeizuView.currentPanel.selectRepoFromUri(rootUri, repoManager);
      }
      return;
    }

    if (rootUri !== undefined) {
      extensionState.setLastActiveRepo(getPathFromUri(rootUri));
    }

    const panel = vscode.window.createWebviewPanel(
      "git-keizu",
      "Git Keizu",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionPath, "media")),
          vscode.Uri.file(path.join(extensionPath, "web", "styles")),
          vscode.Uri.file(path.join(extensionPath, "out"))
        ]
      }
    );

    GitKeizuView.currentPanel = new GitKeizuView(
      panel,
      extensionPath,
      dataSource,
      extensionState,
      avatarManager,
      repoManager
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    dataSource: DataSource,
    extensionState: ExtensionState,
    avatarManager: AvatarManager,
    repoManager: RepoManager
  ) {
    this.panel = panel;
    this.extensionPath = extensionPath;
    this.avatarManager = avatarManager;
    this.dataSource = dataSource;
    this.extensionState = extensionState;
    this.repoManager = repoManager;
    this.avatarManager.registerView(this);

    panel.iconPath =
      getConfig().tabIconColourTheme() === "colour"
        ? this.getUri("resources", "webview-icon.svg")
        : {
            light: this.getUri("resources", "webview-icon-light.svg"),
            dark: this.getUri("resources", "webview-icon-dark.svg")
          };

    this.update();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible !== this.isPanelVisible) {
          if (this.panel.visible) {
            this.update();
          } else {
            this.currentRepo = null;
            this.repoFileWatcher.stop();
          }
          this.isPanelVisible = this.panel.visible;
        }
      },
      null,
      this.disposables
    );

    this.repoFileWatcher = new RepoFileWatcher(() => {
      if (this.panel.visible) {
        this.sendMessage({ command: "refresh" });
      }
    });
    this.repoManager.registerViewCallback((repos: GitRepoSet, numRepos: number) => {
      if (!this.panel.visible) return;
      if ((numRepos === 0 && this.isGraphViewLoaded) || (numRepos > 0 && !this.isGraphViewLoaded)) {
        this.update();
      } else {
        this.respondLoadRepos(repos);
      }
    });

    this.panel.webview.onDidReceiveMessage(
      async (msg: RequestMessage) => {
        if (this.dataSource === null) return;
        if (
          msg.command !== "copyToClipboard" &&
          msg.command !== "loadRepos" &&
          "repo" in msg &&
          !(msg.repo in this.repoManager.getRepos())
        ) {
          return;
        }
        this.repoFileWatcher.mute();
        try {
          switch (msg.command) {
            case "addTag":
              this.sendMessage({
                command: "addTag",
                status: await this.dataSource.addTag(
                  msg.repo,
                  msg.tagName,
                  msg.commitHash,
                  msg.lightweight,
                  msg.message
                )
              });
              break;
            case "fetchAvatar":
              this.avatarManager.fetchAvatarImage(msg.email, msg.repo, msg.commits);
              break;
            case "getRepositorySettings": {
              const result = await this.dataSource.getRepositorySettings(msg.repo);
              if (result.kind === "ok") {
                this.sendMessage({
                  command: "repositorySettings",
                  repo: msg.repo,
                  data: result.data
                });
              } else {
                this.sendMessage({
                  command: "repositorySettingsError",
                  repo: msg.repo,
                  status: result.status
                });
              }
              break;
            }
            case "repositorySettingsAction": {
              const status = await this.dataSource.repositorySettingsAction(msg.repo, msg.action);
              this.sendMessage({
                command: "repositorySettingsAction",
                repo: msg.repo,
                actionType: msg.action.type,
                status
              });
              if (status === null) {
                await this.sendFreshRepositorySettings(msg.repo);
              }
              break;
            }
            case "exportRepositoryConfig":
              await this.exportRepositoryConfig(msg.repo);
              break;
            case "importRepositoryConfig":
              await this.importRepositoryConfig(msg.repo);
              break;
            case "checkoutBranch": {
              const checkoutResult = await this.dataSource.checkoutBranch(
                msg.repo,
                msg.branchName,
                msg.remoteBranch
              );
              this.sendMessage(buildCheckoutBranchResponse(checkoutResult));
              break;
            }
            case "checkoutCommit":
              this.sendMessage({
                command: "checkoutCommit",
                status: await this.dataSource.checkoutCommit(msg.repo, msg.commitHash)
              });
              break;
            case "cherrypickCommit":
              this.sendMessage({
                command: "cherrypickCommit",
                status: await this.dataSource.cherrypickCommit(
                  msg.repo,
                  msg.commitHash,
                  msg.parentIndex,
                  msg.recordOrigin,
                  msg.noCommit
                )
              });
              break;
            case "commitDetails":
              {
                const commitDetails =
                  msg.commitHash === UNCOMMITTED_CHANGES_HASH
                    ? await this.dataSource.getUncommittedDetails(msg.repo)
                    : await this.dataSource.commitDetails(
                        msg.repo,
                        msg.commitHash,
                        msg.hasParents,
                        msg.isStash
                      );
                this.sendMessage({
                  command: "commitDetails",
                  commitDetails,
                  ...(msg.commitHash === UNCOMMITTED_CHANGES_HASH
                    ? {}
                    : {
                        reviewedFiles: this.extensionState.getReviewedFiles(
                          msg.repo,
                          msg.commitHash
                        )
                      })
                });
              }
              break;
            case "setFileReviewed": {
              const success = await this.extensionState.setFileReviewed(
                msg.repo,
                msg.commitHash,
                msg.filePath,
                msg.reviewed
              );
              this.sendMessage({
                command: "fileReviewed",
                repo: msg.repo,
                commitHash: msg.commitHash,
                filePath: msg.filePath,
                reviewed: msg.reviewed,
                reviewedFiles: this.extensionState.getReviewedFiles(msg.repo, msg.commitHash),
                status: success ? null : "Unable to update reviewed file status."
              });
              break;
            }
            case "startCodeReview": {
              const review = await this.extensionState.startCodeReview(
                msg.repo,
                crypto.randomUUID(),
                msg.commitHash,
                msg.compareWithHash,
                msg.files
              );
              this.sendCodeReview(
                msg.repo,
                review,
                review === null ? "Unable to start the code review." : null
              );
              void GitKeizuView.refreshActiveReviewCommandEnablement(
                this.extensionState,
                this.repoManager
              );
              break;
            }
            case "endCodeReview": {
              const ended = await this.extensionState.endCodeReview(msg.repo);
              this.sendCodeReview(msg.repo, null, ended ? null : "No active code review.");
              void GitKeizuView.refreshActiveReviewCommandEnablement(
                this.extensionState,
                this.repoManager
              );
              break;
            }
            case "compareCommits":
              this.sendMessage({
                command: "compareCommits",
                fileChanges: await this.dataSource.getCommitComparison(
                  msg.repo,
                  msg.fromHash,
                  msg.toHash
                ),
                fromHash: msg.fromHash,
                toHash: msg.toHash
              });
              break;
            case "copyToClipboard":
              this.sendMessage({
                command: "copyToClipboard",
                type: msg.type,
                success: await copyToClipboard(msg.data)
              });
              break;
            case "createBranch": {
              const createStatus = await this.dataSource.createBranch(
                msg.repo,
                msg.branchName,
                msg.commitHash
              );
              let status: GitCommandStatus = createStatus;
              if (createStatus === null && msg.checkout) {
                const checkoutStatus = describeCheckoutResult(
                  await this.dataSource.checkoutBranch(msg.repo, msg.branchName, null)
                );
                if (checkoutStatus !== null) {
                  status = `Branch '${msg.branchName}' was created, but checkout failed: ${checkoutStatus}`;
                }
              }
              this.sendMessage({ command: "createBranch", status });
              break;
            }
            case "deleteBranch": {
              const localStatus = await this.dataSource.deleteBranch(
                msg.repo,
                msg.branchName,
                msg.forceDelete
              );
              this.sendMessage({
                command: "deleteBranch",
                status: localStatus
              });
              if (localStatus === null && msg.deleteOnRemotes.length > 0) {
                await this.deleteRemoteBranches(msg.repo, msg.branchName, msg.deleteOnRemotes);
              }
              break;
            }
            case "deleteRemoteBranch":
              this.sendMessage({
                command: "deleteRemoteBranch",
                status: await this.dataSource.deleteRemoteBranch(
                  msg.repo,
                  msg.remoteName,
                  msg.branchName
                )
              });
              break;
            case "deleteTag":
              this.sendMessage({
                command: "deleteTag",
                status: await this.dataSource.deleteTag(msg.repo, msg.tagName)
              });
              break;
            case "loadBranches": {
              const branchData = await this.dataSource.getBranches(
                msg.repo,
                msg.showRemoteBranches
              );
              const isRepo = branchData.error
                ? await this.dataSource.isGitRepository(msg.repo)
                : true;
              this.sendMessage({
                command: "loadBranches",
                branches: branchData.branches,
                head: branchData.head,
                hard: msg.hard,
                isRepo: isRepo
              });
              if (msg.repo !== this.currentRepo) {
                this.currentRepo = msg.repo;
                this.extensionState.setLastActiveRepo(msg.repo);
                const watchRoots = await this.dataSource.getRepositoryStateWatchPaths(msg.repo);
                this.repoFileWatcher.start(watchRoots);
              }
              break;
            }
            case "loadCommits":
              this.sendMessage({
                command: "loadCommits",
                ...(await this.dataSource.getCommits(
                  msg.repo,
                  msg.branches,
                  normalizeCommitLoadCount(msg.maxCommits, MIN_COMMIT_LOAD_COUNT),
                  msg.showRemoteBranches,
                  msg.authors,
                  msg.commitOrdering
                )),
                hard: msg.hard
              });
              break;
            case "loadRepos":
              if (!msg.check || !(await this.repoManager.checkReposExist())) {
                // If not required to check repos, or no changes were found when checking, respond with repos
                this.respondLoadRepos(this.repoManager.getRepos());
              }
              break;
            case "mergeBranch":
              this.sendMessage({
                command: "mergeBranch",
                status: await this.dataSource.mergeBranch(
                  msg.repo,
                  msg.branchName,
                  msg.createNewCommit,
                  msg.squash,
                  msg.noCommit
                )
              });
              break;
            case "mergeCommit":
              this.sendMessage({
                command: "mergeCommit",
                status: await this.dataSource.mergeCommit(
                  msg.repo,
                  msg.commitHash,
                  msg.createNewCommit,
                  msg.squash,
                  msg.noCommit
                )
              });
              break;
            case "rebaseBranch":
              this.sendMessage({
                command: "rebaseBranch",
                status: await this.dataSource.rebaseBranch(msg.repo, msg.branchName)
              });
              break;
            case "pull":
              this.sendMessage({
                command: "pull",
                status: await this.dataSource.pull(msg.repo)
              });
              break;
            case "push":
              this.sendMessage(await this.resolvePush(msg));
              break;
            case "pushTag":
              this.sendMessage({
                command: "pushTag",
                status: await this.dataSource.pushTag(msg.repo, msg.tagName)
              });
              break;
            case "tagDetails": {
              const details = await this.dataSource.getTagDetails(msg.repo, msg.tagName);
              this.sendMessage({
                command: "tagDetails",
                details,
                status: details === null ? "Unable to load tag details." : null
              });
              break;
            }
            case "renameBranch":
              this.sendMessage({
                command: "renameBranch",
                status: await this.dataSource.renameBranch(
                  msg.repo,
                  msg.oldName,
                  msg.newName,
                  msg.updateUpstream
                )
              });
              break;
            case "resetToCommit":
              this.sendMessage({
                command: "resetToCommit",
                status: await this.dataSource.resetToCommit(msg.repo, msg.commitHash, msg.resetMode)
              });
              break;
            case "revertCommit":
              this.sendMessage({
                command: "revertCommit",
                status: await this.dataSource.revertCommit(
                  msg.repo,
                  msg.commitHash,
                  msg.parentIndex
                )
              });
              break;
            case "applyStash":
              this.sendMessage({
                command: "applyStash",
                status: await this.dataSource.applyStash(msg.repo, msg.selector, msg.reinstateIndex)
              });
              break;
            case "popStash":
              this.sendMessage({
                command: "popStash",
                status: await this.dataSource.popStash(msg.repo, msg.selector, msg.reinstateIndex)
              });
              break;
            case "dropStash":
              this.sendMessage({
                command: "dropStash",
                status: await this.dataSource.dropStash(msg.repo, msg.selector)
              });
              break;
            case "branchFromStash":
              this.sendMessage({
                command: "branchFromStash",
                status: await this.dataSource.branchFromStash(
                  msg.repo,
                  msg.branchName,
                  msg.selector
                )
              });
              break;
            case "pushStash":
              this.sendMessage({
                command: "pushStash",
                status: await this.dataSource.pushStash(msg.repo, msg.message, msg.includeUntracked)
              });
              break;
            case "resetUncommitted":
              this.sendMessage({
                command: "resetUncommitted",
                status: await this.dataSource.resetUncommitted(msg.repo, msg.mode)
              });
              break;
            case "cleanUntrackedFiles":
              this.sendMessage({
                command: "cleanUntrackedFiles",
                status: await this.dataSource.cleanUntrackedFiles(msg.repo, msg.directories)
              });
              break;
            case "createWorktree": {
              const wtStatus = await this.dataSource.addWorktree(
                msg.repo,
                msg.path,
                msg.branchName,
                msg.commitHash
              );
              if (wtStatus === null && msg.openTerminal) {
                const terminal = vscode.window.createTerminal({
                  name: `Worktree: ${msg.branchName}`,
                  cwd: path.resolve(msg.repo, msg.path)
                });
                terminal.show();
              }
              this.sendMessage({ command: "createWorktree", status: wtStatus });
              break;
            }
            case "removeWorktree": {
              const wtStatus = await this.dataSource.removeWorktree(msg.repo, msg.worktreePath);
              if (wtStatus !== null) {
                this.sendMessage({ command: "removeWorktree", status: wtStatus });
              } else if (msg.deleteBranch === true) {
                const branchStatus = await this.dataSource.deleteBranch(
                  msg.repo,
                  msg.branchName,
                  false
                );
                this.sendMessage({ command: "removeWorktree", status: null, branchStatus });
              } else {
                this.sendMessage({ command: "removeWorktree", status: null });
              }
              break;
            }
            case "openTerminal": {
              const terminal = vscode.window.createTerminal({
                name: msg.name,
                cwd: path.resolve(msg.repo, msg.path)
              });
              terminal.show();
              this.sendMessage({ command: "openTerminal" });
              break;
            }
            case "openWorktreeInNewWindow":
              try {
                await vscode.commands.executeCommand(
                  "vscode.openFolder",
                  vscode.Uri.file(path.resolve(msg.repo, msg.path)),
                  { forceNewWindow: true }
                );
                this.sendMessage({ command: "openWorktreeInNewWindow", status: null });
              } catch (error) {
                this.sendMessage({
                  command: "openWorktreeInNewWindow",
                  status: error instanceof Error ? error.message : String(error)
                });
              }
              break;
            case "revealWorktreeInOS":
              try {
                await vscode.commands.executeCommand(
                  "revealFileInOS",
                  vscode.Uri.file(path.resolve(msg.repo, msg.path))
                );
                this.sendMessage({ command: "revealWorktreeInOS", status: null });
              } catch (error) {
                this.sendMessage({
                  command: "revealWorktreeInOS",
                  status: error instanceof Error ? error.message : String(error)
                });
              }
              break;
            case "fetch":
              this.sendMessage({
                command: "fetch",
                status: await this.dataSource.fetch(msg.repo)
              });
              break;
            case "dropCommit":
              this.sendMessage({
                command: "dropCommit",
                status: await this.dataSource.dropCommit(msg.repo, msg.commitHash)
              });
              break;
            case "resetFileToRevision":
              this.sendMessage({
                command: "resetFileToRevision",
                status: await this.dataSource.resetFileToRevision(
                  msg.repo,
                  msg.revision,
                  msg.filePath
                )
              });
              break;
            case "createArchive":
              this.sendMessage({
                command: "createArchive",
                status: await this.dataSource.createArchive(
                  msg.repo,
                  msg.commitHash,
                  msg.format,
                  msg.outputPath
                )
              });
              break;
            case "saveRepoState":
              this.repoManager.setRepoState(msg.repo, msg.state);
              break;
            case "openPullRequest": {
              let status: GitCommandStatus = null;
              try {
                const settings = await this.dataSource.getRepositorySettings(msg.repo);
                const config = settings.kind === "ok" ? settings.data.pullRequest : null;
                if (config === null) {
                  status = "No pull-request provider is configured for this repository.";
                } else {
                  const url = buildPullRequestUrl(config, msg.branchName);
                  await vscode.env.openExternal(vscode.Uri.parse(url, true));
                }
              } catch (error) {
                status = error instanceof Error ? error.message : String(error);
              }
              this.sendMessage({ command: "openPullRequest", status });
              break;
            }
            case "viewDiff":
              this.sendMessage({
                command: "viewDiff",
                success: await this.viewDiff(
                  msg.repo,
                  msg.commitHash,
                  msg.oldFilePath,
                  msg.newFilePath,
                  msg.type,
                  msg.compareWithHash
                )
              });
              break;
            case "openFile": {
              const viewColumn = getConfig().openNewTabEditorGroup();
              const status = await openFile(
                msg.repo,
                msg.filePath,
                msg.commitHash,
                this.dataSource,
                viewColumn
              );
              this.sendMessage({ command: "openFile", status });
              break;
            }
            case "reopenFile":
              this.sendMessage({
                command: "reopenFile",
                repo: msg.repo,
                filePath: msg.filePath,
                encoding: normalizeFileEncoding(msg.encoding),
                status: await this.reopenRevisionFile(
                  msg.repo,
                  msg.filePath,
                  msg.commitHash,
                  msg.encoding
                )
              });
              break;
          }
        } finally {
          this.repoFileWatcher.unmute();
        }
      },
      null,
      this.disposables
    );
  }

  public sendMessage(msg: ResponseMessage) {
    this.panel.webview.postMessage(msg);
  }

  public focusCodeReview(repo: string, review: ActiveCodeReview) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    this.panel.reveal(column);
    this.extensionState.setLastActiveRepo(repo);
    if (this.currentRepo !== repo) {
      this.sendMessage({ command: "selectRepo", repo });
    }
    this.sendCodeReview(repo, review, null);
  }

  public sendCodeReviewUpdate(repo: string, review: ActiveCodeReview | null) {
    this.sendCodeReview(repo, review, null);
  }

  public notifyCodeReviewsEnded(repos: readonly string[]) {
    for (const repo of repos) {
      this.sendCodeReview(repo, null, null);
    }
  }

  private sendCodeReview(
    repo: string,
    review: ActiveCodeReview | null,
    status: GitCommandStatus
  ) {
    this.sendMessage({
      command: "codeReview",
      repo,
      id: review?.id ?? null,
      active: review !== null,
      commitHash: review?.commitHash ?? null,
      compareWithHash: review?.compareWithHash ?? null,
      files: review?.files ?? [],
      status
    });
  }

  public notifyShowRecentActionsChanged() {
    this.sendMessage({
      command: "setShowRecentActions",
      showRecentActions: getConfig().showRecentActions()
    });
  }

  private async selectRepoFromUri(rootUri: vscode.Uri, repoManager: RepoManager) {
    const repoPath = getPathFromUri(rootUri);
    const repos = repoManager.getRepos();
    if (!(repoPath in repos)) {
      await repoManager.registerRepoFromUri(rootUri);
    }
    this.sendMessage({ command: "selectRepo", repo: repoPath });
  }

  public dispose() {
    GitKeizuView.currentPanel = undefined;
    this.panel.dispose();
    this.avatarManager.deregisterView();
    this.repoFileWatcher.stop();
    this.repoManager.deregisterViewCallback();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }

  private async update() {
    this.panel.webview.html = await this.getHtmlForWebview();
  }

  private async getHtmlForWebview() {
    const config = getConfig(),
      nonce = getNonce();
    const locale = getLocale();
    const webviewMessages = await loadWebviewMessages(this.extensionPath);
    await this.extensionState.waitForAvatarStorage();
    const viewState: GitKeizuViewState = {
      commitBodyRendering: config.commitBodyRendering(),
      commitOrdering: config.commitOrdering(),
      contextMenuActionsVisibility: config.contextMenuActionsVisibility(),
      customBranchGlobPatterns: config.customBranchGlobPatterns(),
      dateFormat: config.dateFormat(),
      dialogDefaults: config.dialogDefaults(),
      fetchAvatars: config.fetchAvatars() && this.extensionState.isAvatarStorageAvailable(),
      fileEncoding: config.fileEncoding(),
      graphColours: config.graphColours(),
      graphStyle: config.graphStyle(),
      initialLoadCommits: config.initialLoadCommits(),
      keybindings: {
        find: config.keyboardShortcutFind(),
        refresh: config.keyboardShortcutRefresh(),
        scrollToHead: config.keyboardShortcutScrollToHead(),
        scrollToStash: config.keyboardShortcutScrollToStash()
      },
      lastActiveRepo: this.extensionState.getLastActiveRepo(),
      loadMoreCommits: config.loadMoreCommits(),
      loadMoreCommitsAutomatically: config.loadMoreCommitsAutomatically(),
      mute: {
        mergeCommits: config.muteCommitsMergeCommits(),
        commitsNotAncestorsOfHead: config.muteCommitsNotAncestorsOfHead()
      },
      repos: this.repoManager.getRepos(),
      showCurrentBranchByDefault: config.showCurrentBranchByDefault(),
      showRecentActions: config.showRecentActions()
    };

    let body,
      numRepos = Object.keys(viewState.repos).length,
      colorVars = "",
      colorParams = "";
    for (let i = 0; i < viewState.graphColours.length; i++) {
      colorVars += `${CSS_COLOR_VAR_PREFIX}${i}:${viewState.graphColours[i]}; `;
      colorParams += `[data-color="${i}"]{${CSS_COLOR_VAR_PREFIX}:var(${CSS_COLOR_VAR_PREFIX}${i});} `;
    }
    if (numRepos > 0) {
      body = `<body style="${colorVars}">
			<div id="controls">
				<span id="repoControl"><span class="unselectable">${hostT("Repo:")} </span><div id="repoSelect" class="dropdown"></div></span>
				<span id="branchControl"><span class="unselectable">${hostT("Branches:")} </span><div id="branchSelect" class="dropdown"></div></span>
				<span id="authorControl"><span class="unselectable">${hostT("Authors:")} </span><div id="authorSelect" class="dropdown"></div></span>
				<label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox" value="1" checked><span class="customCheckbox"></span>${hostT("Show Remote Branches")}</label>
				<div id="repoSettingsBtn" title="${hostT("Repository Settings")}"></div>
				<div id="searchBtn" title="${hostT("Search")}"></div>
				<div id="fetchBtn" title="${hostT("Fetch --prune")}"></div>
				<div id="currentBtn" title="${hostT("Current")}"></div>
				<div id="refreshBtn" title="${hostT("Refresh")}"></div>
			</div>
			<div id="scrollContainer">
				<div id="scrollShadow"></div>
				<div id="content">
					<div id="commitGraph"></div>
					<div id="commitTable"></div>
				</div>
				<div id="footer"></div>
			</div>
			<ul id="contextMenu"></ul>
			<div id="dialogBacking"></div>
			<div id="dialog"></div>
			<div id="repoSettingsOverlay">
				<div id="repoSettingsError" class="repo-settings-error" hidden></div>
				<div id="repoSettingsContainer"></div>
			</div>
			<script nonce="${nonce}">var webviewLocale = ${this.serializeJsonForScript(locale)}; var webviewMessages = ${this.serializeJsonForScript(webviewMessages)};</script>
			<script nonce="${nonce}">var viewState = ${this.serializeJsonForScript(viewState)};</script>
			<script src="${this.getCompiledOutputUri("web.min.js")}"></script>
			</body>`;
    } else {
      body = `<body class="unableToLoad" style="${colorVars}">
			<h2>${hostT("Unable to load Git Keizu")}</h2>
			<p>${hostT("Either the current workspace does not contain a Git repository, or the Git executable could not be found.")}</p>
			<p>${hostT('If you are using a portable Git installation, make sure you have set the Visual Studio Code Setting "git.path" to the path of your portable installation (e.g. "C:\\\\Program Files\\\\Git\\\\bin\\\\git.exe" on Windows).')}</p>
			</body>`;
    }
    this.isGraphViewLoaded = numRepos > 0;

    // CSP: font-src is required for codicon.ttf loaded by codicon.css
    return `<!DOCTYPE html>
		<html lang="${locale}">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${this.panel.webview.cspSource}; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; img-src data:;">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("main.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("dropdown.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("codicon.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("codicon-overrides.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("findwidget.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getWebStyleUri("repoSettings.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getWebStyleUri("codeReview.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getWebStyleUri("presentation.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getWebStyleUri("tagDetails.css")}">
				<title>Git Keizu</title>
				<style>${colorParams}</style>
			</head>
			${body}
		</html>`;
  }

  // Escapes "<" in the serialized output (not the input value) so values containing
  // "</script>" cannot terminate the inline <script> element they are embedded in.
  private serializeJsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  private getMediaUri(file: string) {
    return this.panel.webview.asWebviewUri(this.getUri("media", file));
  }

  private getWebStyleUri(file: string) {
    return this.panel.webview.asWebviewUri(this.getUri("web", "styles", file));
  }

  private getCompiledOutputUri(file: string) {
    return this.panel.webview.asWebviewUri(this.getUri("out", file));
  }

  private getUri(...pathComps: string[]) {
    return vscode.Uri.file(path.join(this.extensionPath, ...pathComps));
  }

  private respondLoadRepos(repos: GitRepoSet) {
    this.sendMessage({
      command: "loadRepos",
      repos: repos,
      lastActiveRepo: this.extensionState.getLastActiveRepo()
    });
  }

  private async sendFreshRepositorySettings(repo: string): Promise<void> {
    const result = await this.dataSource.getRepositorySettings(repo);
    if (result.kind === "error") {
      this.sendMessage({
        command: "repositorySettingsError",
        repo,
        status: result.status
      });
      return;
    }
    this.sendMessage({ command: "repositorySettings", repo, data: result.data });
  }

  private async exportRepositoryConfig(repo: string): Promise<void> {
    let status: GitCommandStatus = null;
    try {
      const result = await this.dataSource.getRepositorySettings(repo);
      if (result.kind === "error") throw new Error(result.status ?? "Unable to read settings.");
      const pullRequest = result.data.pullRequest;
      const content = exportRepositoryConfig({
        version: 1,
        issueLinks: result.data.issueLinks,
        ...(pullRequest === null
          ? {}
          : {
              pullRequest: {
                provider: pullRequest.provider,
                sourceRemote: pullRequest.sourceRemoteName,
                ...(pullRequest.customName === undefined
                  ? {}
                  : { customName: pullRequest.customName }),
                ...(pullRequest.customTemplateUrl === undefined
                  ? {}
                  : { customTemplateUrl: pullRequest.customTemplateUrl })
              } satisfies ShareablePullRequestConfig
            })
      });
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(repo, "git-keizu.config.json")),
        filters: { JSON: ["json"] },
        title: "Export Repository Configuration"
      });
      if (target === undefined) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
    this.sendMessage({ command: "repositoryConfigOperation", repo, operation: "export", status });
  }

  private async importRepositoryConfig(repo: string): Promise<void> {
    let status: GitCommandStatus = null;
    try {
      const source = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { JSON: ["json"] },
        title: "Import Repository Configuration"
      });
      if (source === undefined || source[0] === undefined) return;
      const raw = Buffer.from(await vscode.workspace.fs.readFile(source[0])).toString("utf8");
      const parsed = parseRepositoryConfig(raw);
      if (parsed.kind === "error") throw new Error(parsed.error);
      if (parsed.data.issueLinks !== undefined) {
        await this.extensionState.saveRepositorySettingsIssueLinks(repo, parsed.data.issueLinks);
      }
      if (parsed.data.pullRequest !== undefined) {
        const settings = await this.dataSource.getRepositorySettings(repo);
        if (settings.kind !== "ok") throw new Error(settings.status ?? "Unable to read settings.");
        const remote = settings.data.remotes.find(
          (candidate) => candidate.name === parsed.data.pullRequest?.sourceRemote
        );
        if (remote === undefined || parsed.data.pullRequest === undefined) {
          throw new Error("The configured source remote does not exist.");
        }
        await this.extensionState.saveRepositoryPullRequest(repo, remote.url, {
          provider: parsed.data.pullRequest.provider,
          remoteName: parsed.data.pullRequest.sourceRemote,
          ...(parsed.data.pullRequest.customName === undefined
            ? {}
            : { customName: parsed.data.pullRequest.customName }),
          ...(parsed.data.pullRequest.customTemplateUrl === undefined
            ? {}
            : { customTemplateUrl: parsed.data.pullRequest.customTemplateUrl })
        });
      }
      await this.sendFreshRepositorySettings(repo);
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
    this.sendMessage({ command: "repositoryConfigOperation", repo, operation: "import", status });
  }

  private async resolvePush(msg: RequestPush): Promise<ResponsePush> {
    const selectedRemote = msg.selectedRemote;
    if (selectedRemote === null) {
      return this.preparePushResponse(msg.repo, msg.operationId);
    }
    return this.pushToSelectedRemote(msg.repo, msg.operationId, selectedRemote);
  }

  private async preparePushResponse(repo: string, operationId: string): Promise<ResponsePush> {
    const preparation = await this.dataSource.preparePush(repo);
    switch (preparation.kind) {
      case "upstream":
        return completedPush(
          repo,
          operationId,
          await this.dataSource.pushToUpstream(repo, preparation.target)
        );
      case "selectRemote":
        return buildRemoteSelectionResponse(repo, operationId, preparation.remotes);
      case "error":
        return completedPush(repo, operationId, preparation.status);
    }
  }

  // The selected remote comes back from the webview, so it is re-checked against the
  // current `git remote` output before it can reach a push command.
  private async pushToSelectedRemote(
    repo: string,
    operationId: string,
    selectedRemote: string
  ): Promise<ResponsePush> {
    if (!isSafeRemoteName(selectedRemote)) {
      return completedPush(repo, operationId, INVALID_REMOTE_NAME_MESSAGE);
    }
    const remotes = await this.dataSource.getRemotes(repo);
    if (remotes === null) {
      return completedPush(repo, operationId, REMOTE_LOOKUP_FAILED_MESSAGE);
    }
    if (!remotes.includes(selectedRemote)) {
      return completedPush(repo, operationId, UNREGISTERED_REMOTE_MESSAGE);
    }
    return completedPush(
      repo,
      operationId,
      await this.dataSource.pushWithUpstream(repo, selectedRemote)
    );
  }

  private async deleteRemoteBranches(
    repo: string,
    branchName: string,
    remotes: string[]
  ): Promise<void> {
    const remoteErrors: string[] = [];
    for (const remote of remotes) {
      const remoteStatus = await this.dataSource.deleteRemoteBranch(repo, remote, branchName);
      if (remoteStatus !== null) {
        remoteErrors.push(`${remote}: ${remoteStatus}`);
      }
    }
    if (remoteErrors.length > 0) {
      this.sendMessage({
        command: "deleteRemoteBranch",
        status: remoteErrors.join("\n")
      });
    }
    this.sendMessage({ command: "refresh" });
  }

  private async viewDiff(
    repo: string,
    commitHash: string,
    oldFilePath: string,
    newFilePath: string,
    type: GitFileChangeType,
    compareWithHash?: string
  ): Promise<boolean> {
    const encodingFor = (filePath: string) => this.resolveFileEncoding(repo, filePath);
    const pathComponents = newFilePath.split("/");
    const fileName = pathComponents[pathComponents.length - 1];

    if (compareWithHash !== undefined) {
      const actualFromHash =
        commitHash === UNCOMMITTED_CHANGES_HASH
          ? ((await this.dataSource.resolveRefToHash(repo, "HEAD")) ?? "HEAD")
          : commitHash;
      const isWorkingTreeTarget = compareWithHash === UNCOMMITTED_CHANGES_HASH;
      const abbrevFrom =
        commitHash === UNCOMMITTED_CHANGES_HASH ? hostT("Uncommitted") : abbrevCommit(commitHash);
      const abbrevTo = isWorkingTreeTarget ? hostT("Uncommitted") : abbrevCommit(compareWithHash);
      const title = hostT("{0} ({1} ↔ {2})", fileName, abbrevFrom, abbrevTo);

      try {
        const leftUri = encodeDiffDocUri(
          repo,
          oldFilePath,
          actualFromHash,
          undefined,
          encodingFor(oldFilePath)
        );
        const rightUri = isWorkingTreeTarget
          ? type === "D"
            ? encodeDiffDocUri(
                repo,
                oldFilePath,
                UNCOMMITTED_CHANGES_HASH,
                Date.now().toString(),
                encodingFor(oldFilePath)
              )
            : vscode.Uri.file(path.join(repo, newFilePath))
          : encodeDiffDocUri(
              repo,
              newFilePath,
              compareWithHash,
              undefined,
              encodingFor(newFilePath)
            );

        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
          preview: true
        });
        return true;
      } catch {
        return false;
      }
    }

    if (commitHash === UNCOMMITTED_CHANGES_HASH) {
      const changeDescription =
        type === "A" ? hostT("Added") : type === "D" ? hostT("Deleted") : hostT("Modified");
      const title = hostT("{0} (Uncommitted - {1})", fileName, changeDescription);
      try {
        const resolvedHead = (await this.dataSource.resolveRefToHash(repo, "HEAD")) ?? "HEAD";
        const leftUri =
          type === "A"
            ? encodeDiffDocUri(
                repo,
                newFilePath,
                resolvedHead,
                undefined,
                encodingFor(newFilePath)
              )
            : encodeDiffDocUri(
                repo,
                oldFilePath,
                resolvedHead,
                undefined,
                encodingFor(oldFilePath)
              );
        const rightUri =
          type === "D"
            ? encodeDiffDocUri(
                repo,
                oldFilePath,
                UNCOMMITTED_CHANGES_HASH,
                Date.now().toString(),
                encodingFor(oldFilePath)
              )
            : vscode.Uri.file(path.join(repo, newFilePath));
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
          preview: true
        });
        return true;
      } catch {
        return false;
      }
    }

    const abbrevHash = abbrevCommit(commitHash);
    const changeDescription =
      type === "A"
        ? hostT("Added in {0}", abbrevHash)
        : type === "D"
          ? hostT("Deleted in {0}", abbrevHash)
          : `${abbrevHash}^ ↔ ${abbrevHash}`;
    const title = `${fileName} (${changeDescription})`;

    try {
      await vscode.commands.executeCommand(
        "vscode.diff",
        encodeDiffDocUri(
          repo,
          oldFilePath,
          `${commitHash}^`,
          undefined,
          encodingFor(oldFilePath)
        ),
        encodeDiffDocUri(repo, newFilePath, commitHash, undefined, encodingFor(newFilePath)),
        title,
        { preview: true }
      );
      return true;
    } catch {
      return false;
    }
  }

  private resolveFileEncoding(repo: string, filePath: string) {
    const override = this.extensionState.getFileEncoding?.(repo, filePath);
    return override ?? getConfig().fileEncoding?.() ?? "utf8";
  }

  private async reopenRevisionFile(
    repo: string,
    filePath: string,
    commitHash: string,
    encodingInput: string
  ): Promise<GitCommandStatus> {
    if (!isSupportedFileEncoding(encodingInput)) {
      return "The requested file encoding is not supported.";
    }
    const encoding = normalizeFileEncoding(encodingInput);
    const normalizedPath = normalizeReopenFilePath(filePath);
    if (normalizedPath === null) {
      return "The file path is invalid.";
    }

    let revision = commitHash;
    if (revision === UNCOMMITTED_CHANGES_HASH) {
      const head = await this.dataSource.resolveRefToHash(repo, "HEAD");
      if (head === null) return "Unable to resolve HEAD.";
      revision = head;
    } else if (!isValidCommitHash(revision)) {
      return "The commit hash is invalid.";
    }

    try {
      await vscode.commands.executeCommand(
        "vscode.open",
        encodeDiffDocUri(repo, normalizedPath, revision, undefined, encoding),
        {
          preview: true,
          viewColumn: getConfig().openNewTabEditorGroup()
        }
      );
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    const saved = await this.extensionState.setFileEncoding(repo, normalizedPath, encoding);
    return saved ? null : "Unable to save the file encoding selection.";
  }
}

function buildCheckoutBranchResponse(result: CheckoutBranchResult): ResponseCheckoutBranch {
  switch (result.kind) {
    case "branchExists":
    case "invalidRef":
    case "remoteNotFound":
      return { command: "checkoutBranch", kind: result.kind };
    case "pullFailed":
      return { command: "checkoutBranch", kind: "pullFailed", status: result.status };
    case "completed":
      return { command: "checkoutBranch", kind: "completed", status: result.status };
  }
}

function normalizeReopenFilePath(filePath: string): string | null {
  const normalizedPath = getPathFromStr(filePath);
  if (
    normalizedPath === "" ||
    normalizedPath.startsWith("/") ||
    /^[a-z]:/i.test(normalizedPath) ||
    containsControlCharacter(normalizedPath)
  ) {
    return null;
  }

  const segments = normalizedPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  return normalizedPath;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function describeCheckoutResult(result: CheckoutBranchResult): GitCommandStatus {
  switch (result.kind) {
    case "completed":
      return result.status;
    case "branchExists":
      return BRANCH_ALREADY_EXISTS_MESSAGE;
    case "invalidRef":
      return INVALID_REF_NAME_MESSAGE;
    case "remoteNotFound":
      return UNREGISTERED_REMOTE_MESSAGE;
    case "pullFailed":
      return result.status;
  }
}

function buildRemoteSelectionResponse(
  repo: string,
  operationId: string,
  remotes: string[]
): ResponsePush {
  const [firstRemote] = remotes;
  if (firstRemote === undefined) {
    return { command: "push", repo, operationId, phase: "noRemotes" };
  }
  return {
    command: "push",
    repo,
    operationId,
    phase: "selectRemote",
    remotes,
    defaultRemote: remotes.includes(DEFAULT_PUSH_REMOTE) ? DEFAULT_PUSH_REMOTE : firstRemote
  };
}

function completedPush(repo: string, operationId: string, status: GitCommandStatus): ResponsePush {
  return { command: "push", repo, operationId, phase: "completed", status };
}

function getRepositoryName(repo: string) {
  return repo.split("/").at(-1) || repo;
}

function getReviewTitle(review: ActiveCodeReview) {
  const commitLabel = abbrevCommit(review.commitHash);
  return review.compareWithHash === null
    ? commitLabel
    : `${abbrevCommit(review.compareWithHash)} ↔ ${commitLabel}`;
}

function getNonce() {
  return crypto.randomBytes(16).toString("hex");
}
