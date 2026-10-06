import * as cp from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real Git subprocesses need more than the 5s default under parallel load.
vi.setConfig({ testTimeout: 30_000 });
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
import type {
  RepositorySettingsIssueLinks,
  RepositorySettingsUserScope,
  RepositoryVisibility
} from "../../src/types";

const DEFAULT_VISIBILITY: RepositoryVisibility = {
  showTags: true,
  showStashes: true,
  showRemoteHeads: true,
  showUntrackedFiles: true
};

const INVALID_DESTINATION_MESSAGE = "Invalid pull-request destination branch.";

/**
 * Git subprocesses on Windows can keep file handles alive briefly after the
 * awaited command settles, which makes an immediate recursive delete fail
 * with EBUSY/EPERM; retry for a short window before giving up.
 */
async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= 5 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

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
  home: string;
  repo: string;
  origin: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-keizu-settings-"));
  const home = path.join(root, "home");
  const repo = path.join(root, "repository");
  const origin = path.join(root, "origin.git");

  await fs.mkdir(home, { recursive: true });
  git(root, ["init", "--bare", "-b", "main", origin]);
  git(root, ["init", "-b", "main", repo]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["commit", "--allow-empty", "-m", "first"]);

  return { root, home, repo, origin };
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
    getRepositoryVisibility: vi.fn(() => DEFAULT_VISIBILITY),
    saveRepositoryVisibility: vi.fn(),
    getRepositorySettingsIssueLinks: vi.fn(
      (repo: string) => storedIssueLinks[repo] ?? { enabled: false, regex: "", urlTemplate: "" }
    ),
    getRepositoryPullRequest: vi.fn(() => null),
    saveRepositoryPullRequest: vi.fn(async () => null),
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
    vi.stubEnv("HOME", fixture.home);
    vi.stubEnv("XDG_CONFIG_HOME", path.join(fixture.home, ".config"));
    git(fixture.repo, ["remote", "add", "upstream", "https://example.com/upstream.git"]);
  });

  afterEach(async () => {
    await removeTempDir(fixture.root);
    vi.restoreAllMocks();
  });

  function expectedUser(nameLocal: string | null, emailLocal: string | null) {
    const scope: RepositorySettingsUserScope =
      nameLocal === null || emailLocal === null ? "global" : "local";
    return {
      name: {
        effectiveValue: nameLocal ?? "Global User",
        source: scope,
        localValue: nameLocal,
        globalValue: nameLocal === null ? "Global User" : null
      },
      email: {
        effectiveValue: emailLocal ?? "global@example.com",
        source: scope,
        localValue: emailLocal,
        globalValue: emailLocal === null ? "global@example.com" : null
      }
    };
  }

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
        visibility: DEFAULT_VISIBILITY,
        pullRequest: null,
        user: expectedUser("Test User", "test@example.com")
      }
    });
  });

  it("reads user details separately from local and global configuration", async () => {
    git(fixture.repo, ["config", "--unset", "user.name"]);
    git(fixture.repo, ["config", "--unset", "user.email"]);
    git(fixture.repo, ["config", "--global", "user.name", "Global User"]);
    git(fixture.repo, ["config", "--global", "user.email", "global@example.com"]);
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);

    const result = await dataSource.getRepositorySettings(fixture.repo);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.user).toEqual(expectedUser(null, null));
  });

  it("validates and saves user details in the selected scope", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "saveUserDetails",
        scope: "local",
        name: "",
        email: "local@example.com"
      })
    ).toBe("User name and email are required.");
    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "saveUserDetails",
        scope: "local",
        name: "Local User",
        email: "local\n@example.com"
      })
    ).toBe("User details contain invalid control characters.");
    expect(git(fixture.repo, ["config", "--local", "--get", "user.name"])).toBe("Test User");

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "saveUserDetails",
        scope: "local",
        name: "Local User",
        email: "local@example.com"
      })
    ).toBeNull();
    expect(git(fixture.repo, ["config", "--local", "user.name"])).toBe("Local User");
    expect(git(fixture.repo, ["config", "--local", "user.email"])).toBe("local@example.com");
  });

  it("writes global user details before removing overriding local values", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);
    git(fixture.repo, ["config", "--unset", "user.name"]);
    git(fixture.repo, ["config", "--global", "user.name", "Global User"]);
    git(fixture.repo, ["config", "--global", "user.email", "global@example.com"]);

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "saveUserDetails",
        scope: "global",
        name: "Updated Global User",
        email: "updated-global@example.com"
      })
    ).toBeNull();

    expect(git(fixture.repo, ["config", "--global", "user.name"])).toBe("Updated Global User");
    expect(git(fixture.repo, ["config", "--global", "user.email"])).toBe(
      "updated-global@example.com"
    );
    expect(
      cp.spawnSync("git", ["config", "--local", "user.name"], {
        cwd: fixture.repo,
        encoding: "utf8"
      }).status
    ).not.toBe(0);
    expect(
      cp.spawnSync("git", ["config", "--local", "user.email"], {
        cwd: fixture.repo,
        encoding: "utf8"
      }).status
    ).not.toBe(0);
  });

  it("removes user details only from the selected scope", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);
    git(fixture.repo, ["config", "--global", "user.name", "Global User"]);
    git(fixture.repo, ["config", "--global", "user.email", "global@example.com"]);
    git(fixture.repo, ["config", "--unset", "user.email"]);

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "removeUserDetails",
        scope: "local"
      })
    ).toBeNull();
    expect(git(fixture.repo, ["config", "--global", "user.name"])).toBe("Global User");
    expect(
      cp.spawnSync("git", ["config", "--local", "user.name"], {
        cwd: fixture.repo,
        encoding: "utf8"
      }).status
    ).not.toBe(0);

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "removeUserDetails",
        scope: "global"
      })
    ).toBeNull();
    expect(
      cp.spawnSync("git", ["config", "--global", "user.name"], {
        cwd: fixture.repo,
        encoding: "utf8"
      }).status
    ).not.toBe(0);
  });

  it("infers a destination from source remote HEAD before defaults", async () => {
    git(fixture.repo, ["push", "origin", "main:main"]);
    git(fixture.repo, ["fetch", "origin"]);
    git(fixture.repo, ["remote", "set-url", "origin", "https://github.com/example/origin.git"]);
    git(fixture.repo, ["branch", "trunk"]);
    git(fixture.repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);

    const result = await dataSource.getRepositorySettings(fixture.repo);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.pullRequestDestination).toEqual({
      branches: expect.arrayContaining(["main", "trunk"]),
      defaultBranch: "main",
      selectedBranch: null
    });
    expect(result.data.pullRequest).toMatchObject({ destinationBranch: "main" });
  });

  it("falls back to an existing default destination branch", async () => {
    git(fixture.repo, ["remote", "set-url", "origin", "https://github.com/example/origin.git"]);
    git(fixture.repo, ["branch", "develop"]);
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);

    const result = await dataSource.getRepositorySettings(fixture.repo);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.pullRequestDestination).toEqual({
      branches: expect.arrayContaining(["develop", "main"]),
      defaultBranch: "main",
      selectedBranch: null
    });
  });

  it("validates the selected destination before persisting pull-request settings", async () => {
    const { extensionState } = createExtensionState();
    const dataSource = new DataSource(extensionState as ExtensionState);

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "savePullRequest",
        settings: {
          provider: "github",
          remoteName: "origin",
          destinationBranch: "missing"
        }
      })
    ).toBe(INVALID_DESTINATION_MESSAGE);
    expect(extensionState.saveRepositoryPullRequest).not.toHaveBeenCalled();

    expect(
      await dataSource.repositorySettingsAction(fixture.repo, {
        type: "savePullRequest",
        settings: {
          provider: "github",
          remoteName: "origin",
          destinationBranch: "main"
        }
      })
    ).toBeNull();
    expect(extensionState.saveRepositoryPullRequest).toHaveBeenCalledWith(
      fixture.repo,
      fixture.origin,
      {
        provider: "github",
        remoteName: "origin",
        destinationBranch: "main"
      }
    );
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
