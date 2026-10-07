export interface CodeReviewButtonState {
  /** Whether a review is active for the currently expanded commit. */
  active: boolean;
  /** Localized tooltip / accessible name, including the review progress. */
  title: string;
}

const BUTTON_ID = "commitDetailsCodeReview";

/**
 * Syncs the code review rail button with the review state. The button markup
 * is built by the caller; only the state-dependent attributes live here so the
 * active styling and labels stay testable without the commit details view.
 */
export function updateCodeReviewButton(root: HTMLElement, state: CodeReviewButtonState): void {
  if (root.id !== BUTTON_ID) {
    throw new Error("updateCodeReviewButton requires the commit details code review button");
  }

  root.classList.toggle("active", state.active);
  root.setAttribute("aria-pressed", String(state.active));
  root.title = state.title;
  root.setAttribute("aria-label", state.title);
}
