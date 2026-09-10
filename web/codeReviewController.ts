export interface CodeReviewFileState {
  path: string;
  reviewed: boolean;
}

export interface CodeReviewPanelOptions {
  files: CodeReviewFileState[];
  active: boolean;
  compareLabel: string;
  callbacks: {
    onStart(): void;
    onEnd(): void;
    onToggleReviewed(path: string, reviewed: boolean): void;
    onFocusFile(path: string): void;
  };
}

type CodeReviewCallbacks = CodeReviewPanelOptions["callbacks"];

const panelCallbacks = new WeakMap<HTMLElement, CodeReviewCallbacks>();

export function renderCodeReviewPanel(options: CodeReviewPanelOptions): HTMLElement {
  const root = document.createElement("section");
  root.className = "code-review-panel";
  root.setAttribute("aria-label", "Code review");

  panelCallbacks.set(root, options.callbacks);

  const header = document.createElement("header");
  header.className = "code-review-header";

  const title = document.createElement("h3");
  title.className = "code-review-title";
  title.textContent = "Code review";

  const compareLabel = document.createElement("p");
  compareLabel.className = "code-review-compare-label";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "code-review-action";

  header.append(title, compareLabel, action);

  const status = document.createElement("div");
  status.className = "code-review-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-label", "Code review status");

  const progress = document.createElement("div");
  progress.className = "code-review-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Reviewed files");
  progress.setAttribute("aria-valuemin", "0");

  const progressTrack = document.createElement("div");
  progressTrack.className = "code-review-progress-track";

  const progressValue = document.createElement("div");
  progressValue.className = "code-review-progress-value code-review-transition";
  progressTrack.append(progressValue);

  const progressText = document.createElement("span");
  progressText.className = "code-review-progress-text";
  progress.append(progressTrack, progressText);

  const files = document.createElement("ul");
  files.className = "code-review-files";
  files.setAttribute("role", "list");
  files.setAttribute("aria-label", "Files in review");

  root.append(header, status, progress, files);
  updateCodeReviewPanel(root, options);

  return root;
}

export function updateCodeReviewPanel(root: HTMLElement, options: CodeReviewPanelOptions): void {
  const callbacks = panelCallbacks.get(root);
  if (callbacks === undefined) {
    throw new Error("updateCodeReviewPanel requires a root created by renderCodeReviewPanel");
  }

  panelCallbacks.set(root, options.callbacks);

  const focusedElement = document.activeElement;
  const shouldRestoreFocus = focusedElement instanceof HTMLElement && root.contains(focusedElement);
  const focusedPath = shouldRestoreFocus ? focusedElement.dataset.codeReviewPath : undefined;
  const focusedToggle =
    shouldRestoreFocus && focusedElement.classList.contains("code-review-file-toggle");

  const compareLabel = root.querySelector<HTMLElement>(".code-review-compare-label");
  const action = root.querySelector<HTMLButtonElement>(".code-review-action");
  const status = root.querySelector<HTMLElement>(".code-review-status");
  const progress = root.querySelector<HTMLElement>(".code-review-progress");
  const progressValue = root.querySelector<HTMLElement>(".code-review-progress-value");
  const progressText = root.querySelector<HTMLElement>(".code-review-progress-text");
  const files = root.querySelector<HTMLUListElement>(".code-review-files");

  if (
    compareLabel === null ||
    action === null ||
    status === null ||
    progress === null ||
    progressValue === null ||
    progressText === null ||
    files === null
  ) {
    throw new Error("Invalid code review panel structure");
  }

  const reviewedCount = options.files.reduce(
    (count, file) => (file.reviewed ? count + 1 : count),
    0
  );
  const totalCount = options.files.length;
  const progressDescription = `${reviewedCount}/${totalCount} reviewed`;
  const percent = totalCount === 0 ? 0 : Math.round((reviewedCount / totalCount) * 100);

  root.classList.toggle("is-active", options.active);
  root.classList.toggle("is-inactive", !options.active);
  compareLabel.textContent = options.compareLabel;

  const actionLabel = options.active
    ? "End code review"
    : reviewedCount === 0
      ? "Start code review"
      : "Resume code review";
  action.textContent = actionLabel;
  action.setAttribute("aria-label", actionLabel);
  action.className = options.active
    ? "code-review-action is-active"
    : "code-review-action is-inactive";
  action.onclick = () => {
    const currentCallbacks = panelCallbacks.get(root);
    if (currentCallbacks === undefined) {
      return;
    }
    if (options.active) {
      currentCallbacks.onEnd();
    } else {
      currentCallbacks.onStart();
    }
  };

  status.textContent = `${options.active ? "Code review is active." : "Code review is not active."} ${progressDescription}`;

  progress.setAttribute("aria-valuemax", String(totalCount));
  progress.setAttribute("aria-valuenow", String(reviewedCount));
  progress.setAttribute("aria-valuetext", `${reviewedCount} of ${totalCount} reviewed`);
  progressValue.style.setProperty("--code-review-progress", `${percent}%`);
  progressValue.dataset.progress = String(percent);
  progressText.textContent = progressDescription;

  files.replaceChildren(
    ...options.files.map((file) => {
      const item = document.createElement("li");
      item.className = "code-review-file-item";
      item.setAttribute("role", "listitem");

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `code-review-file-chip ${file.reviewed ? "is-reviewed" : "is-unreviewed"}`;
      chip.dataset.codeReviewPath = file.path;
      chip.setAttribute("aria-label", `Focus file: ${file.path}`);

      const path = document.createElement("span");
      path.className = "code-review-file-path";
      path.textContent = file.path;
      chip.append(path);
      chip.onclick = () => {
        const currentCallbacks = panelCallbacks.get(root);
        if (currentCallbacks !== undefined) {
          currentCallbacks.onFocusFile(file.path);
        }
      };

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `code-review-file-toggle ${file.reviewed ? "is-reviewed" : "is-unreviewed"}`;
      toggle.dataset.codeReviewPath = file.path;
      toggle.setAttribute("aria-pressed", String(file.reviewed));
      toggle.setAttribute(
        "aria-label",
        `${file.reviewed ? "Mark as not reviewed" : "Mark as reviewed"}: ${file.path}`
      );
      toggle.textContent = file.reviewed ? "Reviewed" : "Not reviewed";
      toggle.onclick = () => {
        const currentCallbacks = panelCallbacks.get(root);
        if (currentCallbacks !== undefined) {
          currentCallbacks.onToggleReviewed(file.path, !file.reviewed);
        }
      };

      item.append(chip, toggle);
      return item;
    })
  );

  if (focusedPath === undefined) {
    return;
  }
  const selector = focusedToggle ? ".code-review-file-toggle" : ".code-review-file-chip";
  const replacement = Array.from(files.querySelectorAll<HTMLElement>(selector)).find(
    (candidate) => candidate.dataset.codeReviewPath === focusedPath
  );
  if (replacement !== undefined && shouldRestoreFocus) {
    replacement.focus();
  }
}
