import type {
  ContextMenuActionId,
  ContextMenuActionsVisibility,
  ContextMenuGroup
} from "../src/types";

function isSubmenu(item: Exclude<ContextMenuElement, null>): item is ContextMenuSubmenu {
  return "submenu" in item;
}

function isLabel(item: Exclude<ContextMenuElement, null>): item is ContextMenuLabel {
  return "kind" in item && item.kind === "label";
}

function hasActionableEntry(items: readonly ContextMenuElement[]): boolean {
  return items.some((item) => {
    if (item === null || isLabel(item)) return false;
    if (isSubmenu(item)) return hasActionableEntry(item.submenu);
    return true;
  });
}

function removeUnanchoredLabels(items: readonly ContextMenuElement[]): ContextMenuElement[] {
  const result: ContextMenuElement[] = [];

  for (const [index, item] of items.entries()) {
    if (item === null || !isLabel(item)) {
      result.push(item);
      continue;
    }

    let hasFollowingAction = false;
    for (const candidate of items.slice(index + 1)) {
      if (candidate === null) continue;
      if (isLabel(candidate)) break;
      hasFollowingAction = true;
      break;
    }
    if (hasFollowingAction) {
      result.push(item);
    }
  }

  return result;
}

function removeDanglingSeparators(items: readonly ContextMenuElement[]): ContextMenuElement[] {
  const result: ContextMenuElement[] = [];
  let previousVisibleEntry: ContextMenuElement | null = null;

  for (const item of items) {
    if (item === null) {
      if (previousVisibleEntry !== null && result[result.length - 1] !== null) {
        result.push(item);
      }
      continue;
    }

    result.push(item);
    previousVisibleEntry = item;
  }

  while (result.length > 0 && result[result.length - 1] === null) {
    result.pop();
  }

  return result;
}

/**
 * Filter a context-menu tree without mutating its input. Missing action keys are
 * visible; separators and empty headings/parents are cleaned up after filtering.
 */
export function filterContextMenuItems(
  items: readonly ContextMenuElement[],
  group: ContextMenuGroup,
  visibility: ContextMenuActionsVisibility | undefined
): ContextMenuElement[] {
  const groupVisibility = visibility?.[group];
  const filtered: ContextMenuElement[] = items.map((item) => {
    if (item === null || isLabel(item)) return item;

    if (isSubmenu(item)) {
      const children = filterContextMenuItems(item.submenu, group, visibility);
      return hasActionableEntry(children) ? { ...item, submenu: children } : null;
    }

    const isHidden =
      item.actionId !== undefined &&
      groupVisibility?.[item.actionId as ContextMenuActionId] === false;
    return isHidden ? null : item;
  });

  return removeDanglingSeparators(removeUnanchoredLabels(filtered));
}
