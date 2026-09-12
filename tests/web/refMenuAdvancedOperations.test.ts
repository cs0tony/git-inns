// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../web/contextMenu", () => ({
  recordRecentAction: vi.fn()
}));

vi.mock("../../web/dialogs", () => ({
  showCheckboxDialog: vi.fn(),
  showConfirmationDialog: vi.fn(),
  showErrorDialog: vi.fn(),
  showFormDialog: vi.fn(),
  showRefInputDialog: vi.fn(),
  showSelectDialog: vi.fn()
}));

vi.mock("../../web/utils", () => ({
  ELLIPSIS: "...",
  escapeHtml: (value: string) => value,
  getRepoName: vi.fn(),
  sanitizeBranchNameForPath: vi.fn(),
  sendMessage: vi.fn(),
  svgIcons: { alert: "<svg></svg>" }
}));

import { recordRecentAction } from "../../web/contextMenu";
import { showErrorDialog, showFormDialog } from "../../web/dialogs";
import { showFetchDialog, showPullDialog, validatePullOptions } from "../../web/refMenu";
import { sendMessage } from "../../web/utils";

const REPO = "/test/repo";

function setDialogDefaults(dialogDefaults: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).viewState = { dialogDefaults };
}

function checkboxInput(id: string, checked = false): string {
  return `<input id="${id}" type="checkbox"${checked ? " checked" : ""} />`;
}

describe("advanced Fetch dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three checkboxes and uses configured defaults", () => {
    setDialogDefaults({
      fetchRemote: { force: true, prune: true, pruneTags: true }
    });

    showFetchDialog(REPO);

    expect(showFormDialog).toHaveBeenCalledTimes(1);
    const [message, inputs, actionName] = vi.mocked(showFormDialog).mock.calls[0];
    expect(message).toBe("Are you sure you want to fetch from all remotes?");
    expect(inputs.map((input) => input.name)).toEqual(["Force", "Prune", "Prune tags"]);
    expect(inputs.map((input) => (input.type === "checkbox" ? input.value : null))).toEqual([
      true,
      true,
      true
    ]);
    expect(actionName).toBe("Yes, fetch");
  });

  it("falls back to all false when defaults are absent or unsafe", () => {
    setDialogDefaults({
      fetchRemote: { force: "yes", prune: 1 }
    });

    showFetchDialog(REPO);

    const inputs = vi.mocked(showFormDialog).mock.calls[0][1];
    expect(inputs.map((input) => (input.type === "checkbox" ? input.value : null))).toEqual([
      false,
      false,
      false
    ]);
  });

  it("sends normalized always-present boolean fields", () => {
    setDialogDefaults({ fetchRemote: { force: true } });
    showFetchDialog(REPO);
    const submit = vi.mocked(showFormDialog).mock.calls[0][3];

    submit(["unchecked", "checked", "checked"]);

    expect(sendMessage).toHaveBeenCalledWith({
      command: "fetch",
      repo: REPO,
      force: false,
      prune: true,
      pruneTags: true
    });
  });
});

describe("advanced Pull dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders four checkboxes and uses configured defaults", () => {
    setDialogDefaults({
      pullBranch: { noFastForward: true, squash: false, rebase: true, ignoreDate: true }
    });

    showPullDialog(REPO, "feature/x");

    expect(showFormDialog).toHaveBeenCalledTimes(1);
    const [message, inputs, actionName] = vi.mocked(showFormDialog).mock.calls[0];
    expect(message).toContain("feature/x");
    expect(inputs.map((input) => input.name)).toEqual([
      "No fast-forward",
      "Squash",
      "Rebase",
      "Ignore commit date"
    ]);
    expect(inputs.map((input) => (input.type === "checkbox" ? input.value : null))).toEqual([
      true,
      false,
      true,
      true
    ]);
    expect(actionName).toBe("Yes, pull");
  });

  it("falls back to all false when pull defaults are absent", () => {
    setDialogDefaults({});

    showPullDialog(REPO, "feature/x");

    const inputs = vi.mocked(showFormDialog).mock.calls[0][1];
    expect(inputs.map((input) => (input.type === "checkbox" ? input.value : null))).toEqual([
      false,
      false,
      false,
      false
    ]);
  });

  it("sends exact optional fields for a valid rebase selection", () => {
    setDialogDefaults({});
    showPullDialog(REPO, "feature/x");
    const submit = vi.mocked(showFormDialog).mock.calls[0][3];

    submit(["unchecked", "unchecked", "checked", "checked"]);

    expect(recordRecentAction).toHaveBeenCalledWith(REPO, "ref.pull");
    expect(sendMessage).toHaveBeenCalledWith({
      command: "pull",
      repo: REPO,
      noFastForward: false,
      squash: false,
      rebase: true,
      ignoreDate: true
    });
  });

  it("rejects multiple pull strategies before sending", () => {
    setDialogDefaults({});
    showPullDialog(REPO, "feature/x");
    const submit = vi.mocked(showFormDialog).mock.calls[0][3];

    submit(["checked", "checked", "unchecked", "unchecked"]);

    expect(showErrorDialog).toHaveBeenCalledWith(
      "Unable to Pull",
      "Select at most one of No fast-forward, Squash, or Rebase.",
      null
    );
    expect(recordRecentAction).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects ignore commit date without rebase before sending", () => {
    setDialogDefaults({});
    showPullDialog(REPO, "feature/x");
    const submit = vi.mocked(showFormDialog).mock.calls[0][3];

    submit(["unchecked", "unchecked", "unchecked", "checked"]);

    expect(showErrorDialog).toHaveBeenCalledWith(
      "Unable to Pull",
      "Ignore commit date can only be used with Rebase.",
      null
    );
    expect(recordRecentAction).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("keeps strategy selection exclusive and discloses ignore-date only with rebase", () => {
    document.body.innerHTML = [
      checkboxInput("dialogInput0", true),
      checkboxInput("dialogInput1"),
      checkboxInput("dialogInput2"),
      checkboxInput("dialogInput3")
    ].join("");
    setDialogDefaults({});
    showPullDialog(REPO, "feature/x");
    const afterCreate = vi.mocked(showFormDialog).mock.calls[0][5];
    afterCreate!(document.body);

    const noFastForward = document.getElementById("dialogInput0") as HTMLInputElement;
    const squash = document.getElementById("dialogInput1") as HTMLInputElement;
    const rebase = document.getElementById("dialogInput2") as HTMLInputElement;
    const ignoreDate = document.getElementById("dialogInput3") as HTMLInputElement;
    expect(ignoreDate.disabled).toBe(true);

    rebase.checked = true;
    rebase.dispatchEvent(new Event("change"));
    expect(noFastForward.checked).toBe(false);
    expect(ignoreDate.disabled).toBe(false);

    ignoreDate.checked = true;
    noFastForward.checked = true;
    noFastForward.dispatchEvent(new Event("change"));
    expect(rebase.checked).toBe(false);
    expect(squash.checked).toBe(false);
    expect(ignoreDate.checked).toBe(false);
    expect(ignoreDate.disabled).toBe(true);
  });
});

describe("pull option validation", () => {
  it("returns null for valid selections", () => {
    expect(
      validatePullOptions({
        noFastForward: true,
        squash: false,
        rebase: false,
        ignoreDate: false
      })
    ).toBeNull();
  });

  it("reports invalid selections without using Git tokens", () => {
    expect(
      validatePullOptions({
        noFastForward: true,
        squash: true,
        rebase: false,
        ignoreDate: false
      })
    ).toBe("Select at most one of No fast-forward, Squash, or Rebase.");
  });
});
