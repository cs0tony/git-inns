/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";

import { updateCodeReviewButton } from "../../web/codeReviewController";

function createButton(): HTMLElement {
  const root = document.createElement("button");
  root.type = "button";
  root.id = "commitDetailsCodeReview";
  root.className = "commitDetailsControlBtn";
  root.setAttribute("aria-pressed", "false");
  document.body.append(root);
  return root;
}

describe("code review rail button", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("marks the button inactive with the start tooltip (TC-701)", () => {
    // Case: TC-701
    // Given: a code review rail button that has not been synced yet
    const root = createButton();

    // When: updateCodeReviewButton runs with an inactive review
    updateCodeReviewButton(root, { active: false, title: "Start code review · 0/2 reviewed" });

    // Then: the active class and pressed state are absent and the title is set
    expect(root.classList.contains("active")).toBe(false);
    expect(root.getAttribute("aria-pressed")).toBe("false");
    expect(root.title).toBe("Start code review · 0/2 reviewed");
    expect(root.getAttribute("aria-label")).toBe("Start code review · 0/2 reviewed");
  });

  it("marks the button active with the end tooltip (TC-702)", () => {
    // Case: TC-702
    // Given: a code review rail button
    const root = createButton();

    // When: updateCodeReviewButton runs with an active review
    updateCodeReviewButton(root, { active: true, title: "End code review · 1/2 reviewed" });

    // Then: the active class and pressed state are present and the title is set
    expect(root.classList.contains("active")).toBe(true);
    expect(root.getAttribute("aria-pressed")).toBe("true");
    expect(root.title).toBe("End code review · 1/2 reviewed");
    expect(root.getAttribute("aria-label")).toBe("End code review · 1/2 reviewed");
  });

  it("rejects roots that are not the code review button (TC-703)", () => {
    // Case: TC-703
    // Given: an unrelated element
    const root = document.createElement("div");
    document.body.append(root);

    // When: updateCodeReviewButton runs against it
    // Then: it throws instead of mutating the wrong element
    expect(() => updateCodeReviewButton(root, { active: true, title: "x" })).toThrow();
  });
});
