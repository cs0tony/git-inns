/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";

import webMessagesEn from "../../l10n/web/web.l10n.en.json";
import {
  openRepoSettings,
  type RepoSettingsAction,
  type RepoSettingsData
} from "../../web/repoSettings";

globalThis.webviewMessages = webMessagesEn;

function createData(overrides: Partial<RepoSettingsData> = {}): RepoSettingsData {
  return {
    repositoryName: "Git Keizu",
    repositoryPath: "/workspace/git-keizu",
    remotes: [
      {
        name: "origin",
        url: "https://github.com/example/git-keizu.git",
        pushUrl: "git@example.com:example/git-keizu.git"
      }
    ],
    issueLinks: {
      enabled: true,
      regex: "#(\\d+)",
      urlTemplate: "https://github.com/example/git-keizu/issues/{0}"
    },
    pullRequest: null,
    ...overrides
  };
}

function findLabel(labelText: string): HTMLLabelElement {
  const label = Array.from(document.querySelectorAll("label")).find(
    (candidate) => candidate.textContent?.trim() === labelText
  );
  expect(label).toBeInstanceOf(HTMLLabelElement);
  return label as HTMLLabelElement;
}

function findField(labelText: string): HTMLInputElement {
  const label = findLabel(labelText);
  const input = document.getElementById(label.htmlFor);
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function fieldError(labelText: string): HTMLElement {
  const label = findLabel(labelText);
  const error = document.getElementById(`${label.htmlFor}-error`);
  expect(error).not.toBeNull();
  return error as HTMLElement;
}

function labelledButton(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

describe("repository settings panel", () => {
  let actions: RepoSettingsAction[];

  beforeEach(() => {
    actions = [];
    document.body.innerHTML = "";
  });

  function render(overrides: Partial<RepoSettingsData> = {}): void {
    const container = document.createElement("div");
    document.body.appendChild(container);
    openRepoSettings(container, createData(overrides), (action) => {
      actions.push(action);
    });
  }

  it("renders repository details, remote controls, form fields, and future sections", () => {
    render();
    const panel = document.querySelector(".repo-settings");

    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("dialog");
    expect(panel!.getAttribute("aria-modal")).toBe("false");
    expect(panel!.getAttribute("aria-labelledby")).toBe(
      document.querySelector(".repo-settings h2")!.id
    );
    expect(document.querySelector(".repo-settings h2")!.textContent).toContain("Git Keizu");
    expect(document.querySelector(".repo-settings-description")!.textContent).toBe(
      "/workspace/git-keizu"
    );

    const remoteList = document.querySelector(".repo-settings-remote-list");
    expect(remoteList!.getAttribute("aria-label")).toBe("Configured remotes");
    expect(document.querySelector(".repo-settings-remote-name")!.textContent).toBe("origin");
    expect(document.querySelector(".repo-settings-remote-url")!.textContent).toBe(
      "https://github.com/example/git-keizu.git → git@example.com:example/git-keizu.git"
    );
    expect(labelledButton("Edit remote origin").textContent).toBe("Edit");
    expect(labelledButton("Delete remote origin").textContent).toBe("Delete");
    expect(labelledButton("Fetch remote origin").textContent).toBe("Fetch");
    expect(labelledButton("Fetch and prune remote origin").textContent).toBe("Fetch prune");
    expect(labelledButton("Fetch and prune tags for remote origin").textContent).toBe("Prune tags");
    expect(labelledButton("Close repository settings").textContent).toBe("Close");

    expect(findLabel("Remote name").textContent).toBe("Remote name");
    expect(findLabel("URL").textContent).toBe("URL");
    expect(findLabel("Push URL (optional)").textContent).toBe("Push URL (optional)");
    expect(findLabel("Issue regex").textContent).toBe("Issue regex");
    expect(findLabel("Issue URL template").textContent).toBe("Issue URL template");
    expect(
      document.getElementById("repo-settings-1-issue-template")!.getAttribute("placeholder")
    ).toContain("{0}");

    const sectionTitles = Array.from(document.querySelectorAll(".repo-settings-section h3")).map(
      (title) => title.textContent
    );
    expect(sectionTitles).toEqual([
      "Remotes",
      "Issue links",
      "Pull request providers",
      "Configuration export"
    ]);
    expect(document.body.textContent).toContain(
      "Choose a provider and source remote. Pull Request creation opens a pre-filled comparison in your browser."
    );
    expect(document.body.textContent).toContain(
      "Sharing repository settings is not available yet."
    );
  });

  it("shows a clear empty state when no remotes exist", () => {
    render({ remotes: [] });

    const emptyState = document.querySelector(".repo-settings-empty");
    expect(emptyState!.textContent).toBe("No remotes are configured.");
    expect(document.querySelector(".repo-settings-remote")).toBeNull();
  });

  it("dispatches a valid add remote action and resets the form", () => {
    render();

    findField("Remote name").value = "upstream";
    findField("URL").value = "git@example.com:example/upstream.git";
    findField("Push URL (optional)").value = "";
    document.querySelector<HTMLFormElement>(".repo-settings-form")!.requestSubmit();

    expect(actions).toEqual([
      {
        type: "addRemote",
        name: "upstream",
        url: "git@example.com:example/upstream.git"
      }
    ]);
    expect(findField("Remote name").value).toBe("");
    expect(findField("URL").value).toBe("");
    expect(document.querySelector("[data-testid='remote-form-title']")!.textContent).toBe(
      "Add a remote"
    );
  });

  it("validates remote name and URL and links visible errors to inputs", () => {
    render({ remotes: [] });

    findField("Remote name").value = "bad name";
    findField("URL").value = "not a url";
    document.querySelector<HTMLFormElement>(".repo-settings-form")!.requestSubmit();

    const nameLabel = findLabel("Remote name");
    const urlLabel = findLabel("URL");
    const nameInput = findField("Remote name");
    const urlInput = findField("URL");

    expect(actions).toHaveLength(0);
    expect(fieldError("Remote name").textContent).toContain("Use letters, numbers, dots");
    expect(fieldError("URL").textContent).toContain("Enter a valid");
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput.getAttribute("aria-describedby")).toBe(`${nameLabel.htmlFor}-error`);
    expect(urlInput.getAttribute("aria-invalid")).toBe("true");
    expect(urlInput.getAttribute("aria-describedby")).toBe(`${urlLabel.htmlFor}-error`);
  });

  it("prevents a duplicate remote name when adding", () => {
    render();

    findField("Remote name").value = "origin";
    findField("URL").value = "https://example.com/another.git";
    document.querySelector<HTMLFormElement>(".repo-settings-form")!.requestSubmit();

    expect(actions).toHaveLength(0);
    expect(fieldError("Remote name").textContent).toBe("A remote with this name already exists.");
  });

  it("edits an existing remote and preserves the original remote name in the action", () => {
    render();

    labelledButton("Edit remote origin").click();
    expect(findField("Remote name").value).toBe("origin");
    expect(findField("URL").value).toBe("https://github.com/example/git-keizu.git");
    expect(findField("Push URL (optional)").value).toBe("git@example.com:example/git-keizu.git");
    expect(document.querySelector("[data-testid='remote-form-title']")!.textContent).toBe(
      "Edit remote origin"
    );

    findField("Remote name").value = "github";
    findField("URL").value = "https://example.com/git-keizu.git";
    findField("Push URL (optional)").value = "";
    document.querySelector<HTMLFormElement>(".repo-settings-form")!.requestSubmit();

    expect(actions).toEqual([
      {
        type: "editRemote",
        originalName: "origin",
        name: "github",
        url: "https://example.com/git-keizu.git",
        pushUrl: "https://example.com/git-keizu.git"
      }
    ]);
    expect(document.querySelector("[data-testid='remote-form-title']")!.textContent).toBe(
      "Add a remote"
    );
  });

  it("dispatches destructive and fetch actions using the remote's accessible identity", () => {
    render();

    labelledButton("Delete remote origin").click();
    labelledButton("Fetch remote origin").click();
    labelledButton("Fetch and prune remote origin").click();
    labelledButton("Fetch and prune tags for remote origin").click();

    expect(actions).toEqual([
      { type: "deleteRemote", name: "origin" },
      { type: "fetchRemote", name: "origin" },
      { type: "fetchPruneRemote", name: "origin" },
      { type: "pruneTagsRemote", name: "origin" }
    ]);
  });

  it("validates enabled issue links before saving", () => {
    render();

    findField("Issue regex").value = "[invalid";
    findField("Issue URL template").value = "https://example.com/issues";
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Save issue link settings")!
      .click();

    expect(actions).toHaveLength(0);
    expect(fieldError("Issue regex").textContent).toContain("Invalid regex:");
    expect(fieldError("Issue URL template").textContent).toContain("{0}");
    expect(findField("Issue regex").getAttribute("aria-describedby")).toBe(
      `${findLabel("Issue regex").htmlFor}-error`
    );
    expect(findField("Issue URL template").getAttribute("aria-describedby")).toBe(
      `${findLabel("Issue URL template").htmlFor}-error`
    );
  });

  it("saves valid issue link settings and permits empty values when disabled", () => {
    render();

    findField("Issue regex").value = "[invalid";
    findField("Issue URL template").value = "https://example.com/issues";
    findField("Issue URL template")
      .closest(".repo-settings-form")!
      .querySelector<HTMLInputElement>("input[type='checkbox']")!.checked = false;
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Save issue link settings")!
      .click();

    expect(actions).toEqual([
      {
        type: "saveIssueLinks",
        settings: {
          enabled: false,
          regex: "[invalid",
          urlTemplate: "https://example.com/issues"
        }
      }
    ]);
    expect(fieldError("Issue regex").textContent).toBe("");
    expect(fieldError("Issue URL template").textContent).toBe("");

    findField("Issue URL template").value = "https://example.com/issues/{issue}";
    findField("Issue regex").value = "#(\\d+)";
    document.querySelector<HTMLInputElement>("input[type='checkbox']")!.checked = true;
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Save issue link settings")!
      .click();
    expect(actions.at(-1)).toEqual({
      type: "saveIssueLinks",
      settings: {
        enabled: true,
        regex: "#(\\d+)",
        urlTemplate: "https://example.com/issues/{issue}"
      }
    });
  });

  it("closes with Escape or the close button and restores focus", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open settings";
    document.body.appendChild(trigger);
    trigger.focus();

    render();
    const panel = document.querySelector<HTMLElement>(".repo-settings")!;
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).toBe(panel);

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);

    panel.hidden = false;
    labelledButton("Close repository settings").click();
    expect(panel.hidden).toBe(true);
  });
});
