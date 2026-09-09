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

| ID | Requirement | Modern UI expectation |
|---|---|---|
| FE-1 | Configurable fetch with `--prune` and `--prune-tags` | The Fetch control remains one-click; advanced choices use a compact menu/dialog and persist as settings. |
| FE-2 | Reflog-only commits and first-parent traversal | Advanced load options are read from settings without cluttering the toolbar. |
| FE-3 | Mailmap-aware author/committer rendering | Identities remain visually identical while respecting `.mailmap`. |
| FE-4 | Signature status and details | Signed commits get a theme-aware chip/badge with a concise accessible tooltip. |
| FE-5 | Drop Commit | Context menu action with explicit destructive confirmation and linear-history safety checks. |
| FE-6 | Reset selected file to a revision | File-row context action with confirmation and a modern status/result toast. |
| FE-7 | Export commit archive | Commit context action opens a native save dialog and supports `zip`, `tar`, and `tar.gz`. |
| FE-8 | Repository settings foundation | A modern panel/card can list remotes and expose issue-link settings; implementation can be staged. |
| FE-9 | Code review foundation | File rows support reviewed-state tracking and persistence. |
| FE-10 | Accessibility pass | New controls expose names/roles, support focus, and honour reduced motion. |

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
