/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CodeReviewPanelOptions,
  renderCodeReviewPanel,
  updateCodeReviewPanel
} from "../../web/codeReviewController";

function createOptions(overrides: Partial<CodeReviewPanelOptions> = {}): CodeReviewPanelOptions {
  return {
    files: [
      { path: "src/one.ts", reviewed: false },
      { path: "src/two.ts", reviewed: true }
    ],
    active: false,
    compareLabel: "main...feature/modern-ui",
    callbacks: {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onToggleReviewed: vi.fn(),
      onFocusFile: vi.fn()
    },
    ...overrides
  };
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
}

describe("code review panel", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders progress, compare details, and inactive lifecycle controls", () => {
    const callbacks = createOptions().callbacks;
    const root = renderCodeReviewPanel(
      createOptions({
        files: [
          { path: "src/one.ts", reviewed: false },
          { path: "src/two.ts", reviewed: false }
        ],
        callbacks
      })
    );
    document.body.append(root);

    expect(root.className).toBe("code-review-panel is-inactive");
    expect(query(".code-review-title").textContent).toBe("Code review");
    expect(query(".code-review-compare-label").textContent).toBe("main...feature/modern-ui");

    const action = query<HTMLButtonElement>(".code-review-action");
    expect(action.textContent).toBe("Start code review");
    expect(action.getAttribute("aria-label")).toBe("Start code review");

    const status = query(".code-review-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Code review is not active.");
    expect(status.textContent).toContain("0/2 reviewed");

    const progress = query(".code-review-progress");
    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("2");
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(progress.getAttribute("aria-valuetext")).toBe("0 of 2 reviewed");
    expect(query(".code-review-progress-text").textContent).toBe("0/2 reviewed");
    expect(root.textContent).toContain("0/2 reviewed");
    expect(query(".code-review-progress-value").className).toContain("code-review-transition");
  });

  it("shows End while active and dispatches lifecycle callbacks without changing local state", () => {
    const callbacks = createOptions().callbacks;
    const root = renderCodeReviewPanel(createOptions({ active: true, callbacks }));
    document.body.append(root);

    const action = query<HTMLButtonElement>(".code-review-action");
    expect(action.textContent).toBe("End code review");
    expect(root.className).toBe("code-review-panel is-active");

    action.click();
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.onStart).not.toHaveBeenCalled();

    updateCodeReviewPanel(root, createOptions({ active: false, callbacks }));
    query<HTMLButtonElement>(".code-review-action").click();
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
  });

  it("uses Resume when an inactive review already has reviewed files", () => {
    document.body.append(renderCodeReviewPanel(createOptions()));

    expect(query<HTMLButtonElement>(".code-review-action").textContent).toBe("Resume code review");
  });

  it("dispatches file focus and reviewed toggles with explicit paths", () => {
    const options = createOptions();
    document.body.append(renderCodeReviewPanel(options));

    const chips = document.querySelectorAll<HTMLButtonElement>(".code-review-file-chip");
    const toggles = document.querySelectorAll<HTMLButtonElement>(".code-review-file-toggle");

    chips[0]!.click();
    chips[1]!.click();
    toggles[0]!.click();
    toggles[1]!.click();

    expect(options.callbacks.onFocusFile).toHaveBeenCalledTimes(2);
    expect(options.callbacks.onFocusFile).toHaveBeenNthCalledWith(1, "src/one.ts");
    expect(options.callbacks.onFocusFile).toHaveBeenNthCalledWith(2, "src/two.ts");
    expect(options.callbacks.onToggleReviewed).toHaveBeenCalledTimes(2);
    expect(options.callbacks.onToggleReviewed).toHaveBeenNthCalledWith(1, "src/one.ts", true);
    expect(options.callbacks.onToggleReviewed).toHaveBeenNthCalledWith(2, "src/two.ts", false);

    expect(chips[0]!.getAttribute("aria-label")).toBe("Focus file: src/one.ts");
    expect(toggles[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(toggles[0]!.getAttribute("aria-label")).toBe("Mark as reviewed: src/one.ts");
    expect(toggles[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(toggles[1]!.getAttribute("aria-label")).toBe("Mark as not reviewed: src/two.ts");
  });

  it("keeps file list semantics, focusable chips, and safe text content", () => {
    const dangerous = '<img src=x onerror="alert(1)">';
    const panel = renderCodeReviewPanel(
      createOptions({
        files: [{ path: dangerous, reviewed: false }],
        compareLabel: "<script>alert(2)</script>"
      })
    );
    document.body.append(panel);

    const files = query(".code-review-files");
    expect(files.tagName).toBe("UL");
    expect(files.getAttribute("role")).toBe("list");
    expect(files.getAttribute("aria-label")).toBe("Files in review");

    const chip = query<HTMLButtonElement>(".code-review-file-chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.textContent).toBe(dangerous);
    expect(chip.getAttribute("aria-label")).toBe(`Focus file: ${dangerous}`);
    expect(query(".code-review-compare-label").textContent).toBe("<script>alert(2)</script>");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("updates the same root deterministically while preserving focus and callbacks", () => {
    const original = createOptions();
    const root = renderCodeReviewPanel(original);
    document.body.append(root);
    const originalAction = query(".code-review-action");
    const originalChip = query(".code-review-file-chip");
    originalChip.focus();

    const updatedCallbacks = createOptions().callbacks;
    const updated = createOptions({
      active: true,
      compareLabel: "v1.0...v1.1",
      files: [
        { path: "src/one.ts", reviewed: false },
        { path: "src/two.ts", reviewed: true }
      ],
      callbacks: updatedCallbacks
    });
    updateCodeReviewPanel(root, updated);

    expect(root).toBe(document.querySelector(".code-review-panel"));
    expect(query(".code-review-action")).toBe(originalAction);
    expect(originalAction.textContent).toBe("End code review");
    expect(query(".code-review-compare-label").textContent).toBe("v1.0...v1.1");
    expect(query(".code-review-status").textContent).toBe("Code review is active. 1/2 reviewed");
    expect(query(".code-review-progress").getAttribute("aria-valuemax")).toBe("2");
    expect(query(".code-review-progress").getAttribute("aria-valuenow")).toBe("1");
    expect(query(".code-review-progress-value").dataset.progress).toBe("50");
    expect(document.querySelectorAll(".code-review-file-item")).toHaveLength(2);
    expect(document.activeElement).toBe(document.querySelectorAll(".code-review-file-chip")[0]);

    updated.callbacks.onStart();
    expect(updatedCallbacks.onStart).toHaveBeenCalledTimes(1);

    updatedCallbacks.onStart.mockClear();
    updateCodeReviewPanel(
      root,
      createOptions({
        active: true,
        compareLabel: "v1.0...v1.1",
        files: [
          { path: "src/one.ts", reviewed: false },
          { path: "src/two.ts", reviewed: true }
        ],
        callbacks: updatedCallbacks
      })
    );
    expect(document.querySelectorAll(".code-review-file-item")).toHaveLength(2);
    expect(document.activeElement).toBe(document.querySelectorAll(".code-review-file-chip")[0]);

    updateCodeReviewPanel(
      root,
      createOptions({
        files: [{ path: "src/one.ts", reviewed: true }]
      })
    );
    expect(document.querySelectorAll(".code-review-file-item")).toHaveLength(1);
    expect(originalChip.isConnected).toBe(false);
  });

  it("rejects updates to unrelated DOM elements", () => {
    const root = document.createElement("div");

    expect(() => updateCodeReviewPanel(root, createOptions())).toThrow(
      "updateCodeReviewPanel requires a root created by renderCodeReviewPanel"
    );
  });
});
