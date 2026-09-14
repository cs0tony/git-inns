import { describe, expect, it } from "vitest";

import type { CustomPullRequestProvider } from "../../src/pullRequestProviders";
import {
  findCustomPullRequestProvider,
  normalizeCustomPullRequestProviders,
  sortCustomPullRequestProviders
} from "../../src/pullRequestProviders";

describe("normalizeCustomPullRequestProviders", () => {
  it("normalizes valid providers and preserves URL query and hash data", () => {
    const value = [
      {
        name: "  Team GitLab  ",
        templateUrl:
          "https://gitlab.example.com/groups/project/-/merge_requests/new?merge_request[title]=Fix&anchor=commit"
      }
    ];

    expect(normalizeCustomPullRequestProviders(value)).toEqual([
      {
        name: "Team GitLab",
        templateUrl:
          "https://gitlab.example.com/groups/project/-/merge_requests/new?merge_request[title]=Fix&anchor=commit"
      }
    ] satisfies CustomPullRequestProvider[]);
  });

  it("rejects malformed collections and invalid entries without throwing", () => {
    const value = [
      null,
      { name: "", templateUrl: "https://example.test/repo" },
      { name: "   ", templateUrl: "https://example.test/repo" },
      { name: `${"a".repeat(81)}`, templateUrl: "https://example.test/repo" },
      { name: "Bad\u0007Name", templateUrl: "https://example.test/repo" },
      { name: "Relative", templateUrl: "/merge/requests/new" },
      { name: "FTP", templateUrl: "ftp://example.test/repo" },
      { name: "Control", templateUrl: "https://exa\u0000mple.test/repo" },
      { name: "Valid", templateUrl: "https://example.test/repo" }
    ];

    expect(normalizeCustomPullRequestProviders(value)).toEqual([
      { name: "Valid", templateUrl: "https://example.test/repo" }
    ]);
    expect(normalizeCustomPullRequestProviders("not-an-array")).toEqual([]);
  });

  it("rejects duplicate names case-insensitively and keeps the first valid entry", () => {
    const value = [
      { name: "Review", templateUrl: "https://first.example.test/repo" },
      { name: "review", templateUrl: "https://second.example.test/repo" },
      { name: "REVIEW", templateUrl: "https://third.example.test/repo" }
    ];

    expect(normalizeCustomPullRequestProviders(value)).toEqual([
      { name: "Review", templateUrl: "https://first.example.test/repo" }
    ]);
  });

  it("rejects templates containing credentials", () => {
    const value = [
      {
        name: "User",
        templateUrl: "https://user:token@example.test/repo"
      },
      {
        name: "PasswordOnly",
        templateUrl: "https://:password@example.test/repo"
      },
      {
        name: "Valid",
        templateUrl: "https://example.test/repo"
      }
    ];

    expect(normalizeCustomPullRequestProviders(value)).toEqual([
      { name: "Valid", templateUrl: "https://example.test/repo" }
    ]);
  });
});

describe("findCustomPullRequestProvider", () => {
  it("finds providers case-insensitively", () => {
    const providers = normalizeCustomPullRequestProviders([
      { name: "Review", templateUrl: "https://example.test/repo" }
    ]);

    expect(findCustomPullRequestProvider(providers, "REVIEW")).toEqual(providers[0]);
    expect(findCustomPullRequestProvider(providers, "review")).toEqual(providers[0]);
  });

  it("rejects empty names and missing providers", () => {
    const providers = normalizeCustomPullRequestProviders([
      { name: "Review", templateUrl: "https://example.test/repo" }
    ]);

    expect(findCustomPullRequestProvider(providers, "")).toBeNull();
    expect(findCustomPullRequestProvider(providers, "missing")).toBeNull();
  });
});

describe("sortCustomPullRequestProviders", () => {
  it("sorts names case-insensitively using locale-aware comparison", () => {
    const providers: CustomPullRequestProvider[] = [
      { name: "review", templateUrl: "https://a.example.test" },
      { name: "Apple", templateUrl: "https://b.example.test" },
      { name: "banana", templateUrl: "https://c.example.test" }
    ];

    expect(sortCustomPullRequestProviders(providers).map((provider) => provider.name)).toEqual([
      "Apple",
      "banana",
      "review"
    ]);
  });

  it("does not mutate the input and preserves full provider values", () => {
    const providers = normalizeCustomPullRequestProviders([
      { name: "Zebra", templateUrl: "https://example.test/zebra?from=graph#top" },
      { name: "apple", templateUrl: "https://example.test/apple?from=graph#top" }
    ]);
    const original = [...providers];

    const sorted = sortCustomPullRequestProviders(providers);

    expect(providers).toEqual(original);
    expect(sorted).not.toBe(providers);
    expect(sorted.map((provider) => provider.name)).toEqual(["apple", "Zebra"]);
    expect(sorted[1].templateUrl).toContain("?from=graph#top");
  });
});
