/* Git Interfaces / Types */

import type { EmojiMappingRecord } from "./emojiMappings";
import type { CommitDetailsPresentationSettings } from "../web/commitDetailsPresentation";

export interface GitCommitStash {
  selector: string;
  baseHash: string;
  untrackedFilesHash: string | null;
}

export interface GitStash {
  hash: string;
  selector: string;
  baseHash: string;
  untrackedFilesHash: string | null;
  author: string;
  email: string;
  date: number;
  message: string;
}

export interface GitCommitNode {
  hash: string;
  parentHashes: string[];
  author: string;
  email: string;
  date: number;
  message: string;
  refs: GitRef[];
  stash: GitCommitStash | null;
}

export interface GitCommit {
  hash: string;
  parentHashes: string[];
  author: string;
  email: string;
  date: number;
  message: string;
}

export interface GitCommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  committer: string;
  committerEmail: string;
  body: string;
  fileChanges: GitFileChange[];
  signature?: GitSignatureStatus | null;
}

export interface GitSignatureStatus {
  status: string;
  key: string;
  signer: string;
  fingerprint: string;
  primaryKeyFingerprint: string;
  trustLevel: string;
}

export interface GitRef {
  hash: string;
  name: string;
  type: "head" | "tag" | "remote";
}

export interface GitRefData {
  head: string | null;
  refs: GitRef[];
}

export interface CustomBranchGlobPattern {
  readonly name: string;
  readonly glob: string;
}

export type RecentActionId =
  | "commit.addTag"
  | "commit.cherryPick"
  | "commit.createBranch"
  | "commit.createWorktree"
  | "commit.merge"
  | "commit.resetToCommit"
  | "file.openFile"
  | "ref.checkoutBranch"
  | "ref.createWorktree"
  | "ref.deleteBranch"
  | "ref.deleteRemoteBranch"
  | "ref.mergeBranch"
  | "ref.openTerminal"
  | "ref.openWorktreeInNewWindow"
  | "ref.pull"
  | "ref.push"
  | "ref.revealWorktreeInOS";

export type ContextMenuActionId =
  | RecentActionId
  | "commit.checkout"
  | "commit.copyHash"
  | "commit.drop"
  | "commit.exportArchive"
  | "commit.revert"
  | "file.markReviewed"
  | "file.markNotReviewed"
  | "file.reopenWithEncoding"
  | "file.resetToRevision"
  | "ref.copyName"
  | "ref.copyWorktreePath"
  | "ref.createPullRequest"
  | "ref.rebaseBranch"
  | "ref.removeWorktree"
  | "ref.renameBranch"
  | "remoteBranch.copyName"
  | "stash.apply"
  | "stash.copyHash"
  | "stash.copyName"
  | "stash.createBranch"
  | "stash.drop"
  | "stash.pop"
  | "tag.copyName"
  | "tag.details"
  | "tag.deleteTag"
  | "tag.pushTag"
  | "uncommitted.clean"
  | "uncommitted.reset"
  | "uncommitted.stash";

export type ContextMenuGroup =
  | "branch"
  | "commit"
  | "file"
  | "remoteBranch"
  | "stash"
  | "tag"
  | "uncommitted";

export type ContextMenuActionsVisibility = Readonly<
  Record<ContextMenuGroup, Readonly<Record<ContextMenuActionId, boolean>>>
>;

export type GitRepoSet = { [repo: string]: GitRepoState };
export type ReviewedFilesByCommit = Record<string, string[]>;
export type ReviewedFilesByRepo = Record<string, ReviewedFilesByCommit>;
export interface ActiveCodeReview {
  id: string;
  commitHash: string;
  compareWithHash: string | null;
  files: string[];
  startedAt: number;
}
export type ActiveCodeReviewByRepo = Record<string, ActiveCodeReview>;
export interface GitRepoState {
  columnWidths: number[] | null;
  codeReview?: ActiveCodeReview | null;
  commitDetailsPresentation?: CommitDetailsPresentationSettings;
  encoding?: FileEncoding;
  columnVisibility?: ColumnVisibility;
  commitOrdering?: RepoCommitOrdering;
  fileEncodings?: Record<string, FileEncoding>;
  fileViewType?: "tree" | "list";
  recentActions?: RecentActionId[];
}

export interface GitUnsavedChanges {
  branch: string;
  changes: number;
}

export interface KeybindingConfig {
  find: string | null;
  refresh: string | null;
  scrollToHead: string | null;
  scrollToStash: string | null;
}

export interface MuteCommitsConfig {
  readonly mergeCommits: boolean;
  readonly commitsNotAncestorsOfHead: boolean;
}

export interface DialogDefaults {
  readonly merge: {
    readonly noFastForward: boolean;
    readonly squashCommits: boolean;
    readonly noCommit: boolean;
  };
  readonly cherryPick: {
    readonly recordOrigin: boolean;
    readonly noCommit: boolean;
  };
  readonly stashUncommittedChanges: {
    readonly includeUntracked: boolean;
  };
  readonly createWorktree: {
    readonly openTerminal: boolean;
  };
  readonly removeWorktree: {
    readonly deleteBranch: boolean;
  };
}

export interface GitKeizuViewState {
  commitBodyRendering?: CommitBodyRendering;
  commitDetailsPresentation?: CommitDetailsPresentationSettings;
  commitOrdering: CommitOrdering;
  contextMenuActionsVisibility: ContextMenuActionsVisibility;
  customBranchGlobPatterns: CustomBranchGlobPattern[];
  customEmojiShortcodeMappings?: EmojiMappingRecord;
  dateFormat: DateFormat;
  dialogDefaults: DialogDefaults;
  fetchAvatars: boolean;
  fileEncoding: FileEncoding;
  graphColours: string[];
  graphStyle: GraphStyle;
  initialLoadCommits: number;
  keybindings: KeybindingConfig;
  lastActiveRepo: string | null;
  loadMoreCommits: number;
  loadMoreCommitsAutomatically: boolean;
  mute: MuteCommitsConfig;
  repos: GitRepoSet;
  showCurrentBranchByDefault: boolean;
  showRecentActions: boolean;
}

export interface GitFileChange {
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
  additions: number | null;
  deletions: number | null;
}

export interface Avatar {
  image: string;
  timestamp: number;
  identicon: boolean;
}
export type AvatarCache = { [email: string]: Avatar };

export type DateFormat = "Date & Time" | "Date Only" | "Relative";
export type DateType = "Author Date" | "Commit Date";
export type GraphStyle = "rounded" | "angular";
export type TabIconColourTheme = "colour" | "grey";
export type GitCommandStatus = string | null;
export type GitDiffToolMode = "gui" | "terminal";

export interface GitDiffTool {
  mode: GitDiffToolMode;
  name: string;
}

export type ExternalDirDiffErrorCode =
  | "missingTool"
  | "invalidTarget"
  | "repositoryUnavailable"
  | "failed";

/* Worktree Types */

export interface WorktreeInfo {
  path: string;
  isMain: boolean;
}

export interface DetachedWorktreeInfo extends WorktreeInfo {
  head: string;
}

export type WorktreeMap = { [branchName: string]: WorktreeInfo };

export interface WorktreeCollection {
  branches: WorktreeMap;
  detached: DetachedWorktreeInfo[];
}

export type CommitOrdering = "date" | "topo" | "author-date";
export type RepoCommitOrdering = CommitOrdering | "default";
export type CommitBodyRendering = "plain" | "rich";
export type FileEncoding =
  | "utf8"
  | "shift_jis"
  | "euc-jp"
  | "iso-2022-jp"
  | "utf-16le"
  | "windows-1252";

export interface ColumnVisibility {
  readonly graph: true;
  readonly author: boolean;
  readonly date: boolean;
  readonly commit: boolean;
}
export type ArchiveFormat = "zip" | "tar" | "tar.gz";
export type GitResetMode = "soft" | "mixed" | "hard";
export type GitFileChangeType = "A" | "M" | "D" | "R";
import type { PullRequestProviderKind, ResolvedPullRequestConfig } from "./pullRequest";
import type { TagDetails } from "./tagDetails";
export type { PullRequestProviderKind, ResolvedPullRequestConfig };
export type { TagDetails };

/* Checkout / Push Result Types */

export interface RemoteBranchTarget {
  remoteName: string;
  branchName: string;
}

export type CheckoutBranchResult =
  | { kind: "branchExists" }
  | { kind: "invalidRef" }
  | { kind: "remoteNotFound" }
  | { kind: "pullFailed"; status: string }
  | { kind: "completed"; status: GitCommandStatus };

export interface PushTarget {
  remoteName: string;
  localBranchName: string;
  upstreamBranchName: string;
}

export type PushPreparation =
  | { kind: "upstream"; target: PushTarget }
  | { kind: "selectRemote"; remotes: string[] }
  | { kind: "error"; status: string };

/* Repository Settings Types */

export interface RepositorySettingsIssueLinks {
  enabled: boolean;
  regex: string;
  urlTemplate: string;
}

export interface RepositorySettingsRemote {
  name: string;
  url: string;
  pushUrl?: string;
}

export interface RepositorySettingsPullRequestDestination {
  branches: string[];
  defaultBranch: string | null;
  selectedBranch: string | null;
}

export type RepositorySettingsUserScope = "local" | "global";

export interface RepositorySettingsUserValue {
  effectiveValue: string | null;
  source: RepositorySettingsUserScope | null;
  localValue: string | null;
  globalValue: string | null;
}

export interface RepositorySettingsUserDetails {
  name: RepositorySettingsUserValue;
  email: RepositorySettingsUserValue;
}

export interface RepositorySettingsData {
  repositoryName: string;
  repositoryPath: string;
  remotes: RepositorySettingsRemote[];
  issueLinks: RepositorySettingsIssueLinks;
  pullRequest: ResolvedPullRequestConfig | null;
  pullRequestDestination?: RepositorySettingsPullRequestDestination;
  user: RepositorySettingsUserDetails;
}

export type RepositorySettingsResult =
  | { kind: "ok"; data: RepositorySettingsData }
  | { kind: "error"; status: GitCommandStatus };

export type RepositorySettingsAction =
  | { type: "addRemote"; name: string; url: string; pushUrl?: string }
  | {
      type: "editRemote";
      originalName: string;
      name: string;
      url: string;
      pushUrl?: string;
    }
  | { type: "deleteRemote"; name: string }
  | { type: "fetchRemote"; name: string }
  | { type: "fetchPruneRemote"; name: string }
  | { type: "pruneTagsRemote"; name: string }
  | { type: "saveIssueLinks"; settings: RepositorySettingsIssueLinks }
  | { type: "savePullRequest"; settings: PullRequestSettingsInput }
  | {
      type: "saveUserDetails";
      scope: RepositorySettingsUserScope;
      name: string;
      email: string;
    }
  | { type: "removeUserDetails"; scope: RepositorySettingsUserScope };

export interface PullRequestSettingsInput {
  provider: PullRequestProviderKind;
  remoteName: string;
  hostRootUrl?: string;
  destinationBranch?: string;
  customName?: string;
  customTemplateUrl?: string;
}

/* Named Constants */

export const UNCOMMITTED_CHANGES_HASH = "*";
export const VALID_UNCOMMITTED_RESET_MODES: ReadonlySet<string> = new Set(["mixed", "hard"]);

/* Request / Response Messages */

export interface RequestAddTag {
  command: "addTag";
  repo: string;
  commitHash: string;
  tagName: string;
  lightweight: boolean;
  message: string;
}
export interface ResponseAddTag {
  command: "addTag";
  status: GitCommandStatus;
}

export interface RequestCheckoutBranch {
  command: "checkoutBranch";
  repo: string;
  branchName: string;
  remoteBranch: RemoteBranchTarget | null;
}
export type ResponseCheckoutBranch =
  | { command: "checkoutBranch"; kind: "branchExists" }
  | { command: "checkoutBranch"; kind: "invalidRef" }
  | { command: "checkoutBranch"; kind: "remoteNotFound" }
  | { command: "checkoutBranch"; kind: "pullFailed"; status: string }
  | { command: "checkoutBranch"; kind: "completed"; status: GitCommandStatus };

export interface RequestCheckoutCommit {
  command: "checkoutCommit";
  repo: string;
  commitHash: string;
}
export interface ResponseCheckoutCommit {
  command: "checkoutCommit";
  status: GitCommandStatus;
}

export interface RequestCherrypickCommit {
  command: "cherrypickCommit";
  repo: string;
  commitHash: string;
  parentIndex: number;
  recordOrigin: boolean;
  noCommit: boolean;
}
export interface ResponseCherrypickCommit {
  command: "cherrypickCommit";
  status: GitCommandStatus;
}

export interface RequestCommitDetails {
  command: "commitDetails";
  repo: string;
  commitHash: string;
  hasParents: boolean;
  isStash: boolean;
}
export interface ResponseCommitDetails {
  command: "commitDetails";
  commitDetails: GitCommitDetails | null;
  reviewedFiles?: string[];
  diffTool?: GitDiffTool | null;
}

export interface RequestSetFileReviewed {
  command: "setFileReviewed";
  repo: string;
  commitHash: string;
  filePath: string;
  reviewed: boolean;
}

export interface RequestStartCodeReview {
  command: "startCodeReview";
  repo: string;
  commitHash: string;
  compareWithHash: string | null;
  files: string[];
}
export interface RequestEndCodeReview {
  command: "endCodeReview";
  repo: string;
}
export interface ResponseCodeReview {
  command: "codeReview";
  repo: string;
  id: string | null;
  active: boolean;
  commitHash: string | null;
  compareWithHash: string | null;
  files: string[];
  status: GitCommandStatus;
}
export interface ResponseFileReviewed {
  command: "fileReviewed";
  repo: string;
  commitHash: string;
  filePath: string;
  reviewed: boolean;
  reviewedFiles: string[];
  status: GitCommandStatus;
}

export interface RequestCopyToClipboard {
  command: "copyToClipboard";
  type: string;
  data: string;
}
export interface ResponseCopyToClipboard {
  command: "copyToClipboard";
  type: string;
  success: boolean;
}

export interface RequestCreateBranch {
  command: "createBranch";
  repo: string;
  commitHash: string;
  branchName: string;
  checkout: boolean;
}
export interface ResponseCreateBranch {
  command: "createBranch";
  status: GitCommandStatus;
}

export interface RequestDeleteBranch {
  command: "deleteBranch";
  repo: string;
  branchName: string;
  forceDelete: boolean;
  deleteOnRemotes: string[];
}
export interface ResponseDeleteBranch {
  command: "deleteBranch";
  status: GitCommandStatus;
}

export interface RequestDeleteRemoteBranch {
  command: "deleteRemoteBranch";
  repo: string;
  remoteName: string;
  branchName: string;
}
export interface ResponseDeleteRemoteBranch {
  command: "deleteRemoteBranch";
  status: GitCommandStatus;
}

export interface RequestRebaseBranch {
  command: "rebaseBranch";
  repo: string;
  branchName: string;
}
export interface ResponseRebaseBranch {
  command: "rebaseBranch";
  status: GitCommandStatus;
}

export interface RequestDeleteTag {
  command: "deleteTag";
  repo: string;
  tagName: string;
}
export interface ResponseDeleteTag {
  command: "deleteTag";
  status: GitCommandStatus;
}

export interface RequestFetchAvatar {
  command: "fetchAvatar";
  repo: string;
  email: string;
  commits: string[];
}
export interface ResponseFetchAvatar {
  command: "fetchAvatar";
  email: string;
  image: string;
}

export interface RequestLoadBranches {
  command: "loadBranches";
  repo: string;
  showRemoteBranches: boolean;
  hard: boolean;
}
export interface ResponseLoadBranches {
  command: "loadBranches";
  branches: string[];
  head: string | null;
  hard: boolean;
  isRepo: boolean;
}

export interface RequestLoadCommits {
  command: "loadCommits";
  repo: string;
  branches: string[];
  maxCommits: number;
  showRemoteBranches: boolean;
  hard: boolean;
  authors: string[];
  commitOrdering: CommitOrdering;
}
export interface ResponseLoadCommits {
  command: "loadCommits";
  commits: GitCommitNode[];
  head: string | null;
  moreCommitsAvailable: boolean;
  hard: boolean;
  authors?: string[];
  worktrees?: WorktreeCollection;
}

export interface RequestLoadRepos {
  command: "loadRepos";
  check: boolean;
}
export interface ResponseLoadRepos {
  command: "loadRepos";
  repos: GitRepoSet;
  lastActiveRepo: string | null;
}

export interface RequestMergeBranch {
  command: "mergeBranch";
  repo: string;
  branchName: string;
  createNewCommit: boolean;
  squash: boolean;
  noCommit: boolean;
}
export interface ResponseMergeBranch {
  command: "mergeBranch";
  status: GitCommandStatus;
}

export interface RequestMergeCommit {
  command: "mergeCommit";
  repo: string;
  commitHash: string;
  createNewCommit: boolean;
  squash: boolean;
  noCommit: boolean;
}
export interface ResponseMergeCommit {
  command: "mergeCommit";
  status: GitCommandStatus;
}

export interface RequestPushTag {
  command: "pushTag";
  repo: string;
  tagName: string;
}

export interface RequestTagDetails {
  command: "tagDetails";
  repo: string;
  tagName: string;
  commitHash: string;
}
export interface ResponseTagDetails {
  command: "tagDetails";
  details: TagDetails | null;
  status: GitCommandStatus;
}
export interface ResponsePushTag {
  command: "pushTag";
  status: GitCommandStatus;
}

export interface ResponseRefresh {
  command: "refresh";
}

export interface ResponseSelectRepo {
  command: "selectRepo";
  repo: string;
}

export interface ResponseSetShowRecentActions {
  command: "setShowRecentActions";
  showRecentActions: boolean;
}

export interface RequestRenameBranch {
  command: "renameBranch";
  repo: string;
  oldName: string;
  newName: string;
  updateUpstream: boolean;
}
export interface ResponseRenameBranch {
  command: "renameBranch";
  status: GitCommandStatus;
}

export interface RequestResetToCommit {
  command: "resetToCommit";
  repo: string;
  commitHash: string;
  resetMode: GitResetMode;
}
export interface ResponseResetToCommit {
  command: "resetToCommit";
  status: GitCommandStatus;
}

export interface RequestRevertCommit {
  command: "revertCommit";
  repo: string;
  commitHash: string;
  parentIndex: number;
}
export interface ResponseRevertCommit {
  command: "revertCommit";
  status: GitCommandStatus;
}

export interface RequestSaveRepoState {
  command: "saveRepoState";
  repo: string;
  state: GitRepoState;
}

export interface RequestCompareCommits {
  command: "compareCommits";
  repo: string;
  fromHash: string;
  toHash: string;
}
export interface ResponseCompareCommits {
  command: "compareCommits";
  fileChanges: GitFileChange[] | null;
  fromHash: string;
  toHash: string;
}

export interface RequestOpenExternalDirDiff {
  command: "openExternalDirDiff";
  repo: string;
  fromHash: string;
  toHash: string;
}
export interface ResponseOpenExternalDirDiff {
  command: "openExternalDirDiff";
  status: GitCommandStatus;
  errorCode?: ExternalDirDiffErrorCode;
}

export interface RequestViewDiff {
  command: "viewDiff";
  repo: string;
  commitHash: string;
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
  compareWithHash?: string;
}
export interface ResponseViewDiff {
  command: "viewDiff";
  success: boolean;
}

export interface RequestApplyStash {
  command: "applyStash";
  repo: string;
  selector: string;
  reinstateIndex: boolean;
}
export interface ResponseApplyStash {
  command: "applyStash";
  status: GitCommandStatus;
}

export interface RequestPopStash {
  command: "popStash";
  repo: string;
  selector: string;
  reinstateIndex: boolean;
}
export interface ResponsePopStash {
  command: "popStash";
  status: GitCommandStatus;
}

export interface RequestDropStash {
  command: "dropStash";
  repo: string;
  selector: string;
}
export interface ResponseDropStash {
  command: "dropStash";
  status: GitCommandStatus;
}

export interface RequestBranchFromStash {
  command: "branchFromStash";
  repo: string;
  selector: string;
  branchName: string;
}
export interface ResponseBranchFromStash {
  command: "branchFromStash";
  status: GitCommandStatus;
}

export interface RequestPushStash {
  command: "pushStash";
  repo: string;
  message: string;
  includeUntracked: boolean;
}
export interface ResponsePushStash {
  command: "pushStash";
  status: GitCommandStatus;
}

export interface RequestCreateWorktree {
  command: "createWorktree";
  repo: string;
  path: string;
  branchName: string;
  commitHash?: string;
  openTerminal: boolean;
}
export interface ResponseCreateWorktree {
  command: "createWorktree";
  status: GitCommandStatus;
}

export interface RequestRemoveWorktree {
  command: "removeWorktree";
  repo: string;
  worktreePath: string;
  branchName: string;
  deleteBranch: boolean;
}
export interface ResponseRemoveWorktree {
  command: "removeWorktree";
  status: GitCommandStatus;
  branchStatus?: GitCommandStatus;
}

export interface RequestOpenFile {
  command: "openFile";
  repo: string;
  filePath: string;
  commitHash: string;
}

export interface RequestReopenFile {
  command: "reopenFile";
  repo: string;
  filePath: string;
  commitHash: string;
  encoding: string;
}

export interface RequestOpenPullRequest {
  command: "openPullRequest";
  repo: string;
  branchName: string;
}
export interface ResponseOpenPullRequest {
  command: "openPullRequest";
  status: GitCommandStatus;
}
export interface ResponseOpenFile {
  command: "openFile";
  status: GitCommandStatus;
}

export interface ResponseReopenFile {
  command: "reopenFile";
  repo: string;
  filePath: string;
  encoding: FileEncoding;
  status: GitCommandStatus;
}

export interface RequestOpenTerminal {
  command: "openTerminal";
  repo: string;
  path: string;
  name: string;
}
export interface ResponseOpenTerminal {
  command: "openTerminal";
}

export interface RequestOpenWorktreeInNewWindow {
  command: "openWorktreeInNewWindow";
  repo: string;
  path: string;
}
export interface ResponseOpenWorktreeInNewWindow {
  command: "openWorktreeInNewWindow";
  status: GitCommandStatus;
}

export interface RequestRevealWorktreeInOS {
  command: "revealWorktreeInOS";
  repo: string;
  path: string;
}
export interface ResponseRevealWorktreeInOS {
  command: "revealWorktreeInOS";
  status: GitCommandStatus;
}

export interface RequestFetch {
  command: "fetch";
  repo: string;
}
export interface ResponseFetch {
  command: "fetch";
  status: GitCommandStatus;
}

export interface RequestDropCommit {
  command: "dropCommit";
  repo: string;
  commitHash: string;
}
export interface ResponseDropCommit {
  command: "dropCommit";
  status: GitCommandStatus;
}

export interface RequestResetFileToRevision {
  command: "resetFileToRevision";
  repo: string;
  revision: string;
  filePath: string;
}
export interface ResponseResetFileToRevision {
  command: "resetFileToRevision";
  status: GitCommandStatus;
}

export interface RequestCreateArchive {
  command: "createArchive";
  repo: string;
  commitHash: string;
  format: ArchiveFormat;
  outputPath: string;
}
export interface ResponseCreateArchive {
  command: "createArchive";
  status: GitCommandStatus;
}

export interface RequestPull {
  command: "pull";
  repo: string;
}
export interface ResponsePull {
  command: "pull";
  status: GitCommandStatus;
}

export interface RequestPush {
  command: "push";
  repo: string;
  operationId: string;
  selectedRemote: string | null;
}
export type ResponsePush =
  | {
      command: "push";
      repo: string;
      operationId: string;
      phase: "selectRemote";
      remotes: string[];
      defaultRemote: string;
    }
  | { command: "push"; repo: string; operationId: string; phase: "noRemotes" }
  | {
      command: "push";
      repo: string;
      operationId: string;
      phase: "completed";
      status: GitCommandStatus;
    };

export interface RequestResetUncommitted {
  command: "resetUncommitted";
  repo: string;
  mode: string;
}
export interface ResponseResetUncommitted {
  command: "resetUncommitted";
  status: GitCommandStatus;
}

export interface RequestCleanUntrackedFiles {
  command: "cleanUntrackedFiles";
  repo: string;
  directories: boolean;
}
export interface ResponseCleanUntrackedFiles {
  command: "cleanUntrackedFiles";
  status: GitCommandStatus;
}

export interface RequestGetRepositorySettings {
  command: "getRepositorySettings";
  repo: string;
}
export interface RequestRepositorySettingsAction {
  command: "repositorySettingsAction";
  repo: string;
  action: RepositorySettingsAction;
}

export interface RequestExportRepositoryConfig {
  command: "exportRepositoryConfig";
  repo: string;
}
export interface RequestImportRepositoryConfig {
  command: "importRepositoryConfig";
  repo: string;
}
export interface ResponseRepositoryConfigOperation {
  command: "repositoryConfigOperation";
  repo: string;
  operation: "export" | "import";
  status: GitCommandStatus;
}
export interface ResponseRepositorySettings {
  command: "repositorySettings";
  repo: string;
  data: RepositorySettingsData;
}
export interface ResponseRepositorySettingsError {
  command: "repositorySettingsError";
  repo: string;
  status: GitCommandStatus;
}
export interface ResponseRepositorySettingsAction {
  command: "repositorySettingsAction";
  repo: string;
  actionType: RepositorySettingsAction["type"];
  status: GitCommandStatus;
}

export type RequestMessage =
  | RequestAddTag
  | RequestApplyStash
  | RequestBranchFromStash
  | RequestCheckoutBranch
  | RequestCheckoutCommit
  | RequestCherrypickCommit
  | RequestCleanUntrackedFiles
  | RequestCommitDetails
  | RequestCreateWorktree
  | RequestCompareCommits
  | RequestOpenExternalDirDiff
  | RequestCreateArchive
  | RequestCopyToClipboard
  | RequestGetRepositorySettings
  | RequestCreateBranch
  | RequestDeleteBranch
  | RequestDeleteRemoteBranch
  | RequestDeleteTag
  | RequestDropCommit
  | RequestDropStash
  | RequestFetch
  | RequestFetchAvatar
  | RequestPull
  | RequestPush
  | RequestLoadBranches
  | RequestLoadCommits
  | RequestLoadRepos
  | RequestMergeBranch
  | RequestMergeCommit
  | RequestOpenFile
  | RequestReopenFile
  | RequestOpenTerminal
  | RequestOpenWorktreeInNewWindow
  | RequestOpenPullRequest
  | RequestPopStash
  | RequestPushStash
  | RequestPushTag
  | RequestTagDetails
  | RequestRepositorySettingsAction
  | RequestExportRepositoryConfig
  | RequestImportRepositoryConfig
  | RequestRebaseBranch
  | RequestRemoveWorktree
  | RequestRenameBranch
  | RequestResetToCommit
  | RequestResetFileToRevision
  | RequestResetUncommitted
  | RequestSetFileReviewed
  | RequestStartCodeReview
  | RequestEndCodeReview
  | RequestRevealWorktreeInOS
  | RequestRevertCommit
  | RequestSaveRepoState
  | RequestViewDiff;

export type ResponseMessage =
  | ResponseAddTag
  | ResponseApplyStash
  | ResponseBranchFromStash
  | ResponseCheckoutBranch
  | ResponseCheckoutCommit
  | ResponseCherrypickCommit
  | ResponseCleanUntrackedFiles
  | ResponseCommitDetails
  | ResponseCreateWorktree
  | ResponseCompareCommits
  | ResponseOpenExternalDirDiff
  | ResponseCreateArchive
  | ResponseCopyToClipboard
  | ResponseCreateBranch
  | ResponseDeleteBranch
  | ResponseDeleteRemoteBranch
  | ResponseDeleteTag
  | ResponseDropCommit
  | ResponseDropStash
  | ResponseFetch
  | ResponseFetchAvatar
  | ResponseRepositorySettings
  | ResponseRepositorySettingsError
  | ResponseRepositorySettingsAction
  | ResponseRepositoryConfigOperation
  | ResponsePull
  | ResponsePush
  | ResponseLoadBranches
  | ResponseLoadCommits
  | ResponseLoadRepos
  | ResponseMergeBranch
  | ResponseMergeCommit
  | ResponseOpenFile
  | ResponseReopenFile
  | ResponseOpenTerminal
  | ResponseOpenWorktreeInNewWindow
  | ResponseOpenPullRequest
  | ResponsePopStash
  | ResponsePushStash
  | ResponsePushTag
  | ResponseTagDetails
  | ResponseRebaseBranch
  | ResponseRefresh
  | ResponseRemoveWorktree
  | ResponseSelectRepo
  | ResponseSetShowRecentActions
  | ResponseFileReviewed
  | ResponseCodeReview
  | ResponseRenameBranch
  | ResponseResetToCommit
  | ResponseResetFileToRevision
  | ResponseResetUncommitted
  | ResponseRevealWorktreeInOS
  | ResponseRevertCommit
  | ResponseViewDiff;
