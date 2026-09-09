import { describe, expect, it, vi } from "vitest";

import { filterContextMenuItems } from "../../web/contextMenuVisibility";

function menuItem(
  title: string,
  actionId?: ContextMenuActionId
): ContextMenuItem {
  return {
    title,
    ...(actionId === undefined ? {} : { actionId }),
    onClick: vi.fn()
  };
}

function submenu(title: string, children: ContextMenuElement[]): ContextMenuSubmenu {
  return { title, submenu: children };
}

const visibility = {
  branch: { "ref.deleteBranch": false },
  commit: { "commit.merge": false },
  file: { "file.openFile": false },
  remoteBranch: {},
  stash: { "stash.apply": false },
  tag: {},
  uncommitted: {}
} as unknown as ContextMenuActionsVisibility;

describe("filterContextMenuItems", () => {
  it("hides the configured action and removes the separator it makes dangling", () => {
    // Given: a menu whose first section consists only of one hidden action
    const items = [
      menuItem("Hidden", "stash.apply"),
      null,
      menuItem("Pop Stash", "stash.pop")
    ];

    // When: the menu is filtered for the stash group
    const result = filterContextMenuItems(items, "stash", visibility);

    // Then: only the visible action remains
    expect(result.map((item) => item?.title)).toEqual(["Pop Stash"]);
  });

  it("removes an empty More submenu and surrounding separators", () => {
    // Given: More contains only an action hidden in the commit group
    const items = [
      menuItem("Create Branch", "commit.createBranch"),
      null,
      submenu("More", [menuItem("Merge", "commit.merge")]),
      null,
      menuItem("Copy Hash", "commit.copyHash")
    ];

    // When: the menu is filtered
    const result = filterContextMenuItems(items, "commit", visibility);

    // Then: More is absent and separators still separate the visible actions
    expect(result).toEqual([
      expect.objectContaining({ title: "Create Branch" }),
      null,
      expect.objectContaining({ title: "Copy Hash" })
    ]);
  });

  it("removes headings that no longer introduce an action", () => {
    // Given: a label's only child is hidden and a later label remains meaningful
    const items = [
      { kind: "label" as const, title: "Recent" },
      menuItem("Hidden", "stash.apply"),
      null,
      { kind: "label" as const, title: "Actions" },
      menuItem("Visible")
    ];

    // When: the menu is filtered
    const result = filterContextMenuItems(items, "stash", visibility);

    // Then: only the meaningful label and visible action remain
    expect(result).toEqual([
      { kind: "label", title: "Actions" },
      expect.objectContaining({ title: "Visible" })
    ]);
  });

  it("does not mutate the input menu", () => {
    // Given: a nested menu with a hidden action
    const children = [menuItem("Hidden", "ref.deleteBranch")];
    const items = [submenu("More", children)];
    const snapshot = JSON.stringify(items);

    // When: the menu is filtered
    filterContextMenuItems(items, "branch", visibility);

    // Then: the original tree is unchanged
    expect(JSON.stringify(items)).toEqual(snapshot);
  });
});
