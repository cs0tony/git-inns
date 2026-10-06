# vscode-git-graph Parity Wave 8 Requirements (Planned)

**Status:** planned, not yet implemented. This wave closes the remaining parity gaps
against vscode-git-graph 1.30.0 that waves 1–7 did not cover. Gap analysis date: 2026-10-06.

**Goal:** finish the long tail of per-repository defaults, push/tag force semantics, and
Commit Details ergonomics so that a vscode-git-graph user can switch without losing a
workflow they rely on.

**Architecture:** same rules as earlier waves — isolated feature modules, typed protocol
messages, validated Git arguments, theme-aware webview UI, and a regression gate at the end.

## Global Constraints

- Preserve the `git-keizu.*` settings namespace and existing persisted values; new global
  defaults must not break the per-repository overrides introduced in wave 5.
- Keep all Git refs, paths, remotes, and subprocess arguments validated.
- Localize all new user-facing strings in English and Japanese.
- Destructive actions keep explicit confirmation; force variants additionally explain what
  will be overwritten.

## Gap Summary (evidence-based, as of wave 7)

Already complete from the reference: repository settings panel (remotes CRUD + fetch/prune,
user details, issue links, PR providers, export/import), code review lifecycle, tag details,
signature status, mailmap, reflog/first-parent, column visibility, reference label
presentation, emoji shortcodes + rich bodies, advanced fetch/pull dialogs, askpass, command
surface, host/view preferences, file encodings, external dir-diff, worktree management
(beyond the reference), commit/branch/stash/uncommitted/file context menus, find widget,
keyboard shortcuts, avatars, status bar, SCM integration.

Remaining gaps, grouped:

### A. Global defaults that today only exist per repository

| ID    | Gap                                                                                          | Notes                                                                 |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| G8-1  | `showTags` / `showStashes` / `showRemoteHeads` / `showUntrackedFiles` global defaults         | Per-repo switches exist in the settings panel; add global fallbacks.  |
| G8-2  | `fetchAndPrune` default for the toolbar Fetch action                                          | One-click fetch should honour a global prune default.                 |
| G8-3  | `showCommitsOnlyReferencedByTags`                                                             | `git log` gate plus setting.                                          |
| G8-4  | `onLoad.scrollToHead`                                                                          | Scroll to HEAD after repository load.                                 |
| G8-5  | `onLoad.showSpecificBranches` (+ per-repo "Initial Branches" editor in the settings panel)    | Includes glob entries; replaces the single showCurrentBranchByDefault.|
| G8-6  | ISO date formats (`ISO Date & Time`, `ISO Date Only`)                                          | Extend `dateFormat` enum without renaming values.                     |
| G8-7  | `sign.commits` / `sign.tags` — GPG-sign commits/tags created by Git Keizu operations           | `-S` for merge/rebase/cherry-pick/reset/revert, `-s` vs `-a` for tags.|
| G8-8  | `graph.uncommittedChanges` display style                                                       | Open circle at uncommitted changes or at checked-out commit.          |
| G8-9  | `enhancedAccessibility` — letter badges (A/M/D/R/U) in Commit Details                          | Wave 7 added colour-independent badges; add the opt-in letter mode.   |

### B. Dialog defaults and input behaviour

| ID   | Gap                                                                                       |
| ---- | ------------------------------------------------------------------------------------------- |
| G8-10| Persisted defaults: `addTag.type`, `addTag.pushToRemote`, `deleteBranch.forceDelete`, `applyStash.reinstateIndex`, `popStash.reinstateIndex`, `fetchIntoLocalBranch.forceFetch`, `resetCurrentBranchToCommit.mode`, `resetUncommittedChanges.mode`, `merge.squashMessageFormat` |
| G8-11| Rebase options: `ignoreDate`, and interactive rebase launched in an integrated terminal       |
| G8-12| `dialog.general.referenceInputSpaceSubstitution` (None / Hyphen / Underscore)                 |

### C. Push / tag semantics

| ID    | Gap                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------- |
| G8-13 | Push modes: Normal / Force With Lease (`--force-with-lease`) / Force, plus explicit Set Upstream |
| G8-14 | Tag push: multi-remote picker (currently hardcoded to `origin`), and a "commit not on remote" pre-check warning |
| G8-15 | Tag delete: optional "also delete on remote" with remote picker                                |
| G8-16 | Remote-branch "Fetch into local branch" with force-fetch overwrite confirmation                |

### D. Context menu completeness

| ID   | Gap                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------- |
| G8-17| Branch/tag/remote-branch "Create Archive" (archive is commit-only today)                        |
| G8-18| "View Issue" action on branch and remote-branch menus using the issue-link template             |
| G8-19| "Select in / Unselect from Branches Dropdown" actions                                           |
| G8-20| Commit menu "Copy Commit Subject"                                                               |
| G8-21| File menu: "View File at this Revision", "View Diff with Working File", "Copy Absolute / Relative File Path" |
| G8-22| Commit menu "Rebase current branch on this Commit" (currently branch-menu only)                 |

### E. Commit Details View ergonomics

| ID   | Gap                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------- |
| G8-23| Draggable Commit Details height (100–600 px, per repository) and draggable summary/files divider    |
| G8-24| "Last File Viewed" marker in the file tree/list                                                     |
| G8-25| Code review entries expire after 90 days of inactivity                                              |
| G8-26| Diff-editor title command `git-keizu.openFile` ("Open File" from a `git-keizu:` diff URI)           |

### F. Repository settings and discovery

| ID   | Gap                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------ |
| G8-27| Custom repository display name (edit/remove, used in the repo dropdown)                                 |
| G8-28| Per-repo overrides for reflog-only commits and first-parent traversal in the settings panel             |
| G8-29| Per-remote "hide branches" (`hideRemotes`) filtering the Branches dropdown                               |
| G8-30| Issue-link auto-detection from existing commit messages + "Use Globally" default                         |
| G8-31| Auto-import of `git-keizu.config.json` via FileSystemWatcher (export/import is manual today)             |
| G8-32| Pull Request settings: destination remote / owner / project-id fields for deeper provider inference      |

Non-goals: anonymous lifecycle telemetry (deliberately omitted), deprecated legacy setting
aliases (Git Keizu keeps its own namespace), and any change that renames existing settings.

## Task Split

- **R8-T1 — Global defaults & dialog defaults (G8-1…G8-12):** settings schema, config
  resolution order (global → per-repo → built-in), dialog default persistence, ISO dates.
- **R8-T2 — Push/tag semantics (G8-13…G8-16):** force/lease/upstream push modes, remote
  pickers for tag push/delete, safe pre-checks and confirmations.
- **R8-T3 — Context menu completeness (G8-17…G8-22):** archive for refs, issue viewer,
  dropdown selection actions, copy subject, file-menu actions, commit rebase.
- **R8-T4 — Commit Details ergonomics (G8-23…G8-26):** resizable CDV with divider drag,
  last-viewed marker, review expiry, diff-title open command.
- **R8-T5 — Settings & discovery polish (G8-27…G8-32):** display names, per-repo overrides,
  remote hiding, issue-link detection, config auto-import, PR wizard depth.
- **R8-T6 — Regression gate:** vitest suites, typecheck, lint, format, localization parity,
  manual smoke checklist for every new dialog on Windows paths.

## Suggested Order

R8-T1 and R8-T2 are independent and highest user value; R8-T3 next; R8-T4 and R8-T5 can run
in parallel afterwards; R8-T6 closes the wave.
