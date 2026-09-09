import {
  showCheckboxDialog,
  showConfirmationDialog,
  showFormDialog,
  showSelectDialog
} from "./dialogs";
import { t } from "./i18n";
import { ELLIPSIS, sendMessage } from "./utils";

export function buildUncommittedContextMenuItems(
  repo: string,
  sourceElem: HTMLElement
): ContextMenuElement[] {
  return [
    {
      title: `${t("Stash uncommitted changes")}${ELLIPSIS}`,
      actionId: "uncommitted.stash",
      onClick: () => {
        showFormDialog(
          t("Stash uncommitted changes:"),
          [
            {
              type: "text" as const,
              name: t("Message: "),
              default: "",
              placeholder: t("Optional")
            },
            {
              type: "checkbox" as const,
              name: t("Include Untracked"),
              value: viewState.dialogDefaults.stashUncommittedChanges.includeUntracked
            }
          ],
          t("Stash Changes"),
          (values) => {
            sendMessage({
              command: "pushStash",
              repo: repo,
              message: values[0],
              includeUntracked: values[1] === "checked"
            });
          },
          sourceElem
        );
      }
    },
    {
      title: `${t("Reset uncommitted changes")}${ELLIPSIS}`,
      actionId: "uncommitted.reset",
      onClick: () => {
        showSelectDialog(
          t("Select the mode to reset uncommitted changes:"),
          "mixed",
          [
            { name: t("Mixed - Keep changes in working directory"), value: "mixed" },
            { name: t("Hard - Discard all changes"), value: "hard" }
          ],
          t("Reset"),
          (mode) => {
            showConfirmationDialog(
              t(
                "Are you sure you want to reset uncommitted changes with {0} mode?{1}",
                `<b>${mode}</b>`,
                mode === "hard"
                  ? t(" This will discard all uncommitted changes and cannot be undone.")
                  : ""
              ),
              () => {
                sendMessage({
                  command: "resetUncommitted",
                  repo: repo,
                  mode: mode
                });
              },
              sourceElem
            );
          },
          sourceElem
        );
      }
    },
    {
      title: `${t("Clean untracked files")}${ELLIPSIS}`,
      actionId: "uncommitted.clean",
      onClick: () => {
        showCheckboxDialog(
          t("Are you sure you want to clean untracked files? This cannot be undone."),
          t("Clean untracked directories"),
          false,
          t("Clean"),
          (directories) => {
            sendMessage({
              command: "cleanUntrackedFiles",
              repo: repo,
              directories: directories
            });
          },
          sourceElem
        );
      }
    }
  ];
}
