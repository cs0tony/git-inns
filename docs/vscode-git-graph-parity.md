# Git Keizu / vscode-git-graph feature parity

## Baseline compared

- Git Keizu: `0.9.1`
- vscode-git-graph reference: `1.30.0`

The reference implementation contains several feature domains that Git Keizu does not
fully implement yet. The most material gaps are:

1. **Graph data controls**
   - Include commits mentioned only by reflogs.
   - Follow only the first parent when loading commits.
   - Respect `.mailmap` for author and committer identities.
   - Fetch with remote-ref pruning and optional local-tag pruning.
   - Custom branch glob filters and remote-head visibility.

2. **Commit details**
   - Commit signature status and signature details.
   - Configurable tree/list file view and compact folder behaviour.
   - Issue-link formatting and richer, safer commit-body formatting.
   - Commit Details View placement and auto-centering controls.

3. **Repository settings**
   - A repository-level settings widget.
   - Remote list, add, edit, delete, fetch, prune, and prune-tags actions.
   - Issue-link templates and built-in/custom Pull Request providers.
   - Shareable repository configuration export/import.

4. **Modern commit actions**
   - Drop a linear commit safely.
   - Reset one selected file to a revision.
   - Create a archive from a commit or branch.
   - Start and persist code reviews with reviewed-file tracking.

5. **Accessibility and presentation**
   - Better focus order, keyboard help, ARIA labelling, and reduced-motion support.
   - Modern cards, chips, pills, menus, and dialogs using VS Code theme variables.

## Selected implementation wave

This wave delivers a useful, independently verifiable slice instead of attempting a
risky one-shot port of all 110 reference settings:

| ID    | Requirement                                          | Modern UI expectation                                                                                    |
| ----- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| FE-1  | Configurable fetch with `--prune` and `--prune-tags` | The Fetch control remains one-click; advanced choices use a compact menu/dialog and persist as settings. |
| FE-2  | Reflog-only commits and first-parent traversal       | Advanced load options are read from settings without cluttering the toolbar.                             |
| FE-3  | Mailmap-aware author/committer rendering             | Identities remain visually identical while respecting `.mailmap`.                                        |
| FE-4  | Signature status and details                         | Signed commits get a theme-aware chip/badge with a concise accessible tooltip.                           |
| FE-5  | Drop Commit                                          | Context menu action with explicit destructive confirmation and linear-history safety checks.             |
| FE-6  | Reset selected file to a revision                    | File-row context action with confirmation and a modern status/result toast.                              |
| FE-7  | Export commit archive                                | Commit context action opens a native save dialog and supports `zip`, `tar`, and `tar.gz`.                |
| FE-8  | Repository settings foundation                       | A modern panel/card can list remotes and expose issue-link settings; implementation can be staged.       |
| FE-9  | Code review foundation                               | File rows support reviewed-state tracking and persistence.                                               |
| FE-10 | Accessibility pass                                   | New controls expose names/roles, support focus, and honour reduced motion.                               |

## Modernization wave 2

The second wave closes four high-value reference features while preserving the
existing `git-keizu.*` settings namespace:

| ID    | Requirement                       | Delivered experience                                                                                                                                           |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-11 | Pull Request provider integration | Repository settings detect GitHub, GitLab, and Bitbucket remotes, support custom host/template providers, and branch menus can open the matching Pull Request. |
| FE-12 | Repository configuration sharing  | Settings cards provide native export/import flows with canonical JSON and validated inputs.                                                                    |
| FE-13 | Code Review lifecycle             | Commit Details gains a review progress panel, reviewed-file toggles, and persisted start/resume/end state.                                                     |
| FE-14 | Tag details                       | Tag context menus open a modern accessible dialog; annotated tags expose tagger, date, and message, while lightweight tags are classified explicitly.          |

This wave was split into independently tested backend/UI modules and then
integrated with the protocol, host dispatch, persistence, settings, context
menus, styling, and localization layers.

## Deliberate compatibility rule

Git Keizu keeps its user-facing `git-keizu.*` setting namespace. New functionality must
not rename existing settings. New settings follow `git-keizu.*` and keep existing values
backwards compatible.

## Task split

- **T1 — backend foundation:** settings, Git argument construction, protocol types,
  DataSource methods, and webview message dispatch.
- **T2 — details modernization:** signature chips, mailmap output, details placement,
  file list/tree polish, and reviewed-file state where protocol data exists.
- **T3 — action modernization:** Drop Commit, Reset File, and Export Archive dialogs.
- **T4 — repository settings:** remote and issue-link settings panel skeleton.
- **T5 — accessibility/QA:** ARIA, focus, reduced motion, tests, typecheck, and lint.
- **T6 — Pull Requests:** provider URL resolution, repository settings, and branch menu integration.
- **T7 — configuration sharing:** canonical export parsing, native dialogs, and settings actions.
- **T8 — code review:** standalone panel controller, lifecycle state, and Commit Details integration.
- **T9 — tag details:** Git object parsing, context menu dispatch, and dialog rendering.

## Remaining follow-up opportunities

- Infer and validate Pull Request destination/base branches more deeply.
- Add visual/manual QA coverage for the new settings, review, and tag dialogs.

## Modernization wave 3

Wave 3 continues the highest-value follow-ups with independently testable
slices. It intentionally avoids copying the reference setting namespace and
keeps the modern UI progressively disclosed rather than adding dense toolbars.

| ID   | Requirement                                                                 | Modern UI / behavior expectation                                                                                    |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| FE-15 | Infer and validate a Pull Request destination branch                         | The Pull Request card shows the inferred default/base branch, lets the user choose an existing branch, and validates it before opening. |
| FE-16 | Mark opened files as reviewed during an active review                        | Opening a changed file records it as reviewed, updates progress immediately, and never marks unrelated files.           |
| FE-17 | Rich but safe commit-body rendering                                          | Commit bodies support controlled emoji and lightweight markdown rendering, with settings and escaping preserved.         |
| FE-18 | Workspace review lifecycle                                                   | Resume, end-active, and end-all workspace review commands are discoverable and reuse the existing review state model.    |
| FE-19 | Presentation parity groundwork                                               | Add a modern, accessible column-visibility control and preserve per-webview state without a dense settings surface.      |
| FE-20 | Regression and manual QA gate                                                | Backend/frontend tests, typecheck, lint, and a documented smoke checklist pass before the wave ships.                    |

### Task split

- **R3-T1 — Review lifecycle:** automatic reviewed-file tracking on open plus
  workspace review commands, protocol/state updates, and accessibility checks.
- **R3-T2 — Pull Request destinations:** default/base branch inference,
  validation, persisted selection, and Pull Request settings/menu integration.
- **R3-T3 — Rich commit bodies:** a safe formatter module for emoji and
  controlled Markdown, opt-in settings, and theme-aware rendering.
- **R3-T4 — Column presentation:** persisted column visibility state and a
  compact modern menu with keyboard/ARIA support.
- **R3-T5 — Integration QA:** cross-cutting protocol checks, localization
  parity, visual/manual smoke checks, and full quality gates.

## Modernization wave 4

Wave 4 closes the remaining high-value follow-ups from the earlier parity audit.
Each slice is independently testable and keeps configuration under the existing
`git-keizu.*` namespace.

| ID | Requirement | Delivered experience |
| -- | ----------- | -------------------- |
| FE-21 | Rich but safe commit-body rendering | `git-keizu.commitBodyRendering` selects the legacy compact output or opt-in controlled emoji, headings, links, emphasis, and code while preserving escaping and issue links. |
| FE-22 | Workspace review lifecycle | Resume, end-active, and end-all commands reuse persisted review state, offer unambiguous selection, and refresh command enablement. |
| FE-23 | Column visibility | A compact accessible header menu hides or restores Author, Date, and Commit columns per repository; the Graph column and at least one data column remain visible. |
| FE-24 | Changed-file encoding | Default and per-file encoding overrides preserve raw Git bytes, decode with platform-supported encodings, and reopen diffs without stale document caches. |
| FE-25 | External directory diff | Commit Details can launch a configured GUI or terminal `git difftool --dir-diff` for self, working-tree, and commit-range comparisons. |
| FE-26 | User details | Repository settings read local/global `user.name` and `user.email`, save validated values at an explicit scope, and remove values only after confirmation. |
| FE-27 | Regression gate | Backend and webview tests, typecheck, lint, and diff hygiene pass before integration. |

### Task split

- **R4-T1 — Presentation:** rich commit bodies plus persisted column
  visibility and Find Widget compatibility.
- **R4-T2 — Review lifecycle:** command registration, QuickPick selection,
  state transitions, enablement, and webview updates.
- **R4-T3 — File encoding:** raw Git output, supported encoding registry,
  workspace overrides, diff URI identity, and file menu integration.
- **R4-T4 — External diff:** Git tool discovery, safe launch modes, target
  validation, toolbar disclosure, status handling, and localization.
- **R4-T5 — User details:** local/global config discovery, typed save/remove
  actions, validation, confirmations, and settings panel composition.

## Modernization wave 5

Wave 5 closes four remaining presentation and operation gaps while preserving
the existing `git-keizu.*` namespace. Each slice is independently testable and
uses progressively disclosed modern controls instead of a dense toolbar.

| ID | Requirement | Modern UI / behavior expectation |
| -- | ----------- | -------------------------------- |
| FE-28 | Commit Details placement and file presentation | Compact segmented controls choose inline or right-side placement, tree or list files, compact folders, and optional auto-centering. Preferences persist per workspace. |
| FE-29 | Repository visibility controls | Repository settings expose accessible switches for tags, stashes, remote heads, and untracked files; loading and ref rendering respect the choices. |
| FE-30 | Advanced Git operation forms | Destructive/history-changing dialogs remember safe defaults and expose advanced options for tags, branches, stashes, pulls, and rebases with explicit validation and confirmations. |
| FE-31 | Custom emoji shortcode mappings | Validated global mappings render safely in rich commit bodies and integrate with the existing opt-in Markdown mode. |
| FE-32 | Integration QA | Backend/web tests, typecheck, lint, formatting, localization parity, and manual smoke checks pass after merge. |

### Task split

- **R5-T1 — Commit Details presentation:** placement, file-view mode,
  compact-folder behavior, auto-centering, persistence, and accessibility.
- **R5-T2 — Repository visibility:** typed settings state, Git argument
  construction, protocol updates, and modern settings controls.
- **R5-T3 — Advanced operations:** dialog-default persistence, option-aware
  frontend forms, and safe backend Git argument handling.
- **R5-T4 — Emoji mappings:** configuration parsing/validation and safe
  shortcode substitution in the rich-body formatter.

## Modernization wave 6

Wave 6 closes the remaining extension-host parity gaps that are visible to
users but are not already covered by the modern repository settings panel.
The wave keeps secrets out of persisted state and logs while using native VS
Code Quick Picks, input boxes, notifications, and theme-aware dialogs.

| ID | Requirement | Modern UI / behavior expectation |
| -- | ----------- | -------------------------------- |
| FE-33 | Repository command surface | Palette commands can add a folder, remove a known repository, refresh from remotes, open the active Git Keizu diff document, and show executable/version diagnostics. Repository pickers are unambiguous and destructive actions are confirmed. |
| FE-34 | Integrated Git credential prompts | Git subprocesses use an extension-owned Askpass endpoint with a nonce-scoped socket/named pipe. Password fields are masked, credentials are never persisted or logged, and startup degrades safely to an empty askpass when the endpoint is unavailable. |
| FE-35 | Command diagnostics | Command invocations and command failures are written to the existing output channel without repository credentials; errors retain actionable user-facing messages. |
| FE-36 | Regression gate | Backend and webview tests, typecheck, lint, formatting, localization parity, and manual smoke checks pass after integration. |

### Task split

- **R6-T1 — Command surface:** repository add/remove/fetch, active diff-file
  open, version diagnostics, command logging, manifest strings, and QuickPick
  lifecycle tests.
- **R6-T2 — Askpass integration:** an isolated manager, platform-safe endpoint,
  masked prompts, subprocess environment wiring, fallback behavior, and tests.
- **R6-T3 — Integration QA:** verify ownership boundaries, no secret logging,
  command/package localization parity, quality gates, and manual smoke checks.

## Modernization wave 7 delivered

Wave 7 targets the remaining parity gaps listed in
`docs/vscode-git-graph-parity-wave-7.md`. It keeps the `git-keizu` namespace and
existing persisted values compatible; the table describes the delivered
implementation intent and feature behavior rather than a test-status claim.

| Area | Delivered behavior | Settings and compatibility |
| ---- | ------------------ | -------------------------- |
| Custom Pull Request providers | A validated global library of named custom providers supplies reusable provider options. Existing repository-specific `custom` selection and manual template URL remain supported as the fallback. | `git-keizu.customPullRequestProviders`; named providers are stored as reusable custom-provider templates while existing repository Pull Request settings retain their data shape. |
| Reference labels | Local and same-commit remote labels can be combined into one accessible label with a compact remote list, or kept separate. Labels can retain description alignment or align to graph branches; existing description/table alignment remains available. | `git-keizu.referenceLabels`, including `git-keizu.referenceLabels.combine` and `git-keizu.referenceLabels.alignment`. |
| File change indicators | Added, Modified, Deleted, and Renamed changes have text badges, accessible labels/titles, and type-specific structure in addition to color. | No new setting; indicators use the existing file-change data shape. |
| Host and view preferences | The webview can retain its context while hidden, opening can select the repository containing the active editor file, and graph-launched integrated terminals can use a configured shell. | `git-keizu.retainContextWhenHidden`, `git-keizu.openToActiveEditorRepository`, `git-keizu.integratedTerminalShell`. |
| Presentation defaults | Workspace defaults control Date, Author, and Commit column visibility with a visible-column fallback. Repository choices sort by workspace path, display name, or full path using stable, locale-aware ordering. | `git-keizu.defaultColumnVisibility`, `git-keizu.repositoryDropdownOrder`. |
