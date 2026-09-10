// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ColumnMenuOption,
  ColumnVisibilityMenu,
  countVisibleDataColumns,
  normalizeColumnVisibility
} from "../../web/columnVisibility";

function createOption(
  overrides: Partial<Omit<ColumnMenuOption, "id" | "label">> &
    Pick<ColumnMenuOption, "id" | "label">
): ColumnMenuOption {
  return {
    kind: "checkbox",
    checked: false,
    disabled: false,
    onActivate: vi.fn(),
    ...overrides
  };
}

describe("column visibility state", () => {
  it("uses all columns by default and always keeps the graph column visible", () => {
    expect(normalizeColumnVisibility(undefined)).toEqual({
      graph: true,
      author: true,
      date: true,
      commit: true
    });
    expect(normalizeColumnVisibility({ graph: false, author: false }).graph).toBe(true);
  });

  it("preserves toggled data columns and rejects an all-hidden state", () => {
    expect(normalizeColumnVisibility({ author: false, date: true, commit: false })).toEqual({
      graph: true,
      author: false,
      date: true,
      commit: false
    });
    expect(normalizeColumnVisibility({ author: false, date: false, commit: false })).toEqual({
      graph: true,
      author: true,
      date: true,
      commit: true
    });
    expect(
      countVisibleDataColumns(normalizeColumnVisibility({ author: false, commit: false }))
    ).toBe(1);
  });
});

describe("ColumnVisibilityMenu", () => {
  let anchor: HTMLElement;
  let menu: ColumnVisibilityMenu;

  beforeEach(() => {
    document.body.innerHTML = "";
    anchor = document.createElement("button");
    document.body.append(anchor);
    menu = new ColumnVisibilityMenu();
  });

  it("renders an accessible compact checkbox menu and focuses it", () => {
    menu.show({
      anchor,
      ariaLabel: "Graph columns",
      clientX: 10,
      clientY: 10,
      options: [
        createOption({ id: "author", label: "Author", checked: true }),
        createOption({ id: "date", label: "Date" }),
        createOption({ id: "commit", label: "Commit" })
      ]
    });

    const menuElement = document.querySelector<HTMLUListElement>(".columnVisibilityMenu");
    const items = document.querySelectorAll<HTMLLIElement>('[role="menuitemcheckbox"]');

    expect(menuElement).not.toBeNull();
    expect(menuElement!.getAttribute("role")).toBe("menu");
    expect(menuElement!.getAttribute("aria-label")).toBe("Graph columns");
    expect(items).toHaveLength(3);
    expect(items[0]!.getAttribute("aria-checked")).toBe("true");
    expect(items[1]!.getAttribute("aria-checked")).toBe("false");
    expect(items[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(items[1]);
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    expect(menu.isActive()).toBe(true);
  });

  it("toggles a checkbox and updates the invariant without closing the menu", () => {
    const onToggle = vi.fn();
    menu.show({
      anchor,
      ariaLabel: "Graph columns",
      clientX: 0,
      clientY: 0,
      options: [
        createOption({ id: "author", label: "Author", checked: true, onActivate: onToggle }),
        createOption({ id: "date", label: "Date", checked: true }),
        createOption({ id: "commit", label: "Commit" })
      ]
    });

    const authorItem = document.querySelector<HTMLLIElement>('[data-option-id="author"]')!;
    authorItem.click();

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(authorItem.getAttribute("aria-checked")).toBe("false");
    expect(authorItem.getAttribute("aria-disabled")).toBeNull();
    expect(menu.isActive()).toBe(true);
  });

  it("supports arrow-key navigation, activation, Escape, and focus restoration", () => {
    const onSelect = vi.fn();
    anchor.focus();
    menu.show({
      anchor,
      ariaLabel: "Graph columns",
      clientX: 0,
      clientY: 0,
      options: [
        createOption({ id: "author", label: "Author", checked: true }),
        createOption({ id: "date", label: "Date", checked: true, onActivate: onSelect })
      ]
    });

    menuElement().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(
      document.querySelector<HTMLLIElement>('[data-option-id="date"]')
    );

    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(onSelect).toHaveBeenCalledWith(false);

    menuElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.isActive()).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it("closes on an outside pointer press", () => {
    menu.show({
      anchor,
      ariaLabel: "Graph columns",
      clientX: 0,
      clientY: 0,
      options: [createOption({ id: "author", label: "Author", checked: true })]
    });

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(menu.isActive()).toBe(false);
  });

  function menuElement(): HTMLElement {
    return document.querySelector<HTMLElement>(".columnVisibilityMenu")!;
  }
});
