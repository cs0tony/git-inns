# vscode-git-graph Parity Wave 7 Requirements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Execute each task independently, use `apply_patch` for every file modification, run the
> listed tests, and commit with a conventional message.

**Goal:** Close the remaining useful vscode-git-graph feature gaps in Git Keizu with small,
modern, accessible UI slices.

**Architecture:** Each worker owns an isolated feature module and tests. The coordinator
integrates the modules into the existing webview/host boundaries, runs regression gates, and
commits integration separately.

**Tech Stack:** TypeScript, Vitest, VS Code Webview API, native VS Code settings and
theme-aware UI.

**Spec:** This document, together with `docs/vscode-git-graph-parity.md`.

## Global Constraints

- Preserve the `git-keizu.*` settings namespace and existing setting values.
- Use `apply_patch`; never create or edit files with `cat`, `echo`, redirection, or direct
  shell writes.
- Keep all user input validated and all Git references, paths, URLs, and subprocess arguments
  safe.
- UI must use existing VS Code theme variables, semantic HTML, ARIA labels, visible focus, and
  reduced-motion-safe behavior.
- Localize user-facing strings in English and Japanese.
- Every task ends with its scoped tests passing and a focused git commit.

## Gap Summary

Git Keizu already covers waves FE-1 through FE-36, including advanced Git operations,
repository settings, reviews, signatures, encoding, Askpass, and command diagnostics. The
reference still has the following useful feature gaps:

1. A reusable global library of named custom Pull Request providers, instead of requiring the
   same custom template to be retyped for each repository.
2. User control over local/remote branch label combination and reference-label alignment.
3. Color-independent change indicators in the Commit Details file view.
4. Host/view preferences for retaining webview context, opening to the active text editor's
   repository, and choosing the shell used by terminals opened from the graph.
5. Workspace-wide defaults for column visibility plus deterministic repository-dropdown
   ordering.

## Task Split

### Task A — Named custom Pull Request provider library (`zsub_worker-a`)

**Files**

- Create: `src/pullRequestProviders.ts`
- Create: `tests/src/pullRequestProviders.test.ts`

**Requirement / Modern UI expectation**

- Add a normalized global configuration model compatible with
  `git-keizu.customPullRequestProviders`: an array of `{ name, templateUrl }`.
- Names must be non-empty, unique case-insensitively, free of control characters, and at most
  80 characters.
- Templates must be absolute HTTP/HTTPS URLs, contain no credentials or control characters,
  and preserve query/hash portions for later substitution.
- Sorting is locale-aware and case-insensitive; lookup is case-insensitive.
- Invalid entries are rejected without throwing; no secrets are logged.
- Tests cover normalization, duplicate rejection, credential rejection, lookup, and sorting.

### Task B — Reference-label presentation model (`zsub_worker-b`)

**Files**

- Create: `web/referenceLabelPresentation.ts`
- Create: `tests/web/referenceLabelPresentation.test.ts`

**Requirement / Modern UI expectation**

- Model `referenceLabels.combine` (`boolean`, default `true`) and `referenceLabels.alignment`
  (`"description" | "graph-branches"`, default `"description"`).
- Normalize unknown/partial input safely and provide deterministic CSS class names:
  `referenceLabelsCombined` and `referenceLabelsAlignedToGraph`.
- A pure grouping function must either merge a local branch with its same-commit remote labels
  into one accessible label with a compact remote list, or keep local and remote labels
  separate.
- Tests cover both modes, malformed input, remote-only labels, tags, and CSS class output.

### Task C — Host and terminal view preferences (`zsub_worker-c`)

**Files**

- Create: `src/hostViewPreferences.ts`
- Create: `tests/src/hostViewPreferences.test.ts`

**Requirement / Modern UI expectation**

- Add normalized host settings for:
  - `retainContextWhenHidden` (`boolean`, default `true`);
  - `openToActiveEditorRepository` (`boolean`, default `false`);
  - `integratedTerminalShell` (`string`, default `""`).
- Validate shell paths as non-empty strings without control characters; do not execute them in
  this module.
- Provide a pure repository matcher that selects the registered repository containing an
  active editor file path using platform-aware path normalization and longest-prefix matching.
- Tests cover defaults, malformed settings, exact/nested repositories, Windows separators,
  ambiguity, and no-match behavior.

### Task D — Presentation defaults and repository ordering (`zsub_worker-d`)

**Files**

- Create: `src/presentationDefaults.ts`
- Create: `tests/src/presentationDefaults.test.ts`

**Requirement / Modern UI expectation**

- Add normalized defaults for Date, Author, and Commit column visibility; an impossible
  all-hidden default falls back to all visible.
- Add repository ordering modes: `workspace-path` (default), `name`, and `full-path`.
- Ordering is stable, locale-aware, case-insensitive, and falls back to full path for ties.
- Tests cover malformed defaults, preserving at least one data column, all ordering modes,
  stable ties, and repository-name derivation.

### Coordinator Integration and QA

- Expose the four settings through the existing configuration/state boundary.
- Wire the custom provider picker into Repository Settings without removing the existing
  repository-specific custom template fallback.
- Apply reference-label classes/grouping in the modern webview renderer.
- Apply host preferences to webview creation, active-repository selection, and graph-launched
  terminals.
- Apply column defaults and stable dropdown ordering.
- Add concise English/Japanese labels where new controls are user-facing.
- Update the parity document and run format, lint, typecheck, and the full test suite.

## Acceptance Criteria

- Every new preference is validated, backwards compatible, and reflected in modern accessible
  UI or host behavior.
- No worker introduces a destructive Git operation or logs credentials.
- Existing repository-specific state continues to override global defaults where applicable.
- The full quality gate passes on the integrated branch.
