import * as cp from "node:child_process";
import * as path from "node:path";

import {
  type FetchOptions,
  normalizeAdvancedOperationOptions,
  type PullOptions,
  toGitArgumentTokens
} from "../web/advancedOperationOptions";
import { CUSTOM_BRANCH_GLOB_ARGUMENT_PREFIX, getConfig } from "./config";
import { ExtensionState } from "./extensionState";
import { DEFAULT_GIT_PATH, resolveGitExecutable } from "./gitExecutable";
import {
  detectPullRequestProvider,
  inferPullRequestDestination,
  isSafePullRequestBranch,
  resolvePullRequestConfig
} from "./pullRequest";
import { isSafeRemoteName, isValidRefName } from "./refValidation";
import {
  DEFAULT_REPOSITORY_VISIBILITY,
  filterRemoteHeadRefs,
  normalizeRepositoryVisibility,
  type RepositoryVisibility
} from "./repositoryVisibility";
import { parseForCatFileTag, type TagDetails } from "./tagDetails";
import {
  ArchiveFormat,
  CheckoutBranchResult,
  CommitOrdering,
  GitCommandStatus,
  GitCommit,
  GitCommitDetails,
  GitCommitNode,
  GitDiffTool,
  GitFileChange,
  GitFileChangeType,
  GitRefData,
  GitResetMode,
  GitSignatureStatus,
  GitStash,
  GitUnsavedChanges,
  PushPreparation,
  PushTarget,
  RemoteBranchTarget,
  RepositorySettingsAction,
  RepositorySettingsIssueLinks,
  RepositorySettingsPullRequestDestination,
  RepositorySettingsRemote,
  RepositorySettingsResult,
  RepositorySettingsUserDetails,
  RepositorySettingsUserScope,
  RepositorySettingsUserValue,
  UNCOMMITTED_CHANGES_HASH,
  VALID_UNCOMMITTED_RESET_MODES,
  WorktreeCollection
} from "./types";
import { getPathFromStr, isValidCommitHash } from "./utils";
import { parseWorktreeList } from "./worktree";

const eolRegex = /\r\n|\r|\n/g;
const headRegex = /^\(HEAD detached (at|from) .+\)$/;
const REGEX_META_CHARS = /[.*+?^${}()|[\]\\]/g;
const gitLogSeparator = "XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb";
const NO_QUOTE_PATH_CONFIG = ["-c", "core.quotePath=false"];
const LOG_FORMAT_FIELD_COUNT = 6;
const SIGNATURE_FIELD_COUNT = 6;
const COMMIT_DETAILS_FIELD_COUNT = 7;
const STASH_FORMAT_FIELD_COUNT = 7;
const STASH_SHOW_INCLUDE_UNTRACKED_OPTION = "-u";
const DIFF_FILTER_AMDR_OPTION = "--diff-filter=AMDR";
const DIFF_FILTER_R_OPTION = "--diff-filter=R";
const DIFF_FIND_RENAMES_OPTION = "--find-renames";
const NULL_BYTE_OPTION = "-z";
const NULL_BYTE_SEPARATOR = "\0";
const NAME_STATUS_OPTION = "--name-status";
const NUMSTAT_OPTION = "--numstat";
const NO_WALK_SORTED_OPTION = "--no-walk=sorted";
const TAB_SEPARATOR = "\t";
const VALID_FILE_CHANGE_TYPES: ReadonlySet<string> = new Set(["A", "M", "D", "R"]);

export const COMMIT_ORDER_FLAGS: Readonly<Record<CommitOrdering, string>> = {
  date: "--date-order",
  topo: "--topo-order",
  "author-date": "--author-date-order"
};

/**
 * Commit details format field indices (used in gitCommitDetailsFormat and commitDetails parser).
 * Maps to: %H(hash), %P(parents), %an(author), %ae(email), dateType, %cn(committer), %ce(committerEmail)
 */
const COMMIT_DETAILS_FIELD = {
  HASH: 0,
  PARENTS: 1,
  AUTHOR: 2,
  EMAIL: 3,
  DATE: 4,
  COMMITTER: 5,
  COMMITTER_EMAIL: 6
} as const;

function escapeRegExp(str: string): string {
  return str.replace(REGEX_META_CHARS, "\\$&");
}

const VALID_GIT_REFS = new Set([
  "HEAD",
  "MERGE_HEAD",
  "ORIG_HEAD",
  "FETCH_HEAD",
  "CHERRY_PICK_HEAD"
]);
function isValidGitRef(ref: string): boolean {
  return VALID_GIT_REFS.has(ref);
}

const INVALID_COMMIT_HASH_MESSAGE = "Invalid commit hash.";
const INVALID_REF_NAME_MESSAGE = "Invalid ref name.";
const INVALID_REMOTE_NAME_MESSAGE = "Invalid remote name.";
const INVALID_REMOTE_URL_MESSAGE = "Invalid remote URL.";
const INVALID_PULL_REQUEST_DESTINATION_MESSAGE = "Invalid pull-request destination branch.";
const UNKNOWN_REMOTE_MESSAGE = "The remote is not registered in this repository.";
const USER_DETAILS_REQUIRED_MESSAGE = "User name and email are required.";
const USER_DETAILS_CONTROL_MESSAGE = "User details contain invalid control characters.";
const GIT_QUERY_FAILED_MESSAGE = "Git command failed.";
const REFS_HEADS_PREFIX = "refs/heads/";
const OPTION_ARG_PREFIX = "-";
const PUSH_REFSPEC_SEPARATOR = ":";

/**
 * Result of a read-only Git query that has to tell "the query ran and produced
 * this output" apart from "the query itself failed", so that a failure is never
 * mistaken for an empty result.
 */
type GitQueryResult =
  | { kind: "ok"; stdout: string }
  | { kind: "error"; exitCode: number | null; status: string };

type GitConfigValuesResult =
  | { kind: "ok"; values: string[] }
  | { kind: "error"; status: string };

type RemoteNamesResult = { kind: "ok"; remotes: string[] } | { kind: "error"; status: string };

const REMOTE_URL_PATTERN = /\s|\p{Cc}/u;
const CONTROL_CHAR_PATTERN = /\p{Cc}/u;
const REPOSITORY_SETTINGS_FETCH = "fetch";
const REPOSITORY_SETTINGS_PUSH = "push";

function parseNullSeparatedValues(stdout: string): string[] {
  if (stdout === "") return [];
  return stdout.endsWith("\0") ? stdout.slice(0, -1).split("\0") : [stdout];
}

function selectConfigValue(values: string[]): string | null {
  return values.at(-1) ?? null;
}

function resolveUserValue(
  localValues: string[],
  globalValues: string[]
): RepositorySettingsUserValue {
  const localValue = selectConfigValue(localValues);
  const globalValue = selectConfigValue(globalValues);
  const source: RepositorySettingsUserScope | null =
    localValue === null ? (globalValue === null ? null : "global") : "local";
  return {
    effectiveValue: localValue ?? globalValue,
    source,
    localValue,
    globalValue
  };
}

function isSafeUserDetail(value: string): boolean {
  return value !== "" && !CONTROL_CHAR_PATTERN.test(value);
}

function isRefNameSafe(refName: string): boolean {
  return !refName.startsWith(OPTION_ARG_PREFIX);
}

const VALID_RESET_MODES = new Set(["soft", "mixed", "hard"]);

const ARCHIVE_FORMAT_EXTENSIONS: Readonly<Record<ArchiveFormat, string>> = {
  zip: ".zip",
  tar: ".tar",
  "tar.gz": ".tar.gz"
};
const INVALID_ARCHIVE_PATH_MESSAGE = "Invalid archive output path.";
const INVALID_FILE_PATH_MESSAGE = "Invalid file path.";
const INVALID_REVISION_MESSAGE = "Invalid revision.";

function parseGitLogCommits(stdout: string): GitCommit[] {
  const lines = stdout.split(eolRegex);
  const gitCommits: GitCommit[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].split(gitLogSeparator);
    if (line.length !== LOG_FORMAT_FIELD_COUNT) break;
    gitCommits.push({
      hash: line[0],
      parentHashes: line[1].split(" ").filter(Boolean),
      author: line[2],
      email: line[3],
      date: parseInt(line[4], 10),
      message: line[5]
    });
  }
  return gitCommits;
}

export function parseGitSignatureStatus(fields: readonly string[]): GitSignatureStatus | null {
  if (fields.length < SIGNATURE_FIELD_COUNT) return null;
  const [status, key, signer, fingerprint, primaryKeyFingerprint, trustLevel] = fields;
  if (status === "" || status.length !== 1) return null;
  return {
    status,
    key,
    signer,
    fingerprint,
    primaryKeyFingerprint,
    trustLevel
  };
}

function isSafeRepositoryRelativePath(filePath: string): boolean {
  if (
    filePath === "" ||
    filePath.includes("\0") ||
    filePath.includes("\\") ||
    path.isAbsolute(filePath)
  ) {
    return false;
  }

  const normalizedPath = path.normalize(filePath);
  if (normalizedPath === ".." || normalizedPath.startsWith("../")) return false;
  return normalizedPath.split("/").every((segment) => segment !== ".git");
}

function isSafeRevision(revision: string): boolean {
  return isValidCommitHash(revision) || isValidRefName(revision);
}

function containsUnsafePathCharacters(value: string): boolean {
  if (value.includes("\0")) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isSafeArchiveOutputPath(repo: string, outputPath: string, format: ArchiveFormat): boolean {
  if (
    outputPath === "" ||
    containsUnsafePathCharacters(outputPath) ||
    !path.isAbsolute(outputPath)
  ) {
    return false;
  }

  const expectedExtension = ARCHIVE_FORMAT_EXTENSIONS[format];
  if (!outputPath.toLowerCase().endsWith(expectedExtension)) return false;

  const resolvedOutputPath = path.resolve(outputPath);
  const resolvedRepoPath = path.resolve(repo);
  const relativeToRepo = path.relative(resolvedRepoPath, resolvedOutputPath);
  if (
    relativeToRepo === "" ||
    (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo))
  ) {
    return false;
  }

  return true;
}

/**
 * Collect the HEAD of every detached worktree, deduplicated and restricted to
 * hashes that pass validation, so that only safe values reach the Git arguments.
 */
function collectDetachedHeads(worktrees: WorktreeCollection): string[] {
  const heads = new Set<string>();
  for (const worktree of worktrees.detached) {
    if (isValidCommitHash(worktree.head)) heads.add(worktree.head);
  }
  return [...heads];
}

function isSafeRemoteUrl(url: string): boolean {
  return url !== "" && !REMOTE_URL_PATTERN.test(url);
}

function getRepositoryName(repositoryPath: string): string {
  const separatorIndex = Math.max(
    repositoryPath.lastIndexOf(path.sep),
    repositoryPath.lastIndexOf("/")
  );
  return separatorIndex === -1 ? repositoryPath : repositoryPath.substring(separatorIndex + 1);
}

function parseRemoteVerbose(stdout: string): RepositorySettingsRemote[] {
  const remoteLookup = new Map<string, { fetch?: string; push?: string }>();

  for (const line of stdout.split(eolRegex)) {
    const nameSeparator = line.indexOf("\t");
    if (nameSeparator === -1) continue;

    const name = line.substring(0, nameSeparator);
    if (!isSafeRemoteName(name)) continue;

    const remainder = line.substring(nameSeparator + 1);
    const suffixSeparator = remainder.lastIndexOf(" (");
    if (suffixSeparator === -1 || !remainder.endsWith(")")) continue;

    const direction = remainder.substring(suffixSeparator + 2, remainder.length - 1);
    const url = remainder.substring(0, suffixSeparator);
    if (!isSafeRemoteUrl(url)) continue;

    const remote = remoteLookup.get(name) ?? {};
    if (direction === REPOSITORY_SETTINGS_FETCH) {
      remote.fetch = url;
    } else if (direction === REPOSITORY_SETTINGS_PUSH) {
      remote.push = url;
    }
    remoteLookup.set(name, remote);
  }

  return [...remoteLookup.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, urls]) =>
      urls.fetch === undefined
        ? []
        : [
            {
              name,
              url: urls.fetch,
              ...(urls.push !== undefined && urls.push !== urls.fetch ? { pushUrl: urls.push } : {})
            }
          ]
    );
}

function parseLocalBranches(stdout: string): string[] {
  return stdout
    .split(eolRegex)
    .map((line) => line.trim())
    .filter(isSafePullRequestBranch)
    .sort((left, right) => left.localeCompare(right));
}

function parseRemoteHead(stdout: string, remoteName: string): string | null {
  const refPrefix = `refs/remotes/${remoteName}/`;
  const ref = stdout.trim();
  return ref.startsWith(refPrefix) ? ref.slice(refPrefix.length) : null;
}

export class DataSource {
  private gitPath: string = DEFAULT_GIT_PATH;
  private gitLogFormat!: string;
  private gitStashFormat!: string;
  private gitCommitDetailsFormat!: string;
  private readonly extensionState?: ExtensionState;

  constructor(extensionState?: ExtensionState) {
    this.extensionState = extensionState;
    this.generateGitCommandFormats();
  }

  public async registerGitPath(): Promise<void> {
    this.gitPath = await resolveGitExecutable(getConfig().gitPath());
  }

  public generateGitCommandFormats() {
    let dateType = getConfig().dateType() === "Author Date" ? "%at" : "%ct";
    const config = getConfig();
    const authorName = config.useMailmap() ? "%aN" : "%an";
    const authorEmail = config.useMailmap() ? "%aE" : "%ae";
    const committerName = config.useMailmap() ? "%cN" : "%cn";
    const committerEmail = config.useMailmap() ? "%cE" : "%ce";
    this.gitLogFormat = ["%H", "%P", authorName, authorEmail, dateType, "%s"].join(gitLogSeparator);
    this.gitStashFormat = ["%H", "%P", "%gD", authorName, authorEmail, dateType, "%s"].join(
      gitLogSeparator
    );
    const commitDetailsFields = [
      "%H",
      "%P",
      authorName,
      authorEmail,
      dateType,
      committerName,
      committerEmail
    ];
    if (config.showSignatureStatus()) {
      commitDetailsFields.push("%G?", "%GK", "%GS", "%GF", "%GP", "%GT");
    }
    this.gitCommitDetailsFormat = `${commitDetailsFields.join(gitLogSeparator)}%n%B`;
  }

  public getBranches(repo: string, showRemoteBranches: boolean) {
    return this.spawnGit<{ branches: string[]; head: string | null; error: boolean }>(
      ["branch", ...(showRemoteBranches ? ["-a"] : [])],
      repo,
      (stdout) => {
        let branchData: { branches: string[]; head: string | null; error: boolean } = {
          branches: [],
          head: null,
          error: false
        };
        let lines = stdout.split(eolRegex);
        for (let i = 0; i < lines.length - 1; i++) {
          let name = lines[i].substring(2).split(" -> ")[0];
          if (name.match(headRegex) !== null) continue;
          if (name.startsWith("remotes/")) continue;

          if (lines[i][0] === "*") {
            branchData.head = name;
            branchData.branches.unshift(name);
          } else {
            branchData.branches.push(name);
          }
        }
        return branchData;
      },
      { branches: [], head: null, error: true }
    );
  }

  public async getCommits(
    repo: string,
    branches: string[],
    maxCommits: number,
    showRemoteBranches: boolean,
    authors: string[],
    commitOrdering: CommitOrdering
  ) {
    const worktrees = await this.getWorktrees(repo);
    const visibility = normalizeRepositoryVisibility(
      this.extensionState?.getRepositoryVisibility(repo) ?? DEFAULT_REPOSITORY_VISIBILITY
    );

    const [commits, refData, stashes, authorList, pinnedCommits] = await Promise.all([
      this.getGitLog(
        repo,
        branches,
        maxCommits + 1,
        showRemoteBranches,
        authors,
        commitOrdering,
        visibility
      ),
      this.getRefs(repo, showRemoteBranches, visibility),
      visibility.showStashes ? this.getStashes(repo) : Promise.resolve<GitStash[]>([]),
      this.getAuthors(repo),
      this.getPinnedDetachedCommits(repo, collectDetachedHeads(worktrees), authors)
    ]);

    const moreCommitsAvailable = commits.length === maxCommits + 1;
    if (moreCommitsAvailable) commits.pop();

    const knownHashes = new Set(commits.map((commit) => commit.hash));
    for (const pinnedCommit of pinnedCommits) {
      if (knownHashes.has(pinnedCommit.hash)) continue;
      knownHashes.add(pinnedCommit.hash);
      commits.push(pinnedCommit);
    }

    if (refData.head !== null) {
      for (let i = 0; i < commits.length; i++) {
        if (refData.head === commits[i].hash) {
          const unsavedChanges = getConfig().showUncommittedChanges()
            ? await this.getGitUnsavedChanges(repo)
            : null;
          if (unsavedChanges !== null) {
            commits.unshift({
              hash: UNCOMMITTED_CHANGES_HASH,
              parentHashes: [refData.head],
              author: UNCOMMITTED_CHANGES_HASH,
              email: "",
              date: Math.round(new Date().getTime() / 1000),
              message: `Uncommitted Changes (${unsavedChanges.changes})`
            });
          }
          break;
        }
      }
    }

    const commitNodes: GitCommitNode[] = [];
    const commitLookup: { [hash: string]: number } = {};

    for (let i = 0; i < commits.length; i++) {
      commitLookup[commits[i].hash] = i;
      commitNodes.push({
        hash: commits[i].hash,
        parentHashes: commits[i].parentHashes,
        author: commits[i].author,
        email: commits[i].email,
        date: commits[i].date,
        message: commits[i].message,
        refs: [],
        stash: null
      });
    }
    const toInsert: { index: number; data: GitStash }[] = [];
    for (let i = 0; i < stashes.length; i++) {
      if (typeof commitLookup[stashes[i].hash] === "number") {
        commitNodes[commitLookup[stashes[i].hash]].stash = {
          selector: stashes[i].selector,
          baseHash: stashes[i].baseHash,
          untrackedFilesHash: stashes[i].untrackedFilesHash
        };
      } else if (typeof commitLookup[stashes[i].baseHash] === "number") {
        toInsert.push({ index: commitLookup[stashes[i].baseHash], data: stashes[i] });
      }
    }
    toInsert.sort((a, b) => (a.index !== b.index ? a.index - b.index : b.data.date - a.data.date));
    for (let i = toInsert.length - 1; i >= 0; i--) {
      const stash = toInsert[i].data;
      commitNodes.splice(toInsert[i].index, 0, {
        hash: stash.hash,
        parentHashes: [stash.baseHash],
        author: stash.author,
        email: stash.email,
        date: stash.date,
        message: stash.message,
        refs: [],
        stash: {
          selector: stash.selector,
          baseHash: stash.baseHash,
          untrackedFilesHash: stash.untrackedFilesHash
        }
      });
    }
    for (let i = 0; i < commitNodes.length; i++) {
      commitLookup[commitNodes[i].hash] = i;
    }

    for (let i = 0; i < refData.refs.length; i++) {
      if (typeof commitLookup[refData.refs[i].hash] === "number") {
        commitNodes[commitLookup[refData.refs[i].hash]].refs.push(refData.refs[i]);
      }
    }

    return {
      commits: commitNodes,
      head: refData.head,
      moreCommitsAvailable: moreCommitsAvailable,
      authors: authorList,
      worktrees
    };
  }

  public async commitDetails(
    repo: string,
    commitHash: string,
    hasParents: boolean,
    isStash: boolean
  ): Promise<GitCommitDetails | null> {
    if (!isValidCommitHash(commitHash)) {
      return null;
    }
    const parseSignature = getConfig().showSignatureStatus();
    try {
      const nameStatusArgs = this.buildDiffArgs(
        isStash,
        hasParents,
        NAME_STATUS_OPTION,
        commitHash
      );
      const numStatArgs = this.buildDiffArgs(isStash, hasParents, NUMSTAT_OPTION, commitHash);
      const isRootCommit = !hasParents && !isStash;
      const splitDiffOutput = (stdout: string): string[] => {
        const fields = stdout.split(NULL_BYTE_SEPARATOR);
        if (isRootCommit) fields.shift();
        return fields;
      };
      const [details, nameStatusFields, numStatFields] = await Promise.all([
        this.spawnGit<GitCommitDetails | null>(
          ["show", "--quiet", commitHash, `--format=${this.gitCommitDetailsFormat}`],
          repo,
          (stdout) => {
            let lines = stdout.split(eolRegex);
            let lastLine = lines.length - 1;
            while (lines.length > 0 && lines[lastLine] === "") lastLine--;
            let commitInfo = lines[0].split(gitLogSeparator);
            return {
              hash: commitInfo[COMMIT_DETAILS_FIELD.HASH],
              parents: commitInfo[COMMIT_DETAILS_FIELD.PARENTS].split(" ").filter(Boolean),
              author: commitInfo[COMMIT_DETAILS_FIELD.AUTHOR],
              email: commitInfo[COMMIT_DETAILS_FIELD.EMAIL],
              date: parseInt(commitInfo[COMMIT_DETAILS_FIELD.DATE], 10),
              committer: commitInfo[COMMIT_DETAILS_FIELD.COMMITTER],
              committerEmail: commitInfo[COMMIT_DETAILS_FIELD.COMMITTER_EMAIL] ?? "",
              body: lines.slice(1, lastLine + 1).join("\n"),
              fileChanges: [],
              signature: parseSignature
                ? parseGitSignatureStatus(commitInfo.slice(COMMIT_DETAILS_FIELD_COUNT))
                : null
            };
          },
          null
        ),
        this.spawnGit<string[]>(nameStatusArgs, repo, splitDiffOutput, []),
        this.spawnGit<string[]>(numStatArgs, repo, splitDiffOutput, [])
      ]);

      if (details === null) return null;

      const fileLookup: { [file: string]: number } = {};

      let ns = 0;
      while (ns < nameStatusFields.length && nameStatusFields[ns] !== "") {
        const statusChar = (nameStatusFields[ns] ?? "")[0] ?? "";
        if (!VALID_FILE_CHANGE_TYPES.has(statusChar)) break;
        if (statusChar === "R") {
          const oldPath = getPathFromStr(nameStatusFields[ns + 1] ?? "");
          const newPath = getPathFromStr(nameStatusFields[ns + 2] ?? "");
          fileLookup[newPath] = details.fileChanges.length;
          details.fileChanges.push({
            oldFilePath: oldPath,
            newFilePath: newPath,
            type: statusChar as GitFileChangeType,
            additions: null,
            deletions: null
          });
          ns += 3;
        } else {
          const filePath = getPathFromStr(nameStatusFields[ns + 1] ?? "");
          fileLookup[filePath] = details.fileChanges.length;
          details.fileChanges.push({
            oldFilePath: filePath,
            newFilePath: filePath,
            type: statusChar as GitFileChangeType,
            additions: null,
            deletions: null
          });
          ns += 2;
        }
      }

      this.applyNumStatRecords(numStatFields, fileLookup, details.fileChanges);
      return details;
    } catch {
      return null;
    }
  }

  public async getUncommittedDetails(repo: string): Promise<GitCommitDetails | null> {
    try {
      const visibility = normalizeRepositoryVisibility(
        this.extensionState?.getRepositoryVisibility(repo) ?? DEFAULT_REPOSITORY_VISIBILITY
      );
      const [nameStatus, numStat, untrackedFiles] = await Promise.all([
        this.spawnGit<string[]>(
          [
            ...NO_QUOTE_PATH_CONFIG,
            "diff",
            "HEAD",
            "--name-status",
            "--find-renames",
            "--diff-filter=AMDR",
            NULL_BYTE_OPTION
          ],
          repo,
          (stdout) => stdout.split(NULL_BYTE_SEPARATOR),
          []
        ),
        this.spawnGit<string[]>(
          [
            ...NO_QUOTE_PATH_CONFIG,
            "diff",
            "HEAD",
            "--numstat",
            "--find-renames",
            "--diff-filter=AMDR",
            NULL_BYTE_OPTION
          ],
          repo,
          (stdout) => stdout.split(NULL_BYTE_SEPARATOR),
          []
        ),
        visibility.showUntrackedFiles
          ? this.spawnGit<string[]>(
              [
                ...NO_QUOTE_PATH_CONFIG,
                "ls-files",
                "--others",
                "--exclude-standard",
                NULL_BYTE_OPTION
              ],
              repo,
              (stdout) => stdout.split(NULL_BYTE_SEPARATOR),
              []
            )
          : Promise.resolve<string[]>([])
      ]);

      const details: GitCommitDetails = {
        hash: UNCOMMITTED_CHANGES_HASH,
        parents: [],
        author: "",
        email: "",
        date: 0,
        committer: "",
        committerEmail: "",
        body: "",
        fileChanges: []
      };

      const fileLookup: { [file: string]: number } = {};
      let ns = 0;
      while (ns < nameStatus.length && nameStatus[ns] !== "") {
        const statusChar = (nameStatus[ns] ?? "")[0] ?? "";
        if (!VALID_FILE_CHANGE_TYPES.has(statusChar)) break;
        if (statusChar === "R") {
          const oldFilePath = getPathFromStr(nameStatus[ns + 1] ?? "");
          const newFilePath = getPathFromStr(nameStatus[ns + 2] ?? "");
          fileLookup[newFilePath] = details.fileChanges.length;
          details.fileChanges.push({
            oldFilePath,
            newFilePath,
            type: statusChar as GitFileChangeType,
            additions: null,
            deletions: null
          });
          ns += 3;
        } else {
          const filePath = getPathFromStr(nameStatus[ns + 1] ?? "");
          fileLookup[filePath] = details.fileChanges.length;
          details.fileChanges.push({
            oldFilePath: filePath,
            newFilePath: filePath,
            type: statusChar as GitFileChangeType,
            additions: null,
            deletions: null
          });
          ns += 2;
        }
      }

      this.applyNumStatRecords(numStat, fileLookup, details.fileChanges);

      for (let i = 0; i < untrackedFiles.length; i++) {
        const filePath = untrackedFiles[i];
        if (filePath === "" || typeof fileLookup[filePath] === "number") continue;
        details.fileChanges.push({
          oldFilePath: filePath,
          newFilePath: filePath,
          type: "A",
          additions: null,
          deletions: null
        });
      }

      return details;
    } catch {
      return null;
    }
  }

  public async getDiffTool(repo: string): Promise<GitDiffTool | null> {
    const result = await this.runGitQuery(
      ["config", "--null", "--get-regexp", "^(diff)\\.(guitool|tool)$"],
      repo
    );
    if (result.kind === "error") return null;

    let terminalTool: string | null = null;
    for (const record of result.stdout.split(NULL_BYTE_SEPARATOR)) {
      const separator = record.indexOf("\n");
      if (separator === -1) continue;
      const key = record.slice(0, separator);
      const value = record.slice(separator + 1);
      if (key === "diff.guitool" && value !== "") {
        return { mode: "gui", name: value };
      }
      if (key === "diff.tool" && value !== "") terminalTool = value;
    }
    return terminalTool === null ? null : { mode: "terminal", name: terminalTool };
  }

  public async openExternalDirDiff(repo: string, args: string[]): Promise<GitCommandStatus> {
    return this.runGitCommandSpawn(args, repo);
  }

  public async getCommitComparison(
    repo: string,
    fromHash: string,
    toHash: string
  ): Promise<GitFileChange[] | null> {
    const isFromUncommitted = fromHash === UNCOMMITTED_CHANGES_HASH;
    const isToWorkingTree = isFromUncommitted || toHash === "";

    const diffBaseHash = isFromUncommitted ? toHash : fromHash;

    if (diffBaseHash !== "" && !isValidCommitHash(diffBaseHash)) {
      return null;
    }
    if (!isToWorkingTree && !isValidCommitHash(toHash)) {
      return null;
    }

    try {
      const nameStatusArgs = [
        ...NO_QUOTE_PATH_CONFIG,
        "diff",
        "--name-status",
        "--find-renames",
        "--diff-filter=AMDR",
        NULL_BYTE_OPTION,
        diffBaseHash
      ];
      const numStatArgs = [
        ...NO_QUOTE_PATH_CONFIG,
        "diff",
        "--numstat",
        "--find-renames",
        "--diff-filter=AMDR",
        NULL_BYTE_OPTION,
        diffBaseHash
      ];

      if (!isToWorkingTree) {
        nameStatusArgs.push(toHash);
        numStatArgs.push(toHash);
      }

      const gitCommands: Promise<string[]>[] = [
        this.spawnGit<string[]>(
          nameStatusArgs,
          repo,
          (stdout) => stdout.split(NULL_BYTE_SEPARATOR),
          []
        ),
        this.spawnGit<string[]>(
          numStatArgs,
          repo,
          (stdout) => stdout.split(NULL_BYTE_SEPARATOR),
          []
        )
      ];
      if (isToWorkingTree) {
        gitCommands.push(
          this.spawnGit<string[]>(
            [
              ...NO_QUOTE_PATH_CONFIG,
              "ls-files",
              "--others",
              "--exclude-standard",
              NULL_BYTE_OPTION
            ],
            repo,
            (stdout) => stdout.split(NULL_BYTE_SEPARATOR),
            []
          )
        );
      }

      const results = await Promise.all(gitCommands);
      const nameStatus = results[0];
      const numStat = results[1];
      const untrackedFiles = results[2] ?? [];

      const fileChanges: GitFileChange[] = [];
      const fileLookup: { [file: string]: number } = {};

      let ns = 0;
      while (ns < nameStatus.length && nameStatus[ns] !== "") {
        const statusChar = (nameStatus[ns] ?? "")[0] ?? "";
        if (!VALID_FILE_CHANGE_TYPES.has(statusChar)) break;
        if (statusChar === "R") {
          const oldFilePath = getPathFromStr(nameStatus[ns + 1] ?? "");
          const newFilePath = getPathFromStr(nameStatus[ns + 2] ?? "");
          fileLookup[newFilePath] = fileChanges.length;
          fileChanges.push({
            oldFilePath,
            newFilePath,
            type: statusChar as GitFileChangeType,
            additions: null,
            deletions: null
          });
          ns += 3;
        } else {
          const filePath = getPathFromStr(nameStatus[ns + 1] ?? "");
          fileLookup[filePath] = fileChanges.length;
          fileChanges.push({
            oldFilePath: filePath,
            newFilePath: filePath,
            type: statusChar as GitFileChangeType,
            additions: null,
            deletions: null
          });
          ns += 2;
        }
      }

      this.applyNumStatRecords(numStat, fileLookup, fileChanges);

      for (let i = 0; i < untrackedFiles.length; i++) {
        const filePath = untrackedFiles[i];
        if (filePath === "" || typeof fileLookup[filePath] === "number") continue;
        fileChanges.push({
          oldFilePath: filePath,
          newFilePath: filePath,
          type: "A",
          additions: null,
          deletions: null
        });
      }

      return fileChanges;
    } catch {
      return null;
    }
  }

  public getCommitFile(repo: string, commitHash: string, filePath: string) {
    return this.getCommitFileRaw(repo, commitHash, filePath).then((bytes) =>
      bytes.toString("utf8")
    );
  }

  public getCommitFileRaw(repo: string, commitHash: string, filePath: string): Promise<Buffer> {
    const baseHash = commitHash.replace(/\^$/, "");
    if (!isValidCommitHash(baseHash) && !isValidGitRef(baseHash)) {
      return Promise.resolve(Buffer.alloc(0));
    }
    if (filePath.split("/").includes("..")) {
      return Promise.resolve(Buffer.alloc(0));
    }
    return this.spawnGitBuffer(["show", `${commitHash}:${filePath}`], repo);
  }

  public resolveRefToHash(repo: string, ref: string): Promise<string | null> {
    if (!isValidGitRef(ref)) {
      return Promise.resolve(null);
    }
    return this.spawnGit<string | null>(
      ["rev-parse", ref],
      repo,
      (stdout) => stdout.split(eolRegex)[0] || null,
      null
    );
  }

  public getNewPathOfRenamedFile(
    repo: string,
    commitHash: string,
    oldFilePath: string
  ): Promise<string | null> {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(null);
    }
    if (oldFilePath.split("/").includes("..")) {
      return Promise.resolve(null);
    }
    return this.spawnGit<string | null>(
      [
        "diff",
        NAME_STATUS_OPTION,
        DIFF_FILTER_R_OPTION,
        DIFF_FIND_RENAMES_OPTION,
        NULL_BYTE_OPTION,
        commitHash,
        "HEAD"
      ],
      repo,
      (stdout) => {
        // Format: status\0oldPath\0newPath\0...
        const fields = stdout.split(NULL_BYTE_SEPARATOR);
        let cursor = 0;
        while (cursor < fields.length && fields[cursor] !== "") {
          const statusChar = (fields[cursor] ?? "")[0] ?? "";
          if (!VALID_FILE_CHANGE_TYPES.has(statusChar)) break;
          if (statusChar === "R") {
            const oldPath = getPathFromStr(fields[cursor + 1] ?? "");
            if (oldPath === oldFilePath) {
              return getPathFromStr(fields[cursor + 2] ?? "");
            }
            cursor += 3;
          } else {
            cursor += 2;
          }
        }
        return null;
      },
      null
    );
  }

  public getRemoteUrl(repo: string) {
    return this.spawnGit<string | null>(
      ["config", "--get", "remote.origin.url"],
      repo,
      (stdout) => stdout.split(eolRegex)[0],
      null
    );
  }

  public isGitRepository(path: string) {
    return this.spawnGit<boolean>(["rev-parse", "--git-dir"], path, () => true, false);
  }

  public async getRepositoryStateWatchPaths(repo: string): Promise<string[]> {
    const [gitDir, gitCommonDir] = await Promise.all([
      this.spawnGit<string | null>(
        ["rev-parse", "--git-dir"],
        repo,
        (stdout) => stdout.trim() || null,
        null
      ),
      this.spawnGit<string | null>(
        ["rev-parse", "--git-common-dir"],
        repo,
        (stdout) => stdout.trim() || null,
        null
      )
    ]);

    const watchPaths = new Set<string>();
    for (const watchPath of [gitDir, gitCommonDir]) {
      if (watchPath === null || watchPath === "") continue;
      watchPaths.add(
        path.normalize(path.isAbsolute(watchPath) ? watchPath : path.resolve(repo, watchPath))
      );
    }

    return Array.from(watchPaths);
  }

  public addTag(
    repo: string,
    tagName: string,
    commitHash: string,
    lightweight: boolean,
    message: string
  ) {
    if (!isRefNameSafe(tagName)) {
      return Promise.resolve(INVALID_REF_NAME_MESSAGE);
    }
    let args = ["tag"];
    if (lightweight) {
      args.push(tagName);
    } else {
      args.push("-a", tagName, "-m", message);
    }
    args.push(commitHash);
    return this.runGitCommandSpawn(args, repo);
  }

  public deleteTag(repo: string, tagName: string) {
    return this.runGitCommandSpawn(["tag", "-d", tagName], repo);
  }

  public pushTag(repo: string, tagName: string) {
    return this.runGitCommandSpawn(["push", "origin", tagName], repo);
  }

  public async getTagDetails(repo: string, tagName: string): Promise<TagDetails | null> {
    if (!isRefNameSafe(tagName)) return null;
    const result = await this.runGitQuery(["cat-file", "-p", `refs/tags/${tagName}`], repo);
    if (result.kind === "error") return null;
    const hash = await this.resolveRefToHash(repo, `refs/tags/${tagName}`);
    return parseForCatFileTag(result.stdout, tagName, hash ?? undefined);
  }

  public createBranch(repo: string, branchName: string, commitHash: string) {
    if (!isRefNameSafe(branchName)) {
      return Promise.resolve(INVALID_REF_NAME_MESSAGE);
    }
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    return this.runGitCommandSpawn(["branch", branchName, commitHash], repo);
  }

  public async checkoutBranch(
    repo: string,
    branchName: string,
    remoteBranch: RemoteBranchTarget | null
  ): Promise<CheckoutBranchResult> {
    if (!isValidRefName(branchName)) {
      return { kind: "invalidRef" };
    }
    if (remoteBranch === null) {
      return {
        kind: "completed",
        status: await this.runGitCommandSpawn(["checkout", branchName], repo)
      };
    }
    if (
      typeof remoteBranch !== "object" ||
      typeof remoteBranch.remoteName !== "string" ||
      typeof remoteBranch.branchName !== "string"
    ) {
      return { kind: "invalidRef" };
    }
    const remoteTrackingRef = `${remoteBranch.remoteName}/${remoteBranch.branchName}`;
    if (
      !isSafeRemoteName(remoteBranch.remoteName) ||
      !isValidRefName(remoteBranch.branchName) ||
      !isValidRefName(remoteTrackingRef)
    ) {
      return { kind: "invalidRef" };
    }

    const existingBranch = await this.runGitQuery(["branch", "--list", branchName], repo);
    if (existingBranch.kind === "error") {
      return { kind: "completed", status: existingBranch.status };
    }
    if (existingBranch.stdout.trim() === "") {
      return {
        kind: "completed",
        status: await this.runGitCommandSpawn(
          ["checkout", "--track", "-b", branchName, remoteTrackingRef],
          repo
        )
      };
    }
    if (branchName !== remoteBranch.branchName) {
      return { kind: "branchExists" };
    }

    const remotes = await this.queryRemoteNames(repo);
    if (remotes.kind === "error") {
      return { kind: "completed", status: remotes.status };
    }
    if (!remotes.remotes.includes(remoteBranch.remoteName)) {
      return { kind: "remoteNotFound" };
    }

    const checkoutStatus = await this.runGitCommandSpawn(["checkout", branchName], repo);
    if (checkoutStatus !== null) {
      return { kind: "completed", status: checkoutStatus };
    }

    const pullStatus = await this.runGitCommandSpawn(
      ["pull", remoteBranch.remoteName, remoteBranch.branchName],
      repo
    );
    return pullStatus === null
      ? { kind: "completed", status: null }
      : { kind: "pullFailed", status: pullStatus };
  }

  public checkoutCommit(repo: string, commitHash: string) {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    return this.runGitCommandSpawn(["checkout", commitHash], repo);
  }

  public deleteBranch(repo: string, branchName: string, forceDelete: boolean) {
    return this.runGitCommandSpawn(
      ["branch", "--delete", ...(forceDelete ? ["--force"] : []), branchName],
      repo
    );
  }

  public async renameBranch(
    repo: string,
    oldName: string,
    newName: string,
    updateUpstream: boolean
  ) {
    if (!isRefNameSafe(newName)) {
      return INVALID_REF_NAME_MESSAGE;
    }
    const status = await this.runGitCommandSpawn(["branch", "-m", oldName, newName], repo);
    if (status !== null || !updateUpstream) {
      return status;
    }
    // If no remote is configured for this branch (e.g. a newly created branch that was never
    // pushed), set it to "origin" so that subsequent pushes work without --set-upstream.
    const remoteConfigured = await this.runGitCommandSpawn(
      ["config", "--get", `branch.${newName}.remote`],
      repo
    );
    if (remoteConfigured !== null) {
      const setRemote = await this.runGitCommandSpawn(
        ["config", `branch.${newName}.remote`, "origin"],
        repo
      );
      if (setRemote !== null) return setRemote;
    }
    return this.runGitCommandSpawn(
      ["config", `branch.${newName}.merge`, `refs/heads/${newName}`],
      repo
    );
  }

  public mergeBranch(
    repo: string,
    branchName: string,
    createNewCommit: boolean,
    squash: boolean,
    noCommit: boolean
  ) {
    const args = ["merge", branchName];
    if (squash) {
      args.push("--squash");
    } else if (createNewCommit) {
      args.push("--no-ff");
    }
    if (noCommit) {
      args.push("--no-commit");
    }
    return this.runGitCommandSpawn(args, repo);
  }

  public deleteRemoteBranch(repo: string, remoteName: string, branchName: string) {
    return this.runGitCommandSpawn(["push", remoteName, "--delete", branchName], repo);
  }

  public rebaseBranch(repo: string, branchName: string) {
    return this.runGitCommandSpawn(["rebase", branchName], repo);
  }

  public mergeCommit(
    repo: string,
    commitHash: string,
    createNewCommit: boolean,
    squash: boolean,
    noCommit: boolean
  ) {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    const args = ["merge", commitHash];
    if (squash) {
      args.push("--squash");
    } else if (createNewCommit) {
      args.push("--no-ff");
    }
    if (noCommit) {
      args.push("--no-commit");
    }
    return this.runGitCommandSpawn(args, repo);
  }

  public cherrypickCommit(
    repo: string,
    commitHash: string,
    parentIndex: number,
    recordOrigin: boolean,
    noCommit: boolean
  ) {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    if (!Number.isInteger(parentIndex) || parentIndex < 0) {
      return Promise.resolve("Invalid parent index.");
    }
    const args = ["cherry-pick", commitHash];
    if (parentIndex > 0) {
      args.push("-m", String(parentIndex));
    }
    if (recordOrigin) {
      args.push("-x");
    }
    if (noCommit) {
      args.push("--no-commit");
    }
    return this.runGitCommandSpawn(args, repo);
  }

  public revertCommit(repo: string, commitHash: string, parentIndex: number) {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    if (!Number.isInteger(parentIndex) || parentIndex < 0) {
      return Promise.resolve("Invalid parent index.");
    }
    return this.runGitCommandSpawn(
      ["revert", "--no-edit", commitHash, ...(parentIndex > 0 ? ["-m", String(parentIndex)] : [])],
      repo
    );
  }

  public async dropCommit(repo: string, commitHash: string): Promise<GitCommandStatus> {
    if (!isValidCommitHash(commitHash)) {
      return INVALID_COMMIT_HASH_MESSAGE;
    }

    const parents = await this.runGitQuery(["rev-list", "--parents", "-1", commitHash], repo);
    if (parents.kind === "error") {
      return "Unable to read the commit's parents.";
    }

    const hashes = parents.stdout.split(eolRegex)[0]?.split(" ").filter(Boolean) ?? [];
    if (hashes.length !== 2) {
      return "Only non-merge commits with a parent can be dropped.";
    }

    return this.runGitCommandSpawn(["rebase", "--onto", `${commitHash}^`, commitHash], repo);
  }

  public resetFileToRevision(
    repo: string,
    revision: string,
    filePath: string
  ): Promise<GitCommandStatus> {
    if (!isSafeRevision(revision)) {
      return Promise.resolve(INVALID_REVISION_MESSAGE);
    }
    if (!isSafeRepositoryRelativePath(filePath)) {
      return Promise.resolve(INVALID_FILE_PATH_MESSAGE);
    }
    return this.runGitCommandSpawn(["checkout", revision, "--", filePath], repo);
  }

  public createArchive(
    repo: string,
    commitHash: string,
    format: ArchiveFormat,
    outputPath: string
  ): Promise<GitCommandStatus> {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    if (!isSafeArchiveOutputPath(repo, outputPath, format)) {
      return Promise.resolve(INVALID_ARCHIVE_PATH_MESSAGE);
    }
    return this.runGitCommandSpawn(
      ["archive", `--format=${format}`, `--output=${outputPath}`, commitHash],
      repo
    );
  }

  public resetToCommit(repo: string, commitHash: string, resetMode: GitResetMode) {
    if (!isValidCommitHash(commitHash)) {
      return Promise.resolve(INVALID_COMMIT_HASH_MESSAGE);
    }
    if (!VALID_RESET_MODES.has(resetMode)) {
      return Promise.resolve("Invalid reset mode.");
    }
    return this.runGitCommandSpawn(["reset", `--${resetMode}`, commitHash], repo);
  }

  public applyStash(repo: string, selector: string, reinstateIndex: boolean) {
    const args = ["stash", "apply"];
    if (reinstateIndex) args.push("--index");
    args.push(selector);
    return this.runGitCommandSpawn(args, repo);
  }

  public popStash(repo: string, selector: string, reinstateIndex: boolean) {
    const args = ["stash", "pop"];
    if (reinstateIndex) args.push("--index");
    args.push(selector);
    return this.runGitCommandSpawn(args, repo);
  }

  public dropStash(repo: string, selector: string) {
    return this.runGitCommandSpawn(["stash", "drop", selector], repo);
  }

  public branchFromStash(repo: string, branchName: string, selector: string) {
    return this.runGitCommandSpawn(["stash", "branch", branchName, selector], repo);
  }

  public pushStash(repo: string, message: string, includeUntracked: boolean) {
    const args = ["stash", "push"];
    if (message !== "") args.push("--message", message);
    if (includeUntracked) args.push("--include-untracked");
    return this.runGitCommandSpawn(args, repo);
  }

  public resetUncommitted(repo: string, mode: string) {
    if (!VALID_UNCOMMITTED_RESET_MODES.has(mode)) {
      return Promise.resolve("Invalid reset mode.");
    }
    return this.runGitCommandSpawn(["reset", `--${mode}`, "HEAD"], repo);
  }

  public cleanUntrackedFiles(repo: string, directories: boolean) {
    const args = ["clean", "-f"];
    if (directories) args.push("-d");
    return this.runGitCommandSpawn(args, repo);
  }

  public pull(repo: string, options?: Partial<PullOptions>): Promise<GitCommandStatus> {
    const normalizedOptions = normalizeAdvancedOperationOptions("pull", options);
    const modeCount = [
      normalizedOptions.noFastForward,
      normalizedOptions.squash,
      normalizedOptions.rebase
    ].filter((enabled) => enabled).length;

    if (modeCount > 1) {
      return Promise.resolve("At most one of no-fast-forward, squash, or rebase may be selected.");
    }
    if (normalizedOptions.ignoreDate && !normalizedOptions.rebase) {
      return Promise.resolve("Ignore date may only be used with rebase.");
    }

    return this.runGitCommandSpawn(
      ["pull", ...toGitArgumentTokens("pull", normalizedOptions)],
      repo
    );
  }

  public async preparePush(repo: string): Promise<PushPreparation> {
    const currentBranch = await this.runGitQuery(["branch", "--show-current"], repo);
    if (currentBranch.kind === "error") {
      return { kind: "error", status: currentBranch.status };
    }

    // An empty current branch means a detached HEAD, which has no upstream to read.
    const branchName = currentBranch.stdout.split(eolRegex)[0] ?? "";
    if (branchName !== "") {
      const target = await this.readUpstreamTarget(repo, branchName);
      if (target !== null) {
        return { kind: "upstream", target };
      }
    }

    const remotes = await this.queryRemoteNames(repo);
    if (remotes.kind === "error") {
      return { kind: "error", status: remotes.status };
    }
    return { kind: "selectRemote", remotes: remotes.remotes };
  }

  public async getRemotes(repo: string): Promise<string[] | null> {
    const remotes = await this.queryRemoteNames(repo);
    return remotes.kind === "ok" ? remotes.remotes : null;
  }

  public pushToUpstream(repo: string, target: PushTarget): Promise<GitCommandStatus> {
    if (!isSafeRemoteName(target.remoteName)) {
      return Promise.resolve(INVALID_REMOTE_NAME_MESSAGE);
    }
    if (!isValidRefName(target.localBranchName) || !isValidRefName(target.upstreamBranchName)) {
      return Promise.resolve(INVALID_REF_NAME_MESSAGE);
    }
    const refspec = [target.localBranchName, target.upstreamBranchName].join(
      PUSH_REFSPEC_SEPARATOR
    );
    return this.runGitCommandSpawn(["push", target.remoteName, refspec], repo);
  }

  public pushWithUpstream(repo: string, remoteName: string): Promise<GitCommandStatus> {
    if (!isSafeRemoteName(remoteName)) {
      return Promise.resolve(INVALID_REMOTE_NAME_MESSAGE);
    }
    return this.runGitCommandSpawn(["push", "--set-upstream", remoteName, "HEAD"], repo);
  }

  private async readUpstreamTarget(repo: string, branchName: string): Promise<PushTarget | null> {
    const [remote, merge] = await Promise.all([
      this.runGitQuery(["config", "--get", `branch.${branchName}.remote`], repo),
      this.runGitQuery(["config", "--get", `branch.${branchName}.merge`], repo)
    ]);
    if (remote.kind === "error" || merge.kind === "error") {
      return null;
    }

    const remoteName = remote.stdout.split(eolRegex)[0] ?? "";
    const mergeRef = merge.stdout.split(eolRegex)[0] ?? "";
    if (!mergeRef.startsWith(REFS_HEADS_PREFIX)) {
      return null;
    }
    const upstreamBranch = mergeRef.substring(REFS_HEADS_PREFIX.length);
    if (!isSafeRemoteName(remoteName) || !isValidRefName(upstreamBranch)) {
      return null;
    }
    return {
      remoteName,
      localBranchName: branchName,
      upstreamBranchName: upstreamBranch
    };
  }

  private async queryRemoteNames(repo: string): Promise<RemoteNamesResult> {
    const result = await this.runGitQuery(["remote"], repo);
    if (result.kind === "error") {
      return { kind: "error", status: result.status };
    }
    const remotes = result.stdout
      .split(eolRegex)
      .map((line) => line.trim())
      .filter((line) => line !== "" && isSafeRemoteName(line))
      .sort();
    return { kind: "ok", remotes };
  }

  public fetch(repo: string, options?: Partial<FetchOptions>) {
    if (options === undefined) {
      const args = ["fetch", "--all", "--prune"];
      if (getConfig().fetchAndPruneTags()) args.push("--prune-tags");
      return this.runGitCommandSpawn(args, repo);
    }

    const normalizedOptions = normalizeAdvancedOperationOptions("fetch", options);
    const args = ["fetch", "--all", ...toGitArgumentTokens("fetch", normalizedOptions)];
    return this.runGitCommandSpawn(args, repo);
  }

  public async getRepositorySettings(repo: string): Promise<RepositorySettingsResult> {
    const result = await this.runGitQuery(["remote", "-v"], repo);
    if (result.kind === "error") {
      return { kind: "error", status: result.status };
    }

    const user = await this.getUserDetails(repo);
    if (user.kind === "error") {
      return { kind: "error", status: user.status };
    }

    const remotes = parseRemoteVerbose(result.stdout);
    const storedPullRequest = this.extensionState?.getRepositoryPullRequest(repo) ?? null;
    const detected = remotes.find((remote) => detectPullRequestProvider(remote.url) !== null);
    const sourceRemoteName = storedPullRequest?.sourceRemoteName ?? detected?.name;
    let destination: RepositorySettingsPullRequestDestination | undefined;

    if (sourceRemoteName !== undefined) {
      const [branchesResult, remoteHeadResult] = await Promise.all([
        this.runGitQuery(["for-each-ref", "--format=%(refname:short)", "refs/heads"], repo),
        this.runGitQuery(["symbolic-ref", "--quiet", `refs/remotes/${sourceRemoteName}/HEAD`], repo)
      ]);
      const branches =
        branchesResult.kind === "ok" ? parseLocalBranches(branchesResult.stdout) : [];
      const remoteHead =
        remoteHeadResult.kind === "ok"
          ? parseRemoteHead(remoteHeadResult.stdout, sourceRemoteName)
          : null;
      const defaultBranch = inferPullRequestDestination(remoteHead, branches);
      destination = {
        branches,
        defaultBranch,
        selectedBranch: null
      };
    }

    const defaultBranch = destination?.defaultBranch ?? null;
    const pullRequest =
      storedPullRequest === null
        ? detected === undefined
          ? null
          : resolvePullRequestConfig({
              provider: detectPullRequestProvider(detected.url)!,
              remoteName: detected.name,
              remoteUrl: detected.url,
              ...(defaultBranch === null ? {} : { destinationBranch: defaultBranch })
            })
        : defaultBranch === null || storedPullRequest.destinationBranch !== undefined
          ? storedPullRequest
          : { ...storedPullRequest, destinationBranch: defaultBranch };

    if (destination !== undefined) {
      destination.selectedBranch = storedPullRequest?.destinationBranch ?? null;
    }

    return {
      kind: "ok",
      data: {
        repositoryName: getRepositoryName(repo),
        repositoryPath: repo,
        remotes,
        visibility:
          this.extensionState?.getRepositoryVisibility(repo) ?? DEFAULT_REPOSITORY_VISIBILITY,
        issueLinks: this.extensionState?.getRepositorySettingsIssueLinks(repo) ?? {
          enabled: false,
          regex: "",
          urlTemplate: ""
        },
        pullRequest,
        user: user.details,
        ...(destination === undefined ? {} : { pullRequestDestination: destination })
      }
    };
  }

  public async saveRepositorySettingsIssueLinks(
    repo: string,
    issueLinks: RepositorySettingsIssueLinks
  ): Promise<void> {
    this.extensionState?.saveRepositorySettingsIssueLinks(repo, issueLinks);
  }

  public async repositorySettingsAction(
    repo: string,
    action: RepositorySettingsAction
  ): Promise<GitCommandStatus> {
    switch (action.type) {
      case "addRemote":
        return this.addRemote(repo, action.name, action.url, action.pushUrl);
      case "editRemote":
        return this.editRemote(repo, action.originalName, action.name, action.url, action.pushUrl);
      case "deleteRemote":
        return this.deleteRemote(repo, action.name);
      case "fetchRemote":
        return this.fetchRemote(repo, action.name);
      case "fetchPruneRemote":
        return this.fetchPruneRemote(repo, action.name);
      case "pruneTagsRemote":
        return this.pruneTagsRemote(repo, action.name);
      case "saveIssueLinks":
        await this.saveRepositorySettingsIssueLinks(repo, action.settings);
        return null;
      case "saveVisibility":
        this.extensionState?.saveRepositoryVisibility(repo, action.settings);
        return null;
      case "savePullRequest": {
        if (
          action.settings.destinationBranch !== undefined &&
          !(await this.hasLocalBranch(repo, action.settings.destinationBranch))
        ) {
          return INVALID_PULL_REQUEST_DESTINATION_MESSAGE;
        }
        const settings = await this.getRepositorySettings(repo);
        if (settings.kind === "error") return GIT_QUERY_FAILED_MESSAGE;
        const remote = settings.data.remotes.find(
          (candidate) => candidate.name === action.settings.remoteName
        );
        if (remote === undefined) return UNKNOWN_REMOTE_MESSAGE;
        await this.extensionState?.saveRepositoryPullRequest(repo, remote.url, action.settings);
        return null;
      }
      case "saveUserDetails":
        return this.saveUserDetails(repo, action.scope, action.name, action.email);
      case "removeUserDetails":
        return this.removeUserDetails(repo, action.scope);
    }
  }

  private async saveUserDetails(
    repo: string,
    scope: RepositorySettingsUserScope,
    name: string,
    email: string
  ): Promise<GitCommandStatus> {
    if (!isSafeUserDetail(name) || !isSafeUserDetail(email)) {
      return name === "" || email === ""
        ? USER_DETAILS_REQUIRED_MESSAGE
        : USER_DETAILS_CONTROL_MESSAGE;
    }

    if (scope === "local") {
      const localNameStatus = await this.setUserConfig("local", "user.name", name, repo);
      if (localNameStatus !== null) return localNameStatus;
      return this.setUserConfig("local", "user.email", email, repo);
    }

    const globalNameStatus = await this.setUserConfig("global", "user.name", name, repo);
    if (globalNameStatus !== null) return globalNameStatus;

    if (globalNameStatus !== null) return globalNameStatus;
    const globalEmailStatus = await this.setUserConfig(
      "global",
      "user.email",
      email,
      repo
    );
    if (globalEmailStatus !== null) return globalEmailStatus;

    const localValues = await this.getUserDetails(repo);
    if (localValues.kind === "error") return localValues.status;
    if (
      localValues.details.name.localValue === null &&
      localValues.details.email.localValue === null
    ) {
      return null;
    }
    return this.removeLocalOverrides(repo);
  }

  private async removeUserDetails(
    repo: string,
    scope: RepositorySettingsUserScope
  ): Promise<GitCommandStatus> {
    const nameStatus = await this.unsetUserConfig(scope, "user.name", repo);
    if (nameStatus !== null) return nameStatus;
    return this.unsetUserConfig(scope, "user.email", repo);
  }

  private async removeLocalOverrides(repo: string): Promise<GitCommandStatus> {
    const nameStatus = await this.unsetUserConfig("local", "user.name", repo);
    if (nameStatus !== null) return nameStatus;
    return this.unsetUserConfig("local", "user.email", repo);
  }

  private async unsetUserConfig(
    scope: RepositorySettingsUserScope,
    key: "user.name" | "user.email",
    repo: string
  ): Promise<GitCommandStatus> {
    const result = await this.runGitQuery(
      ["config", "--unset-all", scope === "local" ? "--local" : "--global", key],
      repo
    );
    // Git exits 1 for a missing key lookup and 5 for an already-absent value.
    if (result.kind === "ok" || result.exitCode === 1 || result.exitCode === 5) {
      return null;
    }
    return result.status;
  }

  private setUserConfig(
    scope: RepositorySettingsUserScope,
    key: "user.name" | "user.email",
    value: string,
    repo: string
  ): Promise<GitCommandStatus> {
    return this.runGitCommandSpawn(
      ["config", "--replace-all", scope === "local" ? "--local" : "--global", key, value],
      repo
    );
  }

  private async getGitConfigValues(
    repo: string,
    key: "user.name" | "user.email",
    scope: RepositorySettingsUserScope
  ): Promise<GitConfigValuesResult> {
    const result = await this.runGitQuery(
      ["config", "--null", "--get-all", scope === "local" ? "--local" : "--global", key],
      repo
    );
    if (result.kind === "ok") {
      return { kind: "ok", values: parseNullSeparatedValues(result.stdout) };
    }
    if (result.exitCode === 1) {
      return { kind: "ok", values: [] };
    }
    return { kind: "error", status: result.status };
  }

  private async getUserDetails(repo: string): Promise<
    | { kind: "ok"; details: RepositorySettingsUserDetails }
    | { kind: "error"; status: string }
  > {
    const [nameLocal, nameGlobal, emailLocal, emailGlobal] = await Promise.all([
      this.getGitConfigValues(repo, "user.name", "local"),
      this.getGitConfigValues(repo, "user.name", "global"),
      this.getGitConfigValues(repo, "user.email", "local"),
      this.getGitConfigValues(repo, "user.email", "global")
    ]);
    const results = [nameLocal, nameGlobal, emailLocal, emailGlobal];
    for (const result of results) {
      if (result.kind === "error") return result;
    }
    if (
      nameLocal.kind !== "ok" ||
      nameGlobal.kind !== "ok" ||
      emailLocal.kind !== "ok" ||
      emailGlobal.kind !== "ok"
    ) {
      return { kind: "error", status: GIT_QUERY_FAILED_MESSAGE };
    }

    return {
      kind: "ok",
      details: {
        name: resolveUserValue(nameLocal.values, nameGlobal.values),
        email: resolveUserValue(emailLocal.values, emailGlobal.values)
      }
    };
  }

  private async hasLocalBranch(repo: string, branchName: string): Promise<boolean> {
    if (!isSafePullRequestBranch(branchName)) return false;
    const result = await this.runGitQuery(
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      repo
    );
    return result.kind === "ok" && parseLocalBranches(result.stdout).includes(branchName);
  }

  public async addRemote(
    repo: string,
    name: string,
    url: string,
    pushUrl?: string
  ): Promise<GitCommandStatus> {
    if (!isSafeRemoteName(name)) return INVALID_REMOTE_NAME_MESSAGE;
    if (!isSafeRemoteUrl(url) || (pushUrl !== undefined && !isSafeRemoteUrl(pushUrl))) {
      return INVALID_REMOTE_URL_MESSAGE;
    }

    const remotes = await this.queryRemoteNames(repo);
    if (remotes.kind === "error") return remotes.status;
    if (remotes.remotes.includes(name)) return UNKNOWN_REMOTE_MESSAGE;

    const status = await this.runGitCommandSpawn(["remote", "add", name, url], repo);
    if (status !== null || pushUrl === undefined || pushUrl === url) return status;
    return this.runGitCommandSpawn(["remote", "set-url", "--push", name, pushUrl], repo);
  }

  public async editRemote(
    repo: string,
    originalName: string,
    name: string,
    url: string,
    pushUrl?: string
  ): Promise<GitCommandStatus> {
    if (!isSafeRemoteName(originalName) || !isSafeRemoteName(name)) {
      return INVALID_REMOTE_NAME_MESSAGE;
    }
    if (!isSafeRemoteUrl(url) || (pushUrl !== undefined && !isSafeRemoteUrl(pushUrl))) {
      return INVALID_REMOTE_URL_MESSAGE;
    }

    const remotes = await this.queryRemoteNames(repo);
    if (remotes.kind === "error") return remotes.status;
    if (!remotes.remotes.includes(originalName)) return UNKNOWN_REMOTE_MESSAGE;
    if (name !== originalName && remotes.remotes.includes(name)) return UNKNOWN_REMOTE_MESSAGE;

    if (name !== originalName) {
      const renameStatus = await this.runGitCommandSpawn(
        ["remote", "rename", originalName, name],
        repo
      );
      if (renameStatus !== null) return renameStatus;
    }

    const urlStatus = await this.runGitCommandSpawn(["remote", "set-url", name, url], repo);
    if (urlStatus !== null) return urlStatus;
    if (pushUrl === undefined) return null;
    return this.runGitCommandSpawn(["remote", "set-url", "--push", name, pushUrl], repo);
  }

  public async deleteRemote(repo: string, name: string): Promise<GitCommandStatus> {
    return this.runRemoteAction(repo, name, (remoteName) =>
      this.runGitCommandSpawn(["remote", "remove", remoteName], repo)
    );
  }

  public fetchRemote(repo: string, name: string): Promise<GitCommandStatus> {
    return this.runRemoteAction(repo, name, (remoteName) =>
      this.runGitCommandSpawn(["fetch", remoteName], repo)
    );
  }

  public fetchPruneRemote(repo: string, name: string): Promise<GitCommandStatus> {
    return this.runRemoteAction(repo, name, (remoteName) =>
      this.runGitCommandSpawn(["fetch", "--prune", remoteName], repo)
    );
  }

  public pruneTagsRemote(repo: string, name: string): Promise<GitCommandStatus> {
    return this.runRemoteAction(repo, name, (remoteName) =>
      this.runGitCommandSpawn(["fetch", "--prune", "--prune-tags", remoteName], repo)
    );
  }

  private async runRemoteAction(
    repo: string,
    name: string,
    action: (remoteName: string) => Promise<GitCommandStatus>
  ): Promise<GitCommandStatus> {
    if (!isSafeRemoteName(name)) {
      return INVALID_REMOTE_NAME_MESSAGE;
    }
    const remotes = await this.queryRemoteNames(repo);
    if (remotes.kind === "error") return remotes.status;
    if (!remotes.remotes.includes(name)) return UNKNOWN_REMOTE_MESSAGE;
    return action(name);
  }

  public getWorktrees(repo: string) {
    return this.spawnGit<WorktreeCollection>(
      ["worktree", "list", "--porcelain"],
      repo,
      (stdout) => parseWorktreeList(stdout),
      { branches: {}, detached: [] }
    );
  }

  public addWorktree(repo: string, path: string, branchName: string, commitHash?: string) {
    if (commitHash !== undefined) {
      return this.runGitCommandSpawn(["worktree", "add", "-b", branchName, path, commitHash], repo);
    }
    return this.runGitCommandSpawn(["worktree", "add", path, branchName], repo);
  }

  public removeWorktree(repo: string, worktreePath: string) {
    return this.runGitCommandSpawn(["worktree", "remove", worktreePath], repo);
  }

  private getRefs(
    repo: string,
    showRemoteBranches: boolean,
    visibility: RepositoryVisibility
  ): Promise<GitRefData> {
    let args = ["show-ref"];
    if (!showRemoteBranches) {
      args.push("--heads");
      if (visibility.showTags) args.push("--tags");
    }
    args.push("-d", "--head");

    return this.spawnGit<GitRefData>(
      args,
      repo,
      (stdout) => {
        const refData: GitRefData = { head: null, refs: [] };
        const lines = stdout.split(eolRegex);
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].split(" ");
          if (line.length < 2) continue;

          const hash = line.shift()!;
          const ref = line.join(" ");

          if (ref.startsWith("refs/heads/")) {
            refData.refs.push({ hash: hash, name: ref.substring(11), type: "head" });
          } else if (ref.startsWith("refs/tags/")) {
            refData.refs.push({
              hash: hash,
              name: ref.endsWith("^{}") ? ref.substring(10, ref.length - 3) : ref.substring(10),
              type: "tag"
            });
          } else if (ref.startsWith("refs/remotes/")) {
            const name = ref.substring(13);
            refData.refs.push({ hash: hash, name: name, type: "remote" });
          } else if (ref === "HEAD") {
            refData.head = hash;
          }
        }
        return {
          head: refData.head,
          refs: filterRemoteHeadRefs(refData.refs, visibility)
        };
      },
      { head: null, refs: [] }
    );
  }

  private getGitLog(
    repo: string,
    branches: string[],
    num: number,
    showRemoteBranches: boolean,
    authors: string[],
    commitOrdering: CommitOrdering,
    visibility: RepositoryVisibility
  ) {
    const config = getConfig();
    const configuredGlobArguments = new Set(config.customBranchGlobArguments());
    const validBranches = branches.filter((branch) => {
      if (branch.startsWith(CUSTOM_BRANCH_GLOB_ARGUMENT_PREFIX)) {
        return configuredGlobArguments.has(branch);
      }
      return isValidRefName(branch);
    });
    const args = [
      "log",
      `--max-count=${num}`,
      `--format=${this.gitLogFormat}`,
      COMMIT_ORDER_FLAGS[commitOrdering]
    ];
    if (config.onlyFollowFirstParent()) args.push("--first-parent");
    if (config.includeCommitsMentionedByReflogs() && branches.length === 0) args.push("--reflog");
    for (const author of authors) {
      args.push(`--author=${escapeRegExp(author)}`);
    }
    if (validBranches.length > 0) {
      args.push(...validBranches);
    } else if (branches.length === 0) {
      args.push("--branches");
      if (visibility.showTags) args.push("--tags");
      if (showRemoteBranches) args.push("--remotes");
    } else {
      return Promise.resolve<GitCommit[]>([]);
    }

    return this.spawnGit<GitCommit[]>(args, repo, parseGitLogCommits, []);
  }

  /**
   * Fetch the given detached worktree HEADs themselves, without walking their
   * history, so that a HEAD outside the normal commit window can still be shown.
   * The author filter is shared with the normal log, the branch filter is not.
   */
  private getPinnedDetachedCommits(repo: string, heads: string[], authors: string[]) {
    if (heads.length === 0) return Promise.resolve<GitCommit[]>([]);

    const args = ["log", NO_WALK_SORTED_OPTION, `--format=${this.gitLogFormat}`];
    for (const author of authors) {
      args.push(`--author=${escapeRegExp(author)}`);
    }
    args.push(...heads);

    return this.spawnGit<GitCommit[]>(args, repo, parseGitLogCommits, []);
  }

  private getGitUnsavedChanges(repo: string) {
    return this.spawnGit<GitUnsavedChanges | null>(
      ["status", "-s", "--branch", "--untracked-files", "--porcelain"],
      repo,
      (stdout) => {
        let lines = stdout.split(eolRegex);
        return lines.length > 2
          ? { branch: lines[0].substring(3).split("...")[0], changes: lines.length - 2 }
          : null;
      },
      null
    );
  }

  private getAuthors(repo: string) {
    return this.spawnGit<string[]>(
      ["shortlog", "-s", "HEAD"],
      repo,
      (stdout) => {
        const lines = stdout.split(eolRegex);
        const authors: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          const tabIndex = lines[i].indexOf("\t");
          if (tabIndex === -1) continue;
          const name = lines[i].substring(tabIndex + 1);
          if (name !== "") {
            authors.push(name);
          }
        }
        return authors.sort();
      },
      []
    );
  }

  private getStashes(repo: string) {
    return this.spawnGit<GitStash[]>(
      ["reflog", `--format=${this.gitStashFormat}`, "refs/stash", "--"],
      repo,
      (stdout) => {
        const lines = stdout.split(eolRegex);
        const stashes: GitStash[] = [];
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].split(gitLogSeparator);
          if (line.length !== STASH_FORMAT_FIELD_COUNT || line[1] === "") continue;
          const parentHashes = line[1].split(" ");
          stashes.push({
            hash: line[0],
            baseHash: parentHashes[0],
            untrackedFilesHash: parentHashes.length === 3 ? parentHashes[2] : null,
            selector: line[2],
            author: line[3],
            email: line[4],
            date: parseInt(line[5], 10),
            message: line[6]
          });
        }
        return stashes;
      },
      []
    );
  }

  private buildDiffArgs(
    isStash: boolean,
    hasParents: boolean,
    statOption: string,
    commitHash: string
  ): string[] {
    if (isStash) {
      return [
        "stash",
        "show",
        STASH_SHOW_INCLUDE_UNTRACKED_OPTION,
        statOption,
        DIFF_FIND_RENAMES_OPTION,
        DIFF_FILTER_AMDR_OPTION,
        NULL_BYTE_OPTION,
        commitHash
      ];
    }
    if (hasParents) {
      return [
        "diff",
        statOption,
        DIFF_FIND_RENAMES_OPTION,
        DIFF_FILTER_AMDR_OPTION,
        NULL_BYTE_OPTION,
        `${commitHash}^`,
        commitHash
      ];
    }
    return [
      "diff-tree",
      statOption,
      "-r",
      "--root",
      DIFF_FIND_RENAMES_OPTION,
      DIFF_FILTER_AMDR_OPTION,
      NULL_BYTE_OPTION,
      commitHash
    ];
  }

  /**
   * Applies additions/deletions from NUL-separated numstat fields onto fileChanges.
   * Record forms: "add\tdel\tpath" (cursor +1), or rename "add\tdel\t" with the old/new
   * paths in the following two NUL fields (cursor +3). Only the first two TABs delimit
   * the numeric fields, so paths containing TABs are preserved in full. A malformed
   * record (fewer than two TABs) is skipped on its own; subsequent records are parsed.
   */
  private applyNumStatRecords(
    numStatFields: string[],
    fileLookup: { [file: string]: number },
    fileChanges: GitFileChange[]
  ) {
    let ni = 0;
    while (ni < numStatFields.length && numStatFields[ni] !== "") {
      const record = numStatFields[ni];
      const firstTab = record.indexOf(TAB_SEPARATOR);
      const secondTab = firstTab === -1 ? -1 : record.indexOf(TAB_SEPARATOR, firstTab + 1);
      if (secondTab === -1) {
        ni += 1;
        continue;
      }
      const additions = parseInt(record.substring(0, firstTab), 10);
      const deletions = parseInt(record.substring(firstTab + 1, secondTab), 10);
      const rawPath = record.substring(secondTab + 1);
      let filePath: string;
      if (rawPath !== "") {
        filePath = getPathFromStr(rawPath);
        ni += 1;
      } else {
        filePath = getPathFromStr(numStatFields[ni + 2] ?? "");
        ni += 3;
      }
      const idx = fileLookup[filePath];
      if (typeof idx === "number" && fileChanges[idx] !== undefined) {
        fileChanges[idx].additions = Number.isNaN(additions) ? null : additions;
        fileChanges[idx].deletions = Number.isNaN(deletions) ? null : deletions;
      }
    }
  }

  private runGitCommandSpawn(args: string[], repo: string) {
    return new Promise<GitCommandStatus>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let err = false;
      const cmd = cp.spawn(this.gitPath, args, {
        cwd: repo,
        env: { ...process.env, LC_ALL: "C" }
      });
      cmd.stdout.on("data", (d: string | Buffer) => {
        stdoutChunks.push(Buffer.from(d));
      });
      cmd.stderr.on("data", (d: string | Buffer) => {
        stderrChunks.push(Buffer.from(d));
      });
      cmd.on("error", (e: Error) => {
        resolve(e.message.split(eolRegex).join("\n"));
        err = true;
      });
      cmd.on("close", (code: number | null) => {
        if (err) return;
        if (code === 0) {
          resolve(null);
        } else {
          const stdout = Buffer.concat(stdoutChunks).toString();
          const stderr = Buffer.concat(stderrChunks).toString();
          const raw = stdout !== "" ? stdout : stderr !== "" ? stderr : "";
          const lines = raw.split(eolRegex);
          if (lines[lines.length - 1] === "") lines.pop();
          resolve(lines.join("\n"));
        }
      });
    });
  }

  private runGitQuery(args: string[], repo: string) {
    return new Promise<GitQueryResult>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let err = false;
      const cmd = cp.spawn(this.gitPath, args, {
        cwd: repo,
        env: { ...process.env, LC_ALL: "C" }
      });
      cmd.stdout.on("data", (d: string | Buffer) => {
        stdoutChunks.push(Buffer.from(d));
      });
      cmd.stderr.on("data", (d: string | Buffer) => {
        stderrChunks.push(Buffer.from(d));
      });
      cmd.on("error", (e: Error) => {
          resolve({
            exitCode: null,
            kind: "error",
            status: e.message.split(eolRegex).join("\n")
          });
        err = true;
      });
      cmd.on("close", (code: number | null) => {
        if (err) return;
        const stdout = Buffer.concat(stdoutChunks).toString();
        if (code === 0) {
          resolve({ kind: "ok", stdout });
          return;
        }
        const stderr = Buffer.concat(stderrChunks).toString();
        const lines = (stderr !== "" ? stderr : stdout).split(eolRegex);
        if (lines[lines.length - 1] === "") lines.pop();
        const message = lines.join("\n");
            resolve({
              exitCode: code,
              kind: "error",
              status: message !== "" ? message : GIT_QUERY_FAILED_MESSAGE
            });
      });
    });
  }

  private spawnGit<T>(
    args: string[],
    repo: string,
    successValue: { (stdout: string): T },
    errorValue: T
  ) {
    return new Promise<T>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      let err = false;
      const cmd = cp.spawn(this.gitPath, args, {
        cwd: repo,
        env: { ...process.env, LC_ALL: "C" }
      });
      cmd.stdout.on("data", (d: string | Buffer) => {
        stdoutChunks.push(Buffer.from(d));
      });
      cmd.stderr.on("data", () => {});
      cmd.on("error", () => {
        resolve(errorValue);
        err = true;
      });
      cmd.on("close", (code: number | null) => {
        if (err) return;
        resolve(code === 0 ? successValue(Buffer.concat(stdoutChunks).toString()) : errorValue);
      });
    });
  }

  private spawnGitBuffer(args: string[], repo: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      let err = false;
      const cmd = cp.spawn(this.gitPath, args, {
        cwd: repo,
        env: { ...process.env, LC_ALL: "C" }
      });
      cmd.stdout.on("data", (d: string | Buffer) => {
        stdoutChunks.push(Buffer.from(d));
      });
      cmd.stderr.on("data", () => {});
      cmd.on("error", () => {
        resolve(Buffer.alloc(0));
        err = true;
      });
      cmd.on("close", (code: number | null) => {
        if (err) return;
        resolve(code === 0 ? Buffer.concat(stdoutChunks) : Buffer.alloc(0));
      });
    });
  }
}
