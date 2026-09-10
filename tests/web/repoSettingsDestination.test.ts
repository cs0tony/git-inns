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

function createData(): RepoSettingsData {
  return {
    repositoryName: "repo",
    repositoryPath: "/workspace/repo",
    remotes: [{ name: "origin", url: "https://github.com/example/repo.git" }],
    issueLinks: { enabled: false, regex: "", urlTemplate: "" },
    pullRequest: {
      provider: "github",
      sourceRemoteName: "origin",
      sourceOwner: "example",
      sourceRepo: "repo",
      hostRootUrl: "https://github.com",
      destinationBranch: "main"
    },
    pullRequestDestination: {
      branches: ["feature/one", "main", "release"],
      defaultBranch: "main",
      selectedBranch: "release"
    },
    user: {
      name: { effectiveValue: "Test User", source: "local", localValue: "Test User", globalValue: null },
      email: {
        effectiveValue: "test@example.com",
        source: "local",
        localValue: "test@example.com",
        globalValue: null
      }
    }
  };
}

describe("repository settings pull-request destinations", () => {
  let actions: RepoSettingsAction[];

  beforeEach(() => {
    actions = [];
    document.body.innerHTML = "";
  });

  function render(): void {
    const container = document.createElement("div");
    document.body.appendChild(container);
    openRepoSettings(container, createData(), (action) => actions.push(action));
  }

  it("labels the existing-branch destination and identifies the inferred default", () => {
    render();

    const select = document.getElementById("repo-settings-1-pull-destination");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select!.getAttribute("aria-invalid")).toBeNull();
    const label = Array.from(document.querySelectorAll("label")).find(
      (candidate) => candidate.htmlFor === select!.id
    );
    expect(label!.textContent).toBe("Destination branch");
    expect(document.getElementById(`${select!.id}-hint`)!.textContent).toBe(
      "Inferred default: main"
    );
    expect(select!.getAttribute("aria-describedby")).toBe(
      `${select!.id}-hint ${select!.id}-error`
    );
    expect(select!.value).toBe("release");
    expect([...select!.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "feature/one",
      "main (inferred default)",
      "release"
    ]);
  });

  it("saves a selected existing destination and validates unexpected input", () => {
    render();
    const select = document.getElementById("repo-settings-1-pull-destination") as HTMLSelectElement;
    select.value = "feature/one";
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Save pull request provider")!
      .click();

    expect(actions).toEqual([
      {
        type: "savePullRequest",
        settings: {
          provider: "github",
          remoteName: "origin",
          destinationBranch: "feature/one"
        }
      }
    ]);
    expect(select.getAttribute("aria-invalid")).toBeNull();

    const maliciousData = createData();
    maliciousData.pullRequestDestination!.branches.push("bad branch");
    maliciousData.pullRequestDestination!.selectedBranch = "bad branch";
    const container = document.createElement("div");
    document.body.appendChild(container);
    openRepoSettings(container, maliciousData, (action) => actions.push(action));
    const maliciousSelect = document.getElementById(
      "repo-settings-2-pull-destination"
    ) as HTMLSelectElement;
    maliciousSelect.value = "bad branch";
    maliciousSelect.closest("form")!.requestSubmit();

    expect(actions).toHaveLength(1);
    expect(maliciousSelect.getAttribute("aria-invalid")).toBe("true");
    expect(maliciousSelect.getAttribute("aria-describedby")).toContain(
      "repo-settings-2-pull-destination-error"
    );
  });
});
