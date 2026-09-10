import * as GG from "../src/types";

export const DEFAULT_COLUMN_VISIBILITY: GG.ColumnVisibility = {
  graph: true,
  author: true,
  date: true,
  commit: true
};

const DATA_COLUMN_KEYS = ["author", "date", "commit"] as const;

export type DataColumnKey = (typeof DATA_COLUMN_KEYS)[number];

export interface ColumnMenuOption {
  id: string;
  label: string;
  kind: "checkbox" | "radio";
  checked: boolean;
  disabled?: boolean;
  onActivate: (checked: boolean) => void;
}

export interface ColumnMenuOptions {
  anchor: HTMLElement;
  ariaLabel: string;
  clientX: number;
  clientY: number;
  options: ColumnMenuOption[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function countVisibleDataColumns(visibility: GG.ColumnVisibility): number {
  return DATA_COLUMN_KEYS.reduce((count, key) => count + (visibility[key] ? 1 : 0), 0);
}

export function normalizeColumnVisibility(value: unknown): GG.ColumnVisibility {
  const candidate = isRecord(value) ? value : {};
  const normalized: GG.ColumnVisibility = {
    graph: true,
    author: candidate.author === false ? false : true,
    date: candidate.date === false ? false : true,
    commit: candidate.commit === false ? false : true
  };

  return countVisibleDataColumns(normalized) > 0 ? normalized : { ...DEFAULT_COLUMN_VISIBILITY };
}

export class ColumnVisibilityMenu {
  private menuElement: HTMLUListElement | null = null;
  private anchorElement: HTMLElement | null = null;
  private currentOptions: ColumnMenuOption[] = [];
  private readonly handleDocumentPointerDown = (event: PointerEvent) => {
    if (
      this.menuElement !== null &&
      event.target instanceof Node &&
      !this.menuElement.contains(event.target)
    ) {
      this.close();
    }
  };
  private readonly handleKeydown = (event: KeyboardEvent) => {
    const items = this.getItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const focusItem = (index: number) => {
      event.preventDefault();
      event.stopPropagation();
      items[index]!.focus();
    };

    switch (event.key) {
      case "ArrowDown":
        focusItem(this.nextEnabledIndex(items, currentIndex, 1));
        break;
      case "ArrowUp":
        focusItem(this.nextEnabledIndex(items, currentIndex, -1));
        break;
      case "Home":
        focusItem(this.nextEnabledIndex(items, -1, 1));
        break;
      case "End":
        focusItem(this.nextEnabledIndex(items, items.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (document.activeElement instanceof HTMLLIElement) {
          this.activate(document.activeElement);
        }
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
    }
  };

  public show(options: ColumnMenuOptions): void {
    this.close(false);

    const menuElement = document.createElement("ul");
    menuElement.className = "columnVisibilityMenu";
    menuElement.setAttribute("role", "menu");
    menuElement.setAttribute("aria-label", options.ariaLabel);
    menuElement.style.visibility = "hidden";
    menuElement.addEventListener("keydown", this.handleKeydown);

    this.currentOptions = options.options;
    for (const option of options.options) {
      const item = document.createElement("li");
      item.className = "columnVisibilityItem";
      item.dataset.optionId = option.id;
      item.dataset.optionKind = option.kind;
      item.tabIndex = -1;
      item.textContent = option.label;
      item.setAttribute("role", `menuitem${option.kind}`);
      item.setAttribute("aria-checked", option.checked ? "true" : "false");
      if (option.disabled === true) {
        item.setAttribute("aria-disabled", "true");
        item.classList.add("disabled");
      }
      item.addEventListener("click", () => this.activate(item));
      menuElement.append(item);
    }

    document.body.append(menuElement);
    this.menuElement = menuElement;
    this.anchorElement = options.anchor;
    options.anchor.setAttribute("aria-haspopup", "menu");
    options.anchor.setAttribute("aria-expanded", "true");
    this.position(menuElement, options.clientX, options.clientY);
    this.updateDataColumnInvariant();

    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    const firstItem = this.nextEnabledIndex(this.getItems(), -1, 1);
    if (firstItem > -1) this.getItems()[firstItem]!.focus();
  }

  public isActive(): boolean {
    return this.menuElement !== null;
  }

  public close(restoreFocus: boolean = true): void {
    if (this.menuElement === null) return;

    this.menuElement.remove();
    this.menuElement = null;
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    if (restoreFocus && this.anchorElement !== null) this.anchorElement.focus();
    if (this.anchorElement !== null) this.anchorElement.setAttribute("aria-expanded", "false");
    this.anchorElement = null;
  }

  private activate(item: HTMLLIElement): void {
    if (item.getAttribute("aria-disabled") === "true") return;

    const checked = item.getAttribute("aria-checked") !== "true";
    if (item.dataset.optionKind === "checkbox") {
      item.setAttribute("aria-checked", checked ? "true" : "false");
      this.updateDataColumnInvariant();
    } else {
      this.close();
    }

    const option = this.findOption(item);
    option?.onActivate(checked);
  }

  private findOption(item: HTMLLIElement): ColumnMenuOption | null {
    const options = this.currentOptions;
    const optionId = item.dataset.optionId;
    return options.find((option) => option.id === optionId) ?? null;
  }

  private updateDataColumnInvariant(): void {
    if (this.menuElement === null) return;

    const items = Array.from(
      this.menuElement.querySelectorAll<HTMLLIElement>('li[role="menuitemcheckbox"]')
    );
    const visibleCount = items.filter(
      (item) => item.getAttribute("aria-checked") === "true"
    ).length;
    for (const item of items) {
      const isLastVisible = visibleCount === 1 && item.getAttribute("aria-checked") === "true";
      item.classList.toggle("disabled", isLastVisible);
      if (isLastVisible) {
        item.setAttribute("aria-disabled", "true");
      } else {
        item.removeAttribute("aria-disabled");
      }
    }
  }

  private position(menuElement: HTMLElement, clientX: number, clientY: number): void {
    const bounds = menuElement.getBoundingClientRect();
    const left =
      clientX + bounds.width <= window.innerWidth
        ? clientX
        : Math.max(0, window.innerWidth - bounds.width);
    const top =
      clientY + bounds.height <= window.innerHeight
        ? clientY
        : Math.max(0, window.innerHeight - bounds.height);
    menuElement.style.left = `${left}px`;
    menuElement.style.top = `${top}px`;
    menuElement.style.visibility = "";
  }

  private getItems(): HTMLLIElement[] {
    return this.menuElement === null
      ? []
      : Array.from(this.menuElement.querySelectorAll<HTMLLIElement>("[role^='menuitem']"));
  }

  private nextEnabledIndex(
    items: HTMLLIElement[],
    currentIndex: number,
    direction: 1 | -1
  ): number {
    if (items.length === 0) return -1;

    let index = currentIndex;
    for (let step = 0; step < items.length; step += 1) {
      index = (index + direction + items.length) % items.length;
      if (items[index]!.getAttribute("aria-disabled") !== "true") return index;
    }
    return currentIndex > -1 ? currentIndex : -1;
  }
}
