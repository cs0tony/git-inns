import * as cp from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Memento } from "vscode";

vi.mock("vscode", () => ({}));

vi.mock("../../src/config", () => ({
  getConfig: vi.fn(() => ({
    gitPath: () => ["git"],
    dateType: () => "Author Date",
    showUncommittedChanges: () => false,
    fetchAndPruneTags: () => false,
    includeCommitsMentionedByReflogs: () => false,
    onlyFollowFirstParent: () => false,
    useMailmap: () => false,
    showSignatureStatus: () => false
  }))
}));

import { DataSource } from "../../src/dataSource";
import type { ExtensionState } from "../../src/extensionState";
import type { RepositorySettingsIssueLinks } from "../../src/types";

function git(cwd: string, args: string[]): string {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function refExists(repo: string, ref: string): boolean {
  return (
    cp.spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd: repo,
      encoding: "utf8"
    }).status === 0
  );
}

interface Fixture {
  root: string;
  repo: string;
  origin: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-keizu-settings-"));
  const repo = path.join(root, "repository");
  const origin = path.join(root, "origin.git");

  git(root, ["init", "--bare", "-b", "main", origin]);
  git(root, ["init", "-b", "main", repo]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["commit", "--allow-empty", "-m", "first"]);

  return { root, repo, origin };
}

function createExtensionState(issueLinks?: Record<string, RepositorySettingsIssueLinks>) {
  const updates: unknown[] = [];
  const storedIssueLinks: Record<string, RepositorySettingsIssueLinks> = issueLinks ?? {};
  const workspaceState = {
    get: vi.fn((_key: string, fallback: unknown) => storedIssueLinks ?? fallback),
    update: vi.fn((_key: string, value: unknown) => {
      updates.push(value);
      return Promise.resolve();
    })
  } as unknown as Memento;
  const extensionState = {
    getRepositorySettingsIssueLinks: vi.fn(
      (repo: string) => storedIssueLinks[repo] ?? { enabled: false, regex: "", urlTemplate: "" }
    ),
    getRepositoryPullRequest: vi.fn(() => null),
    saveRepositorySettingsIssueLinks: vi.fn((repo: string, settings: unknown) => {
      storedIssueLinks[repo] = settings as RepositorySettingsIssueLinks;
      void workspaceState.update("repositorySettingsIssueLinks", storedIssueLinks);
    })
  } as unknown as ExtensionState;

  return { extensionState, updates, workspaceState };
}

async function pushRemoteBranchAndTag(fixture: Fixture, label: string): Promise<void> {
  const branchName = `${label}-branch`;
  const tagName = `${label}-tag`;
  git(fixture.repo, ["commit", "--allow-empty", "-m", label]);
  git(fixture.repo, ["branch", branchName]);
  git(fixture.repo, ["tag", tagName]);
  git(fixture.repo, ["push", "origin", `${branchName}:${branchName}`]);
  git(fixture.repo, ["push", "origin", tagName]);
}

describe("DataSource repository settings", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
    git(fixture.repo, ["remote", "add", "upstream", "https://example.com/upstream.git"]);
  });

  afterEach(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("parses fetch and push URLs and omits unsafe remote names", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);
    git(fixture.repo, ["config", "remote.origin.pushurl", "git@example.com:example/push.git"]);
    git(fixture.repo, ["config", "--add", "safe.directory", "*"]);
    git(fixture.repo, ["config", "remote.unsafe-name", "https://example.com/unsafe.git"]);

    const result = await dataSource.getRepositorySettings(fixture.repo);

    expect(result).toEqual({
      kind: "ok",
      data: {
        repositoryName: "repository",
        repositoryPath: fixture.repo,
        remotes: [
          {
            name: "origin",
            url: fixture.origin,
            pushUrl: "git@example.com:example/push.git"
          },
          { name: "upstream", url: "https://example.com/upstream.git" }
        ],
        issueLinks: { enabled: false, regex: "", urlTemplate: "" },
        pullRequest: null
      }
    });
  });

  it("persists and returns issue-link settings in workspace state", async () => {
    const { extensionState, workspaceState, updates } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);
    const settings = {
      enabled: true,
      regex: "#(\\d+)",
      urlTemplate: "https://example.com/issues/{0}"
    };

    await dataSource.saveRepositorySettingsIssueLinks(fixture.repo, settings);
    const stored = updates.at(-1) as Record<string, RepositorySettingsIssueLinks>;
    expect(workspaceState.update).toHaveBeenCalledWith(
      "repositorySettingsIssueLinks",
      expect.anything()
    );
    expect(stored[fixture.repo]).toEqual(settings);

    (workspaceState.get as ReturnType<typeof vi.fn>).mockReturnValue({
      [fixture.repo]: settings
    });
    const result = await dataSource.getRepositorySettings(fixture.repo);
    expect(result.kind === "ok" && result.data.issueLinks).toEqual(settings);
  });

  it("validates remote names and URLs before changing Git configuration", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);

    expect(await dataSource.addRemote(fixture.repo, "-bad", "https://example.com/x.git")).toBe(
      "Invalid remote name."
    );
    expect(await dataSource.addRemote(fixture.repo, "bad", "has whitespace")).toBe(
      "Invalid remote URL."
    );
    expect(git(fixture.repo, ["remote"])).not.toContain("-bad");

    expect(
      await dataSource.addRemote(fixture.repo, "new", "https://example.com/new.git")
    ).toBeNull();
    expect(git(fixture.repo, ["remote", "get-url", "new"])).toBe("https://example.com/new.git");

    expect(
      await dataSource.editRemote(
        fixture.repo,
        "new",
        "renamed",
        "https://example.com/renamed.git",
        "git@example.com:example/renamed.git"
      )
    ).toBeNull();
    expect(git(fixture.repo, ["remote", "get-url", "renamed"])).toBe(
      "https://example.com/renamed.git"
    );
    expect(git(fixture.repo, ["remote", "get-url", "--push", "renamed"])).toBe(
      "git@example.com:example/renamed.git"
    );
    expect(
      await dataSource.editRemote(
        fixture.repo,
        "renamed",
        "renamed",
        "https://example.com/renamed.git",
        "https://example.com/renamed.git"
      )
    ).toBeNull();
    expect(git(fixture.repo, ["remote", "get-url", "--push", "renamed"])).toBe(
      "https://example.com/renamed.git"
    );

    expect(await dataSource.deleteRemote(fixture.repo, "renamed")).toBeNull();
    expect(git(fixture.repo, ["remote"])).not.toContain("renamed");
  });

  it("fetches a remote and prunes branches and tags on request", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);
    await pushRemoteBranchAndTag(fixture, "removed");
    await dataSource.fetchRemote(fixture.repo, "origin");

    git(fixture.origin, ["branch", "-D", "removed-branch"]);
    git(fixture.origin, ["tag", "-d", "removed-tag"]);
    await dataSource.fetchRemote(fixture.repo, "origin");

    expect(refExists(fixture.repo, "refs/remotes/origin/removed-branch")).toBe(true);

    await dataSource.fetchPruneRemote(fixture.repo, "origin");
    expect(refExists(fixture.repo, "refs/remotes/origin/removed-branch")).toBe(false);
    expect(refExists(fixture.repo, "refs/tags/removed-tag")).toBe(true);

    await dataSource.pruneTagsRemote(fixture.repo, "origin");
    expect(refExists(fixture.repo, "refs/tags/removed-tag")).toBe(false);
  });
});
