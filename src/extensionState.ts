import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ExtensionContext, Memento } from "vscode";

import {
  isSafePullRequestBranch,
  type ResolvedPullRequestConfig,
  resolvePullRequestConfig
} from "./pullRequest";
import {
  type ActiveCodeReview,
  Avatar,
  AvatarCache,
  GitRepoSet,
  GitRepoState,
  PullRequestSettingsInput,
  RecentActionId,
  RepositorySettingsIssueLinks,
  ReviewedFilesByRepo
} from "./types";
import { getPathFromStr, isValidCommitHash } from "./utils";

const AVATAR_STORAGE_FOLDER = "avatars";
const AVATAR_CACHE = "avatarCache";
const LAST_ACTIVE_REPO = "lastActiveRepo";
const REPO_STATES = "repoStates";
const REPOSITORY_SETTINGS_ISSUE_LINKS = "repositorySettingsIssueLinks";
const REPOSITORY_PULL_REQUESTS = "repositoryPullRequests";
const MAX_RECENT_ACTIONS = 5;
const REVIEWED_FILES = "reviewedFiles";
const EMPTY_ISSUE_LINKS: RepositorySettingsIssueLinks = {
  enabled: false,
  regex: "",
  urlTemplate: ""
};
type RepositorySettingsIssueLinkMap = Record<string, RepositorySettingsIssueLinks>;
type RepositoryPullRequestMap = Record<string, ResolvedPullRequestConfig>;

export class ExtensionState {
  private globalState: Memento;
  private workspaceState: Memento;
  private globalStoragePath: string;
  private avatarStorageAvailable: boolean = false;
  private avatarStorageInit: Promise<void>;

  constructor(context: ExtensionContext) {
    this.globalState = context.globalState;
    this.workspaceState = context.workspaceState;

    this.globalStoragePath = getPathFromStr(context.globalStoragePath);
    this.avatarStorageInit = this.initAvatarStorage();
  }

  private async initAvatarStorage() {
    const avatarDir = path.join(this.globalStoragePath, AVATAR_STORAGE_FOLDER);
    try {
      await fs.stat(avatarDir);
      this.avatarStorageAvailable = true;
    } catch {
      try {
        await fs.mkdir(avatarDir, { recursive: true });
        this.avatarStorageAvailable = true;
      } catch {
        // Avatar storage initialization failed; avatars will be unavailable
      }
    }
  }

  /* Discovered Repos */
  public getRepos() {
    return this.workspaceState.get<GitRepoSet>(REPO_STATES, {});
  }
  public saveRepos(gitRepoSet: GitRepoSet) {
    this.workspaceState.update(REPO_STATES, this.normalizeRepoSet(gitRepoSet));
  }

  /* Last Active Repo */
  public getLastActiveRepo() {
    return this.workspaceState.get<string | null>(LAST_ACTIVE_REPO, null);
  }
  public setLastActiveRepo(repo: string | null) {
    this.workspaceState.update(LAST_ACTIVE_REPO, repo);
  }

  /* Repository Settings */
  public getRepositorySettingsIssueLinks(repo: string): RepositorySettingsIssueLinks {
    const settings = this.workspaceState.get<RepositorySettingsIssueLinkMap>(
      REPOSITORY_SETTINGS_ISSUE_LINKS,
      {}
    );
    return normalizeIssueLinks(settings[repo]);
  }

  public saveRepositorySettingsIssueLinks(repo: string, issueLinks: RepositorySettingsIssueLinks) {
    const settings = this.workspaceState.get<RepositorySettingsIssueLinkMap>(
      REPOSITORY_SETTINGS_ISSUE_LINKS,
      {}
    );
    settings[repo] = normalizeIssueLinks(issueLinks);
    this.workspaceState.update(REPOSITORY_SETTINGS_ISSUE_LINKS, settings);
  }

  public getRepositoryPullRequest(repo: string): ResolvedPullRequestConfig | null {
    return this.readPullRequests()[repo] ?? null;
  }

  public async saveRepositoryPullRequest(
    repo: string,
    remoteUrl: string,
    input: PullRequestSettingsInput
  ): Promise<ResolvedPullRequestConfig> {
    const config = resolvePullRequestConfig({
      ...input,
      remoteUrl
    });
    const settings = this.readPullRequests();
    settings[repo] = config;
    await this.workspaceState.update(REPOSITORY_PULL_REQUESTS, settings);
    return config;
  }

  private readPullRequests(): RepositoryPullRequestMap {
    const value = this.workspaceState.get<RepositoryPullRequestMap>(REPOSITORY_PULL_REQUESTS, {});
    if (typeof value !== "object" || value === null) return {};

    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, ResolvedPullRequestConfig] => {
        const config = entry[1];
        return (
          typeof config === "object" &&
          config !== null &&
          typeof config.sourceRemoteName === "string" &&
          typeof config.sourceOwner === "string" &&
          typeof config.sourceRepo === "string" &&
          typeof config.hostRootUrl === "string" &&
          (config.destinationBranch === undefined ||
            isSafePullRequestBranch(config.destinationBranch))
        );
      })
    );
  }

  /* Reviewed Files */
  public getActiveCodeReview(repo: string): ActiveCodeReview | null {
    if (repo === "") return null;
    return this.getRepos()[repo]?.codeReview ?? null;
  }

  public async startCodeReview(
    repo: string,
    id: string,
    commitHash: string,
    compareWithHash: string | null,
    files: string[]
  ): Promise<ActiveCodeReview | null> {
    if (repo === "" || id === "" || !isValidCommitHash(commitHash)) return null;
    if (compareWithHash !== null && !isValidCommitHash(compareWithHash)) return null;
    const normalizedFiles = normalizeReviewedFilePaths(files);
    if (normalizedFiles.length === 0) return null;

    const review: ActiveCodeReview = {
      id,
      commitHash,
      compareWithHash,
      files: normalizedFiles,
      startedAt: Date.now()
    };
    const repos = this.getRepos();
    const state = repos[repo];
    if (state === undefined) return null;
    repos[repo] = { ...state, codeReview: review };
    await this.workspaceState.update(REPO_STATES, this.normalizeRepoSet(repos));
    return review;
  }

  public async endCodeReview(repo: string): Promise<boolean> {
    const repos = this.getRepos();
    const state = repos[repo];
    if (
      repo === "" ||
      state === undefined ||
      state.codeReview === undefined ||
      state.codeReview === null
    ) {
      return false;
    }
    repos[repo] = { ...state, codeReview: null };
    await this.workspaceState.update(REPO_STATES, this.normalizeRepoSet(repos));
    return true;
  }

  public getReviewedFiles(repo: string, commitHash: string): string[] {
    if (repo === "" || !isValidCommitHash(commitHash)) return [];

    const reviewedFiles = this.readReviewedFiles()[repo]?.[commitHash];
    return reviewedFiles === undefined ? [] : normalizeReviewedFilePaths(reviewedFiles);
  }

  public async setFileReviewed(
    repo: string,
    commitHash: string,
    filePath: string,
    reviewed: boolean
  ): Promise<boolean> {
    if (repo === "" || !isValidCommitHash(commitHash)) return false;

    const normalizedPath = normalizeReviewedFilePath(filePath);
    if (normalizedPath === null) return false;

    const reviewedFiles = this.readReviewedFiles();
    const commits = { ...reviewedFiles[repo] };
    const currentFiles = normalizeReviewedFilePaths(commits[commitHash] ?? []);
    const currentSet = new Set(currentFiles);
    const isChanged = reviewed ? !currentSet.has(normalizedPath) : currentSet.has(normalizedPath);

    if (isChanged) {
      if (reviewed) {
        currentSet.add(normalizedPath);
      } else {
        currentSet.delete(normalizedPath);
      }
    }

    if (currentSet.size === 0) {
      delete commits[commitHash];
    } else {
      commits[commitHash] = [...currentSet].sort((a, b) => a.localeCompare(b));
    }

    if (Object.keys(commits).length === 0) {
      delete reviewedFiles[repo];
    } else {
      reviewedFiles[repo] = commits;
    }

    try {
      await this.workspaceState.update(REVIEWED_FILES, reviewedFiles);
      return true;
    } catch {
      return false;
    }
  }

  /* Avatars */
  public waitForAvatarStorage(): Promise<void> {
    return this.avatarStorageInit;
  }
  public isAvatarStorageAvailable() {
    return this.avatarStorageAvailable;
  }
  public getAvatarStoragePath() {
    return path.join(this.globalStoragePath, AVATAR_STORAGE_FOLDER);
  }
  public getAvatarCache() {
    return this.globalState.get<AvatarCache>(AVATAR_CACHE, {});
  }
  public saveAvatar(email: string, avatar: Avatar) {
    let avatars = this.getAvatarCache();
    avatars[email] = avatar;
    this.globalState.update(AVATAR_CACHE, avatars);
  }
  public removeAvatarFromCache(email: string) {
    let avatars = this.getAvatarCache();
    delete avatars[email];
    this.globalState.update(AVATAR_CACHE, avatars);
  }
  public async clearAvatarCache() {
    this.globalState.update(AVATAR_CACHE, {});
    const avatarDir = path.join(this.globalStoragePath, AVATAR_STORAGE_FOLDER);
    try {
      const files = await fs.readdir(avatarDir);
      await Promise.all(files.map((file) => fs.unlink(path.join(avatarDir, file)).catch(() => {})));
    } catch {
      // Directory may not exist; nothing to clean up
    }
  }

  private readReviewedFiles(): ReviewedFilesByRepo {
    return readReviewedFileMap(this.workspaceState.get<ReviewedFilesByRepo>(REVIEWED_FILES, {}));
  }

  private normalizeRepoSet(gitRepoSet: GitRepoSet): GitRepoSet {
    let normalizedRepoSet: GitRepoSet | null = null;

    for (const [repo, state] of Object.entries(gitRepoSet)) {
      const normalizedState = this.normalizeRepoState(state);
      if (normalizedState === state) {
        continue;
      }

      if (normalizedRepoSet === null) {
        normalizedRepoSet = { ...gitRepoSet };
      }
      normalizedRepoSet[repo] = normalizedState;
    }

    return normalizedRepoSet ?? gitRepoSet;
  }

  private normalizeRepoState(state: GitRepoState): GitRepoState {
    const recentActions = state.recentActions;
    if (recentActions === undefined || recentActions.length <= 1) {
      return state;
    }

    const normalizedRecentActions = this.normalizeRecentActions(recentActions);
    if (normalizedRecentActions === recentActions) {
      return state;
    }

    return {
      ...state,
      recentActions: normalizedRecentActions
    };
  }

  private normalizeRecentActions(recentActions: RecentActionId[]): RecentActionId[] {
    const seen = new Set<RecentActionId>();
    const normalizedRecentActions: RecentActionId[] = [];

    for (const actionId of recentActions) {
      if (seen.has(actionId)) {
        continue;
      }
      seen.add(actionId);
      normalizedRecentActions.push(actionId);
      if (normalizedRecentActions.length === MAX_RECENT_ACTIONS) {
        break;
      }
    }

    if (
      normalizedRecentActions.length === recentActions.length &&
      normalizedRecentActions.every((actionId, index) => actionId === recentActions[index])
    ) {
      return recentActions;
    }

    return normalizedRecentActions;
  }
}

function normalizeIssueLinks(value: unknown): RepositorySettingsIssueLinks {
  if (typeof value !== "object" || value === null) {
    return { ...EMPTY_ISSUE_LINKS };
  }

  const settings = value as Partial<RepositorySettingsIssueLinks>;
  return {
    enabled: settings.enabled === true,
    regex: typeof settings.regex === "string" ? settings.regex : "",
    urlTemplate: typeof settings.urlTemplate === "string" ? settings.urlTemplate : ""
  };
}

function readReviewedFileMap(value: unknown): ReviewedFilesByRepo {
  if (typeof value !== "object" || value === null) return {};
  return value as ReviewedFilesByRepo;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

function normalizeReviewedFilePath(filePath: string): string | null {
  const normalizedPath = getPathFromStr(filePath);
  if (
    normalizedPath === "" ||
    normalizedPath.startsWith("/") ||
    normalizedPath.endsWith("/") ||
    /^[a-z]:/i.test(normalizedPath) ||
    normalizedPath === "." ||
    normalizedPath.includes("//") ||
    hasControlCharacter(normalizedPath)
  ) {
    return null;
  }

  const segments = normalizedPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  return normalizedPath;
}

function normalizeReviewedFilePaths(filePaths: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedPaths: string[] = [];

  for (const filePath of filePaths) {
    if (typeof filePath !== "string") continue;
    const normalizedPath = normalizeReviewedFilePath(filePath);
    if (normalizedPath === null || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    normalizedPaths.push(normalizedPath);
  }

  return normalizedPaths.sort((a, b) => a.localeCompare(b));
}
