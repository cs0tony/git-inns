import * as vscode from "vscode";

import {
  CommitOrdering,
  ContextMenuActionId,
  ContextMenuActionsVisibility,
  ContextMenuGroup,
  CustomBranchGlobPattern,
  DateFormat,
  DateType,
  DialogDefaults,
  GraphStyle,
  TabIconColourTheme
} from "./types";

const KEYBINDING_PATTERN = /^CTRL\/CMD \+ [A-Z]$/;
const UNASSIGNED = "UNASSIGNED";

export const MIN_COMMIT_LOAD_COUNT = 1;

export function normalizeCommitLoadCount(value: number, defaultValue: number): number {
  const count = Number.isFinite(value) ? value : defaultValue;
  return Math.max(MIN_COMMIT_LOAD_COUNT, count);
}

// Must match the default of git-keizu.graphColours in package.json (same values, same order)
const DEFAULT_GRAPH_COLOURS: readonly string[] = [
  "#0085d9",
  "#d9008f",
  "#00d90a",
  "#d98500",
  "#a300d9",
  "#ff0000",
  "#00d9cc",
  "#e138e8",
  "#85d900",
  "#dc5b23",
  "#6f24d6",
  "#ffcc00"
];

export const GRAPH_COLOUR_PATTERN =
  /^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgb\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\))\s*$/;

export const CUSTOM_BRANCH_GLOB_ARGUMENT_PREFIX = "--glob=";
const CUSTOM_BRANCH_GLOB_CONTROL_OR_WHITESPACE = /[\p{Cc}\s]/u;

export function isValidBranchGlobPattern(glob: string): boolean {
  return (
    glob !== "" &&
    !glob.startsWith("-") &&
    !glob.startsWith(":") &&
    !glob.startsWith("/") &&
    !glob.endsWith("/") &&
    !CUSTOM_BRANCH_GLOB_CONTROL_OR_WHITESPACE.test(glob) &&
    !glob.includes("..") &&
    !glob.includes("@{") &&
    glob.split("/").every((segment) => segment !== "")
  );
}

export function normalizeCustomBranchGlobPatterns(value: unknown): CustomBranchGlobPattern[] {
  if (!Array.isArray(value)) return [];

  const patterns: CustomBranchGlobPattern[] = [];
  const names = new Set<string>();
  const globs = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.name !== "string" || typeof candidate.glob !== "string") continue;

    const name = candidate.name.trim();
    const glob = candidate.glob.trim();
    if (name === "" || !isValidBranchGlobPattern(glob)) continue;
    if (names.has(name) || globs.has(glob)) continue;

    names.add(name);
    globs.add(glob);
    patterns.push({ name, glob });
  }
  return patterns;
}

const CONTEXT_MENU_ACTION_IDS: Record<ContextMenuGroup, readonly ContextMenuActionId[]> = {
  branch: [
    "ref.checkoutBranch",
    "ref.mergeBranch",
    "ref.rebaseBranch",
    "ref.renameBranch",
    "ref.deleteBranch",
    "ref.createWorktree",
    "ref.openWorktreeInNewWindow",
    "ref.revealWorktreeInOS",
    "ref.openTerminal",
    "ref.copyWorktreePath",
    "ref.removeWorktree",
    "ref.createPullRequest",
    "ref.pull",
    "ref.push",
    "ref.copyName"
  ],
  commit: [
    "commit.createBranch",
    "commit.createWorktree",
    "commit.cherryPick",
    "commit.merge",
    "commit.exportArchive",
    "commit.addTag",
    "commit.checkout",
    "commit.revert",
    "commit.resetToCommit",
    "commit.drop",
    "commit.copyHash"
  ],
  file: ["file.openFile", "file.markReviewed", "file.markNotReviewed", "file.resetToRevision"],
  remoteBranch: [
    "ref.checkoutBranch",
    "ref.createPullRequest",
    "ref.mergeBranch",
    "ref.deleteRemoteBranch",
    "remoteBranch.copyName"
  ],
  stash: [
    "stash.apply",
    "stash.pop",
    "stash.createBranch",
    "stash.drop",
    "stash.copyName",
    "stash.copyHash"
  ],
  tag: ["tag.deleteTag", "tag.pushTag", "tag.copyName"],
  uncommitted: ["uncommitted.stash", "uncommitted.reset", "uncommitted.clean"]
};

export function normalizeContextMenuActionsVisibility(
  value: unknown
): ContextMenuActionsVisibility {
  const valueObject = typeof value === "object" && value !== null ? value : {};
  const normalized = {} as Record<ContextMenuGroup, Record<ContextMenuActionId, boolean>>;

  for (const [group, actionIds] of Object.entries(CONTEXT_MENU_ACTION_IDS) as [
    ContextMenuGroup,
    readonly ContextMenuActionId[]
  ][]) {
    const groupValue =
      typeof valueObject === "object" &&
      valueObject !== null &&
      typeof (valueObject as Record<string, unknown>)[group] === "object" &&
      (valueObject as Record<string, unknown>)[group] !== null
        ? ((valueObject as Record<string, unknown>)[group] as Record<string, unknown>)
        : {};

    normalized[group] = Object.fromEntries(
      actionIds.map((actionId) => [actionId, groupValue[actionId] !== false])
    ) as Record<ContextMenuActionId, boolean>;
  }

  return normalized;
}

export type OpenNewTabEditorGroupValue =
  | "Active"
  | "Beside"
  | "One"
  | "Two"
  | "Three"
  | "Four"
  | "Five"
  | "Six"
  | "Seven"
  | "Eight"
  | "Nine";

const VIEW_COLUMN_MAPPING: Record<OpenNewTabEditorGroupValue, vscode.ViewColumn> = {
  Active: vscode.ViewColumn.Active,
  Beside: vscode.ViewColumn.Beside,
  One: vscode.ViewColumn.One,
  Two: vscode.ViewColumn.Two,
  Three: vscode.ViewColumn.Three,
  Four: vscode.ViewColumn.Four,
  Five: vscode.ViewColumn.Five,
  Six: vscode.ViewColumn.Six,
  Seven: vscode.ViewColumn.Seven,
  Eight: vscode.ViewColumn.Eight,
  Nine: vscode.ViewColumn.Nine
};

/**
 * Parse a keybinding setting value into a lowercase key letter or null.
 * - Valid format (e.g. "CTRL/CMD + F") → lowercase letter ("f")
 * - "UNASSIGNED" → null
 * - Invalid value → fallback to parsing defaultValue
 */
export function parseKeybinding(value: string, defaultValue: string): string | null {
  if (value === UNASSIGNED) {
    return null;
  }
  if (KEYBINDING_PATTERN.test(value)) {
    return value.charAt(value.length - 1).toLowerCase();
  }
  // Invalid value — fall back to default
  if (KEYBINDING_PATTERN.test(defaultValue)) {
    return defaultValue.charAt(defaultValue.length - 1).toLowerCase();
  }
  return null;
}

class Config {
  private workspaceConfiguration: vscode.WorkspaceConfiguration;

  constructor() {
    this.workspaceConfiguration = vscode.workspace.getConfiguration("git-keizu");
  }

  public dialogDefaults(): DialogDefaults {
    return {
      merge: {
        noFastForward: this.workspaceConfiguration.get("dialog.merge.noFastForward", true),
        squashCommits: this.workspaceConfiguration.get("dialog.merge.squashCommits", false),
        noCommit: this.workspaceConfiguration.get("dialog.merge.noCommit", false)
      },
      cherryPick: {
        recordOrigin: this.workspaceConfiguration.get("dialog.cherryPick.recordOrigin", false),
        noCommit: this.workspaceConfiguration.get("dialog.cherryPick.noCommit", false)
      },
      stashUncommittedChanges: {
        includeUntracked: this.workspaceConfiguration.get(
          "dialog.stashUncommittedChanges.includeUntracked",
          false
        )
      },
      createWorktree: {
        openTerminal: this.workspaceConfiguration.get("dialog.createWorktree.openTerminal", true)
      },
      removeWorktree: {
        deleteBranch: this.workspaceConfiguration.get("dialog.removeWorktree.deleteBranch", true)
      }
    };
  }

  public dateFormat(): DateFormat {
    return this.workspaceConfiguration.get("dateFormat", "Date & Time");
  }

  public contextMenuActionsVisibility(): ContextMenuActionsVisibility {
    return normalizeContextMenuActionsVisibility(
      this.workspaceConfiguration.get<unknown>("contextMenuActionsVisibility", {})
    );
  }

  public dateType(): DateType {
    return this.workspaceConfiguration.get("dateType", "Author Date");
  }

  public fetchAvatars() {
    return this.workspaceConfiguration.get("fetchAvatars", false);
  }

  public graphColours() {
    const colours = this.workspaceConfiguration
      .get("graphColours", [...DEFAULT_GRAPH_COLOURS])
      .filter((v) => GRAPH_COLOUR_PATTERN.test(v));
    return colours.length > 0 ? colours : [...DEFAULT_GRAPH_COLOURS];
  }

  public graphStyle(): GraphStyle {
    return this.workspaceConfiguration.get("graphStyle", "rounded");
  }

  public initialLoadCommits() {
    const value = this.workspaceConfiguration.get<number>("initialLoadCommits", 300);
    return normalizeCommitLoadCount(value, 300);
  }

  public keyboardShortcutFind(): string | null {
    const value = this.workspaceConfiguration.get("keyboardShortcutFind", "CTRL/CMD + F");
    return parseKeybinding(value, "CTRL/CMD + F");
  }

  public keyboardShortcutRefresh(): string | null {
    const value = this.workspaceConfiguration.get("keyboardShortcutRefresh", "CTRL/CMD + R");
    return parseKeybinding(value, "CTRL/CMD + R");
  }

  public keyboardShortcutScrollToHead(): string | null {
    const value = this.workspaceConfiguration.get("keyboardShortcutScrollToHead", "CTRL/CMD + H");
    return parseKeybinding(value, "CTRL/CMD + H");
  }

  public keyboardShortcutScrollToStash(): string | null {
    const value = this.workspaceConfiguration.get("keyboardShortcutScrollToStash", "CTRL/CMD + S");
    return parseKeybinding(value, "CTRL/CMD + S");
  }

  public loadMoreCommits() {
    const value = this.workspaceConfiguration.get<number>("loadMoreCommits", 100);
    return normalizeCommitLoadCount(value, 100);
  }

  public loadMoreCommitsAutomatically(): boolean {
    return this.workspaceConfiguration.get("loadMoreCommitsAutomatically", true);
  }

  public maxDepthOfRepoSearch() {
    return this.workspaceConfiguration.get("maxDepthOfRepoSearch", 0);
  }

  public showCurrentBranchByDefault() {
    return this.workspaceConfiguration.get("showCurrentBranchByDefault", false);
  }

  public showRecentActions(): boolean {
    return this.workspaceConfiguration.get("menu.showRecentActions", true);
  }

  public showStatusBarItem() {
    return this.workspaceConfiguration.get("showStatusBarItem", true);
  }

  public showUncommittedChanges() {
    return this.workspaceConfiguration.get("showUncommittedChanges", true);
  }

  public sourceCodeProviderIntegrationLocation(): "Inline" | "More Actions" {
    return this.workspaceConfiguration.get("sourceCodeProviderIntegrationLocation", "Inline");
  }

  public tabIconColourTheme(): TabIconColourTheme {
    return this.workspaceConfiguration.get("tabIconColourTheme", "colour");
  }

  public commitOrdering(): CommitOrdering {
    return this.workspaceConfiguration.get("repository.commits.order", "date");
  }

  public customBranchGlobPatterns(): CustomBranchGlobPattern[] {
    return normalizeCustomBranchGlobPatterns(
      this.workspaceConfiguration.get<unknown>("customBranchGlobPatterns", [])
    );
  }

  public customBranchGlobArguments(): string[] {
    return this.customBranchGlobPatterns().map(
      (pattern) => `${CUSTOM_BRANCH_GLOB_ARGUMENT_PREFIX}${pattern.glob}`
    );
  }

  public fetchAndPruneTags(): boolean {
    return this.workspaceConfiguration.get("repository.fetchAndPruneTags", false);
  }

  public includeCommitsMentionedByReflogs(): boolean {
    return this.workspaceConfiguration.get("includeCommitsMentionedByReflogs", false);
  }

  public onlyFollowFirstParent(): boolean {
    return this.workspaceConfiguration.get("onlyFollowFirstParent", false);
  }

  public useMailmap(): boolean {
    return this.workspaceConfiguration.get("useMailmap", false);
  }

  public showSignatureStatus(): boolean {
    return this.workspaceConfiguration.get("showSignatureStatus", false);
  }

  public muteCommitsMergeCommits(): boolean {
    return this.workspaceConfiguration.get("repository.commits.mute.mergeCommits", true);
  }

  public muteCommitsNotAncestorsOfHead(): boolean {
    return this.workspaceConfiguration.get(
      "repository.commits.mute.commitsThatAreNotAncestorsOfHead",
      false
    );
  }

  public openNewTabEditorGroup(): vscode.ViewColumn {
    const value = this.workspaceConfiguration.get<string>("openNewTabEditorGroup", "Active");
    return VIEW_COLUMN_MAPPING[value as OpenNewTabEditorGroupValue] ?? vscode.ViewColumn.Active;
  }

  public gitPath(): string[] {
    const value = vscode.workspace.getConfiguration("git").get<unknown>("path", null);
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.filter((candidate): candidate is string => typeof candidate === "string");
    }
    return [];
  }
}

export function getConfig() {
  return new Config();
}
