// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../web/contextMenu", () => ({
  recordRecentAction: vi.fn()
}));

vi.mock("../../web/dialogs", () => ({
  showConfirmationDialog: vi.fn(),
  showSelectDialog: vi.fn()
}));

import { recordRecentAction } from "../../web/contextMenu";
import { filterContextMenuItems } from "../../web/contextMenuVisibility";
import { showConfirmationDialog, showSelectDialog } from "../../web/dialogs";
import { buildFileContextMenuItems, resolveFileRow, sendOpenFileAction } from "../../web/fileMenu";
import { vscode } from "../../web/utils";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const TEST_REPO = "/path/to/repo";
const COMMIT_HASH = "abc123def456";

(globalThis as Record<string, unknown>).webviewMessages = {
  ...((globalThis as Record<string, unknown>).webviewMessages as Record<string, string>),
  "context.markReviewed": "Mark as Reviewed",
  "context.reopenWithEncoding": "Reopen with Encoding...",
  "context.markNotReviewed": "Mark as Not Reviewed",
  "context.resetFile": "Reset File to Revision..."
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeFileRow(dataset: Record<string, string> = {}, type = "M"): HTMLElement {
  const li = document.createElement("li");
  li.className = `gitFile ${type} gitDiffPossible`;
  for (const [key, value] of Object.entries(dataset)) {
    li.dataset[key] = value;
  }
  li.dataset.type = type;
  return li;
}

function makeExpandedCommit(hash = COMMIT_HASH) {
  return { hash, compareWithHash: null, reviewedFiles: [] };
}

function findMenuItem(items: ContextMenuElement[], title: string): ContextMenuItem {
  const item = items.find(
    (menuItem): menuItem is ContextMenuItem =>
      menuItem !== null && "onClick" in menuItem && menuItem.title === title
  );
  expect(item).toBeDefined();
  return item!;
}

/* ------------------------------------------------------------------ */
/* S1: file row Open File action request payload 解決                 */
/* ------------------------------------------------------------------ */

describe("sendOpenFileAction", () => {
  beforeEach(() => {
    vi.mocked(vscode.postMessage).mockClear();
  });

  // TC-001: encoded path と expandedCommit.hash ありで正しい payload が送られる
  it("sends openFile message with decoded filePath (TC-001)", () => {
    // Given: a .gitFile row with encoded newfilepath and valid expandedCommit
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });
    const commit = makeExpandedCommit();

    // When: sendOpenFileAction is called
    sendOpenFileAction(row, commit, TEST_REPO);

    // Then: postMessage is called once with correct payload
    expect(vscode.postMessage).toHaveBeenCalledTimes(1);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      repo: TEST_REPO,
      filePath: "src/file.ts",
      commitHash: COMMIT_HASH
    });
  });

  // TC-002: 日本語・空白を含む URI エンコード済みパスが正しくデコードされる
  it("decodes special characters including Japanese and spaces (TC-002)", () => {
    // Given: a .gitFile row with Japanese and space in encoded path
    const encoded = encodeURIComponent("src/テスト ファイル.ts");
    const row = makeFileRow({ newfilepath: encoded });
    const commit = makeExpandedCommit();

    // When: sendOpenFileAction is called
    sendOpenFileAction(row, commit, TEST_REPO);

    // Then: filePath is fully decoded
    expect(vscode.postMessage).toHaveBeenCalledTimes(1);
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/テスト ファイル.ts"
      })
    );
  });

  // TC-003: expandedCommit が null のとき sendMessage が呼ばれない
  it("does not send message when expandedCommit is null (TC-003)", () => {
    // Given: a valid file row but expandedCommit is null
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });

    // When: sendOpenFileAction is called with null expandedCommit
    sendOpenFileAction(row, null, TEST_REPO);

    // Then: no message is sent
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  // TC-004: data-newfilepath が存在しないとき sendMessage が呼ばれない
  it("does not send message when data-newfilepath is missing (TC-004)", () => {
    // Given: a .gitFile row without data-newfilepath
    const row = makeFileRow({});
    const commit = makeExpandedCommit();

    // When: sendOpenFileAction is called
    sendOpenFileAction(row, commit, TEST_REPO);

    // Then: no message is sent
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  // TC-005: deleted file row でも openFile payload が送られる
  it("sends openFile message for deleted file row (TC-005)", () => {
    // Given: a deleted file row (type=D) with data-newfilepath present
    const row = makeFileRow({ newfilepath: "src%2Fdeleted.ts" }, "D");
    const commit = makeExpandedCommit();

    // When: sendOpenFileAction is called
    sendOpenFileAction(row, commit, TEST_REPO);

    // Then: message is sent (host decides success/failure)
    expect(vscode.postMessage).toHaveBeenCalledTimes(1);
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "openFile",
        filePath: "src/deleted.ts"
      })
    );
  });

  // TC-006: fileRow が null のとき例外を投げず sendMessage が呼ばれない
  it("does not throw and does not send message when fileRow is null (TC-006)", () => {
    // Given: resolveFileRow returns null for a target outside .gitFile
    const span = document.createElement("span");
    const resolved = resolveFileRow(span);

    // When: sendOpenFileAction is called with null fileRow
    sendOpenFileAction(resolved, makeExpandedCommit(), TEST_REPO);

    // Then: no message is sent and no exception is thrown
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* S2: buildFileContextMenuItems() menu item 構築                     */
/* ------------------------------------------------------------------ */

describe("buildFileContextMenuItems", () => {
  beforeEach(() => {
    vi.mocked(vscode.postMessage).mockClear();
  });

  // TC-007: 有効な row で Open File と Reset File を返す
  it("returns Open File and Reset File items for valid file row (TC-007)", () => {
    // Given: a valid .gitFile row with expandedCommit and repo
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });
    const commit = makeExpandedCommit();

    // When: buildFileContextMenuItems is called
    const items = buildFileContextMenuItems(row, commit, TEST_REPO);

    // Then: both file actions are present
    expect(items).toHaveLength(4);
    expect(items[0]).not.toBeNull();
    expect(items[0]!.title).toBe("Open File");
    expect(items[1]!.title).toBe("Mark as Reviewed");
    expect(findMenuItem(items, "Reopen with Encoding...")).toBeDefined();
    expect(findMenuItem(items, "Reset File to Revision...")).toBeDefined();
  });

  // TC-008: deleted file row でも both file actions を返す
  it("returns both file actions for deleted file row (TC-008)", () => {
    // Given: a deleted file row (type=D) with data-newfilepath
    const row = makeFileRow({ newfilepath: "src%2Fdeleted.ts" }, "D");
    const commit = makeExpandedCommit();

    // When: buildFileContextMenuItems is called
    const items = buildFileContextMenuItems(row, commit, TEST_REPO);

    // Then: still returns both items
    expect(items).toHaveLength(4);
    expect(findMenuItem(items, "Open File")).toBeDefined();
    expect(findMenuItem(items, "Mark as Reviewed")).toBeDefined();
    expect(findMenuItem(items, "Reset File to Revision...")).toBeDefined();
  });

  // TC-009: expandedCommit が null のとき空配列を返す
  it("returns empty array when expandedCommit is null (TC-009)", () => {
    // Given: a valid file row but expandedCommit is null
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });

    // When: buildFileContextMenuItems is called
    const items = buildFileContextMenuItems(row, null, TEST_REPO);

    // Then: empty array
    expect(items).toEqual([]);
  });

  // TC-010: data-newfilepath 欠落で空配列を返す
  it("returns empty array when data-newfilepath is missing (TC-010)", () => {
    // Given: a .gitFile row without data-newfilepath
    const row = makeFileRow({});
    const commit = makeExpandedCommit();

    // When: buildFileContextMenuItems is called
    const items = buildFileContextMenuItems(row, commit, TEST_REPO);

    // Then: empty array
    expect(items).toEqual([]);
  });

  // TC-011: menu item の onClick が icon click と同一構造の payload を送る
  it("onClick sends same payload structure as direct action (TC-011)", () => {
    // Given: a valid file row and menu items built
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });
    const commit = makeExpandedCommit();
    const items = buildFileContextMenuItems(row, commit, TEST_REPO);

    // When: the menu item's onClick is invoked
    items[0]!.onClick();

    // Then: payload matches the icon click structure exactly
    expect(vscode.postMessage).toHaveBeenCalledTimes(1);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      repo: TEST_REPO,
      filePath: "src/file.ts",
      commitHash: COMMIT_HASH
    });
  });
});

describe("buildFileContextMenuItems recent action metadata (S3)", () => {
  beforeEach(() => {
    vi.mocked(vscode.postMessage).mockClear();
    vi.mocked(recordRecentAction).mockClear();
  });

  it("assigns recentActionId to the Open File item (TC-012)", () => {
    // Case: TC-012
    // Given: a valid file row with expanded commit
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });
    const commit = makeExpandedCommit();

    // When: buildFileContextMenuItems is called
    const items = buildFileContextMenuItems(row, commit, TEST_REPO);

    // Then: the Open File item is recent-enabled with file.openFile
    expect(items).toHaveLength(4);
    expect(items[0]!.recentActionId).toBe("file.openFile");
  });

  it("records the action before sending openFile when the menu item is clicked (TC-013)", () => {
    // Case: TC-013
    // Given: a valid Open File menu item
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });
    const commit = makeExpandedCommit();
    const items = buildFileContextMenuItems(row, commit, TEST_REPO);

    // When: the menu item is clicked
    items[0]!.onClick();

    // Then: recordRecentAction runs before the openFile payload is posted
    expect(recordRecentAction).toHaveBeenCalledWith(TEST_REPO, "file.openFile");
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      repo: TEST_REPO,
      filePath: "src/file.ts",
      commitHash: COMMIT_HASH
    });
    expect(vi.mocked(recordRecentAction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(vscode.postMessage).mock.invocationCallOrder[0]
    );
  });

  it("does not record a recent action when guard conditions prevent building the menu (TC-014)", () => {
    // Case: TC-014
    // Given: expandedCommit is null so no menu item can be created
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });

    // When: buildFileContextMenuItems is called
    const items = buildFileContextMenuItems(row, null, TEST_REPO);

    // Then: no menu item exists and no recent action is recorded
    expect(items).toEqual([]);
    expect(recordRecentAction).not.toHaveBeenCalled();
  });
});

describe("Reset File to Revision menu action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is included for the currently expanded commit and selected file", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/file.ts") });
    const commit = makeExpandedCommit();

    const items = buildFileContextMenuItems(row, commit, TEST_REPO);
    const resetItem = findMenuItem(items, "Reset File to Revision...");

    resetItem.onClick();

    expect(showConfirmationDialog).toHaveBeenCalledTimes(1);
    const [message, confirmed, sourceElem] = vi.mocked(showConfirmationDialog).mock.calls[0];
    expect(message).toContain("src&#x2F;file.ts");
    expect(message).toContain("abc123de");
    expect(message).toContain("working-tree and index copies will be overwritten");
    expect(confirmed).toBeTypeOf("function");
    expect(sourceElem).toBe(row);
  });

  it("sends the revision and decoded file path after explicit confirmation", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/テスト file.ts") });
    const items = buildFileContextMenuItems(row, makeExpandedCommit(), TEST_REPO);

    findMenuItem(items, "Reset File to Revision...").onClick();
    const confirmed = vi.mocked(showConfirmationDialog).mock.calls[0][1];
    confirmed();

    expect(vscode.postMessage).toHaveBeenCalledTimes(1);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "resetFileToRevision",
      repo: TEST_REPO,
      revision: COMMIT_HASH,
      filePath: "src/テスト file.ts"
    });
  });

  it("does not send reset until confirmation is accepted", () => {
    const row = makeFileRow({ newfilepath: "src%2Ffile.ts" });
    const items = buildFileContextMenuItems(row, makeExpandedCommit(), TEST_REPO);

    findMenuItem(items, "Reset File to Revision...").onClick();

    expect(vscode.postMessage).not.toHaveBeenCalled();
  });
});

describe("reviewed file context action", () => {
  beforeEach(() => {
    vi.mocked(vscode.postMessage).mockClear();
  });

  it("sends the unreviewed file path when marking a single-commit file", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/file.ts") });
    const commit = makeExpandedCommit();

    const items = buildFileContextMenuItems(row, commit, TEST_REPO);
    const reviewedItem = findMenuItem(items, "Mark as Reviewed");
    expect(reviewedItem.actionId).toBe("file.markReviewed");

    reviewedItem.onClick();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "setFileReviewed",
      repo: TEST_REPO,
      commitHash: COMMIT_HASH,
      filePath: "src/file.ts",
      reviewed: true
    });
  });

  it("offers not-reviewed when the file is already reviewed", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/file.ts") });
    const commit = { ...makeExpandedCommit(), reviewedFiles: ["src/file.ts"] };

    const item = findMenuItem(buildFileContextMenuItems(row, commit, TEST_REPO), "Mark as Not Reviewed");
    item.onClick();

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reviewed: false })
    );
  });

  it("does not offer review actions for comparison mode or uncommitted changes", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/file.ts") });

    const compareItems = buildFileContextMenuItems(
      row,
      { ...makeExpandedCommit(), compareWithHash: "bbb222" },
      TEST_REPO
    );
    expect(compareItems.find((item) => item?.title === "Mark as Reviewed")).toBeUndefined();

    const uncommittedItems = buildFileContextMenuItems(
      row,
      { ...makeExpandedCommit("*") },
      TEST_REPO
    );
    expect(uncommittedItems.find((item) => item?.title === "Mark as Reviewed")).toBeUndefined();
  });

  it("honors the persisted context-menu visibility setting", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/file.ts") });
    const items = buildFileContextMenuItems(
      row,
      { ...makeExpandedCommit(), reviewedFiles: ["src/file.ts"] },
      TEST_REPO
    );
    const visible = filterContextMenuItems(items, "file", {
      branch: {},
      commit: {},
      file: { "file.markReviewed": false },
      remoteBranch: {},
      stash: {},
      tag: {},
      uncommitted: {}
    });

    expect(visible.find((item) => item?.title === "Mark as Reviewed")).toBeUndefined();
    expect(visible.some((item) => item?.actionId === "file.markNotReviewed")).toBe(true);
    expect(visible.some((item) => item?.actionId === "file.markReviewed")).toBe(false);
    expect(findMenuItem(visible, "Open File")).toBeDefined();
  });
});

describe("reopen with encoding context action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is offered as a compact submenu-free file action", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/file.ts") });
    const items = buildFileContextMenuItems(row, makeExpandedCommit(), TEST_REPO);
    const item = findMenuItem(items, "Reopen with Encoding...");

    expect(item.actionId).toBe("file.reopenWithEncoding");
    item.onClick();

    expect(showSelectDialog).toHaveBeenCalledTimes(1);
    const [message, selected, options] = vi.mocked(showSelectDialog).mock.calls[0];
    expect(message).toBe("Reopen with Encoding...");
    expect(selected).toBe("utf8");
    expect(options.map((option) => option.value)).toEqual([
      "utf8",
      "shift_jis",
      "euc-jp",
      "iso-2022-jp",
      "utf-16le",
      "windows-1252"
    ]);
  });

  it("sends the selected encoding for immediate host validation and reopening", () => {
    const row = makeFileRow({ newfilepath: encodeURIComponent("src/テスト file.ts") });
    const items = buildFileContextMenuItems(
      row,
      makeExpandedCommit(),
      TEST_REPO,
      undefined,
      "shift_jis"
    );

    findMenuItem(items, "Reopen with Encoding...").onClick();
    const selectEncoding = vi.mocked(showSelectDialog).mock.calls[0][4];
    selectEncoding("windows-1252");

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "reopenFile",
      repo: TEST_REPO,
      commitHash: COMMIT_HASH,
      filePath: "src/テスト file.ts",
      encoding: "windows-1252"
    });
  });
});
