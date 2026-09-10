import { describe, expect, it } from "vitest";

import type { ResolvedPullRequestConfig } from "../../src/pullRequest";
import {
  buildPullRequestUrl,
  detectPullRequestProvider,
  inferPullRequestDestination,
  resolvePullRequestConfig
} from "../../src/pullRequest";

describe("inferPullRequestDestination", () => {
  it("prefers the source remote's HEAD branch when it exists", () => {
    expect(inferPullRequestDestination("trunk", ["main", "trunk", "develop"])).toBe("trunk");
  });

  it("uses the first existing safe default candidate", () => {
    expect(inferPullRequestDestination(null, ["develop", "master", "main"])).toBe("main");
    expect(inferPullRequestDestination(null, ["develop", "master"])).toBe("master");
    expect(inferPullRequestDestination(null, ["feature/one", "develop"])).toBe("develop");
    expect(inferPullRequestDestination(null, ["feature/one"])).toBeNull();
  });

  it("ignores remote HEAD and candidates that are not existing refs", () => {
    expect(inferPullRequestDestination("../missing", ["main"])).toBe("main");
    expect(inferPullRequestDestination("feature/one", ["main"])).toBe("main");
  });
});

describe("detectPullRequestProvider", () => {
  it("detects GitHub from HTTPS and SCP-style SSH URLs", () => {
    expect(detectPullRequestProvider("https://github.com/octocat/repository.git")).toBe("github");
    expect(detectPullRequestProvider("git@github.com:octocat/repository.git")).toBe("github");
  });

  it("detects GitLab and Bitbucket from HTTPS and SSH URLs", () => {
    expect(detectPullRequestProvider("https://gitlab.com/group/repository.git")).toBe("gitlab");
    expect(detectPullRequestProvider("ssh://git@gitlab.com:2222/group/repository.git")).toBe(
      "gitlab"
    );
    expect(detectPullRequestProvider("https://bitbucket.org/team/repository.git")).toBe(
      "bitbucket"
    );
    expect(detectPullRequestProvider("git@bitbucket.org:team/repository.git")).toBe("bitbucket");
  });

  it("detects self-hosted GitLab and Bitbucket hosts", () => {
    expect(detectPullRequestProvider("git@gitlab.company.test:group/repository.git")).toBe(
      "gitlab"
    );
    expect(detectPullRequestProvider("https://bitbucket.company.test/team/repository.git")).toBe(
      "bitbucket"
    );
  });

  it("returns null for unknown, malformed, and unsupported remotes", () => {
    expect(detectPullRequestProvider("https://example.invalid/team/repository.git")).toBeNull();
    expect(detectPullRequestProvider("git@example.invalid:team/repository.git")).toBeNull();
    expect(detectPullRequestProvider("ftp://github.com/octocat/repository.git")).toBeNull();
    expect(detectPullRequestProvider("https://github.com")).toBeNull();
  });
});

describe("resolvePullRequestConfig", () => {
  it("normalizes built-in provider settings and derives owner and repository", () => {
    expect(
      resolvePullRequestConfig({
        remoteName: " origin ",
        remoteUrl: "git@github.com:octocat/repository.git",
        provider: "github"
      })
    ).toEqual({
      provider: "github",
      sourceRemoteName: "origin",
      sourceOwner: "octocat",
      sourceRepo: "repository",
      hostRootUrl: "https://github.com"
    });
  });

  it("normalizes and validates an optional destination branch", () => {
    expect(
      resolvePullRequestConfig({
        remoteName: "origin",
        remoteUrl: "git@github.com:octocat/repository.git",
        provider: "github",
        destinationBranch: " release "
      })
    ).toEqual({
      provider: "github",
      sourceRemoteName: "origin",
      sourceOwner: "octocat",
      sourceRepo: "repository",
      hostRootUrl: "https://github.com",
      destinationBranch: "release"
    });

    expect(() =>
      resolvePullRequestConfig({
        remoteName: "origin",
        remoteUrl: "git@github.com:octocat/repository.git",
        provider: "github",
        destinationBranch: " release"
      })
    ).toThrow();
  });

  it("preserves GitLab subgroups and uses an explicit host root", () => {
    const config = resolvePullRequestConfig({
      remoteName: "origin",
      remoteUrl: "ssh://git@gitlab.example.test:2222/group/subgroup/repository.git",
      provider: "gitlab",
      hostRootUrl: "https://gitlab.example.test/"
    });

    expect(config.sourceOwner).toBe("group/subgroup");
    expect(config.sourceRepo).toBe("repository");
    expect(config.hostRootUrl).toBe("https://gitlab.example.test");
  });

  it("requires and normalizes a custom template", () => {
    const config = resolvePullRequestConfig({
      remoteName: "origin",
      remoteUrl: "git@example.invalid:team/repository.git",
      provider: "custom",
      customName: " Internal ",
      customTemplateUrl: "https://example.invalid/create?branch={sourceBranch}"
    });

    expect(config).toEqual({
      provider: "custom",
      sourceRemoteName: "origin",
      sourceOwner: "team",
      sourceRepo: "repository",
      hostRootUrl: "https://example.invalid",
      customName: "Internal",
      customTemplateUrl: "https://example.invalid/create?branch={sourceBranch}"
    });
  });

  it("rejects invalid provider configurations", () => {
    const remoteUrl = "git@github.com:octocat/repository.git";
    expect(() =>
      resolvePullRequestConfig({ remoteName: "", remoteUrl, provider: "github" })
    ).toThrow();
    expect(() =>
      resolvePullRequestConfig({ remoteName: "origin", remoteUrl: "", provider: "github" })
    ).toThrow();
    expect(() =>
      resolvePullRequestConfig({
        remoteName: "origin",
        remoteUrl,
        provider: "custom" as ResolvedPullRequestConfig["provider"]
      })
    ).toThrow("requires customTemplateUrl");
    expect(() =>
      resolvePullRequestConfig({
        remoteName: "origin",
        remoteUrl,
        provider: "github",
        customTemplateUrl: "https://example.invalid/create"
      })
    ).toThrow("only valid for the custom provider");
    expect(() =>
      resolvePullRequestConfig({
        remoteName: "origin",
        remoteUrl,
        provider: "github",
        hostRootUrl: "javascript:alert(1)"
      })
    ).toThrow();
  });
});

describe("buildPullRequestUrl", () => {
  const baseConfig = resolvePullRequestConfig({
    remoteName: "origin",
    remoteUrl: "git@github.com:octocat/repository.git",
    provider: "github"
  });

  it("builds GitHub comparison URLs", () => {
    expect(buildPullRequestUrl(baseConfig, "feature/one")).toBe(
      "https://github.com/octocat/repository/compare/feature%2Fone?expand=1"
    );
    expect(buildPullRequestUrl(baseConfig, "feature/one", { targetBranch: "main" })).toBe(
      "https://github.com/octocat/repository/compare/feature%2Fone...main?expand=1"
    );
  });

  it("uses the resolved destination branch by default", () => {
    const config = resolvePullRequestConfig({
      remoteName: "origin",
      remoteUrl: "git@github.com:octocat/repository.git",
      provider: "github",
      destinationBranch: "main"
    });

    expect(buildPullRequestUrl(config, "feature/one")).toBe(
      "https://github.com/octocat/repository/compare/feature%2Fone...main?expand=1"
    );
  });

  it("builds GitLab merge-request URLs", () => {
    const config = resolvePullRequestConfig({
      remoteName: "origin",
      remoteUrl: "https://gitlab.com/group/subgroup/repository.git",
      provider: "gitlab"
    });

    expect(buildPullRequestUrl(config, "feature/one", { targetBranch: "main" })).toBe(
      "https://gitlab.com/group/subgroup/repository/-/merge_requests/new" +
        "?merge_request%5Bsource_branch%5D=feature%2Fone" +
        "&merge_request%5Btarget_branch%5D=main"
    );
  });

  it("builds Bitbucket pull-request URLs", () => {
    const config = resolvePullRequestConfig({
      remoteName: "origin",
      remoteUrl: "https://bitbucket.org/team/repository.git",
      provider: "bitbucket"
    });

    expect(buildPullRequestUrl(config, "feature/one", { targetBranch: "main" })).toBe(
      "https://bitbucket.org/team/repository/pull-requests/new" +
        "?source=feature%2Fone&dest=team%2Frepository%3Amain"
    );
  });

  it("substitutes custom template branches without allowing URL injection", () => {
    const config = resolvePullRequestConfig({
      remoteName: "origin",
      remoteUrl: "git@example.invalid:team/repository.git",
      provider: "custom",
      customTemplateUrl: "https://example.invalid/create?from={source}&to={targetBranch}"
    });

    expect(buildPullRequestUrl(config, "feature/one", { targetBranch: "main" })).toBe(
      "https://example.invalid/create?from=feature%2Fone&to=main"
    );
  });

  it("rejects missing repository data and unsafe branch input", () => {
    const emptyConfig: ResolvedPullRequestConfig = {
      ...baseConfig,
      sourceOwner: "",
      sourceRepo: ""
    };
    expect(() => buildPullRequestUrl(emptyConfig, "feature/one")).toThrow("could not be derived");
    expect(() => buildPullRequestUrl(baseConfig, "")).toThrow("non-empty");
    expect(() => buildPullRequestUrl(baseConfig, " release")).toThrow("whitespace");
    expect(() => buildPullRequestUrl(baseConfig, "release..v1")).toThrow("unsafe");
    expect(() => buildPullRequestUrl(baseConfig, "release?x", { targetBranch: "main" })).toThrow(
      "unsafe"
    );
    expect(() => buildPullRequestUrl(baseConfig, "release", { targetBranch: "" })).toThrow(
      "non-empty"
    );
  });
});
