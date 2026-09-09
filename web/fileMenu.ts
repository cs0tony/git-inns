import { recordRecentAction } from "./contextMenu";
import { showConfirmationDialog } from "./dialogs";
import { t } from "./i18n";
import { abbrevCommit, escapeHtml, sendMessage, UNCOMMITTED_CHANGES_HASH } from "./utils";

/** CSS selector for file row elements in both tree and list views. */
const GIT_FILE_SELECTOR = ".gitFile";

/** Dataset key for the encoded new file path on `.gitFile` elements. */
const DATASET_NEW_FILE_PATH_KEY = "newfilepath";

/** Label for the Open File context menu item. */
const OPEN_FILE_LABEL = t("context.openFile");

interface FileMenuExpandedCommit {
  hash: string;
  compareWithHash?: string | null;
  reviewedFiles?: readonly string[];
}

/**
 * Resolve the closest `.gitFile` ancestor from a DOM target.
 * Returns `null` when the target is not inside a file row.
 */
export function resolveFileRow(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>(GIT_FILE_SELECTOR);
}

/**
 * Send an `openFile` request for the given file row.
 * No-op when `expandedCommit` is null, `repo` is null,
 * `fileRow` is null, or `data-newfilepath` is missing.
 */
export function sendOpenFileAction(
  fileRow: HTMLElement | null,
  expandedCommit: { hash: string } | null,
  repo: string | null
): void {
  if (fileRow === null || expandedCommit === null || repo === null) return;
  const encodedPath = fileRow.dataset[DATASET_NEW_FILE_PATH_KEY];
  if (encodedPath === undefined) return;
  sendMessage({
    command: "openFile",
    repo,
    filePath: decodeURIComponent(encodedPath),
    commitHash: expandedCommit.hash
  });
}

/**
 * Build context menu items for a file row.
 * Returns an empty array when guard conditions prevent action,
 * which signals the caller not to open the menu.
 */
export function buildFileContextMenuItems(
  fileRow: HTMLElement | null,
  expandedCommit: FileMenuExpandedCommit | null,
  repo: string | null
): ContextMenuElement[] {
  if (fileRow === null || expandedCommit === null || repo === null) return [];
  const encodedPath = fileRow.dataset[DATASET_NEW_FILE_PATH_KEY];
  if (encodedPath === undefined) return [];
  const filePath = decodeURIComponent(encodedPath);
  const canSetReviewed =
    expandedCommit.hash !== UNCOMMITTED_CHANGES_HASH &&
    expandedCommit.compareWithHash === null;
  const isReviewed = expandedCommit.reviewedFiles?.includes(filePath) === true;

  const reviewedMenuItem: ContextMenuItem | null = canSetReviewed
    ? {
        title: isReviewed ? t("context.markNotReviewed") : t("context.markReviewed"),
        actionId: isReviewed ? "file.markNotReviewed" : "file.markReviewed",
        onClick: () => {
          sendMessage({
            command: "setFileReviewed",
            repo,
            commitHash: expandedCommit.hash,
            filePath,
            reviewed: !isReviewed
          });
        }
      }
    : null;

  return [
    {
      title: OPEN_FILE_LABEL,
      actionId: "file.openFile",
      recentActionId: "file.openFile",
      onClick: () => {
        recordRecentAction(repo, "file.openFile");
        sendOpenFileAction(fileRow, expandedCommit, repo);
      }
    },
    reviewedMenuItem,
    {
      title: t("context.resetFile"),
      actionId: "file.resetToRevision",
      onClick: () => {
        showConfirmationDialog(
          t(
            "Reset {0} to its state at commit {1}? The working-tree and index copies will be overwritten.",
            `<b><i>${escapeHtml(filePath)}</i></b>`,
            `<b><i>${abbrevCommit(expandedCommit.hash)}</i></b>`
          ),
          () => {
            sendMessage({
              command: "resetFileToRevision",
              repo,
              revision: expandedCommit.hash,
              filePath
            });
          },
          fileRow
        );
      }
    }
  ];
}
