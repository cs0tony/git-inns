import { describe, expect, it } from "vitest";

import {
  exportRepositoryConfig,
  parseRepositoryConfig,
  type RepositoryConfigFile
} from "../../src/repositoryConfig";

const fullConfig: RepositoryConfigFile = {
  version: 1,
  issueLinks: {
    enabled: true,
    regex: "#(\\d+)",
    urlTemplate: "https://example.com/issues/$1"
  },
  pullRequest: {
    provider: "custom",
    sourceRemote: "origin",
    destinationBranch: "main",
    customName: "Gitea",
    customTemplateUrl: "https://example.com/{owner}/{repository}/pulls/{branch}"
  }
};

const expectedFullJson = `{
  "issueLinks": {
    "enabled": true,
    "regex": "#(\\\\d+)",
    "urlTemplate": "https://example.com/issues/$1"
  },
  "pullRequest": {
    "destinationBranch": "main",
    "customName": "Gitea",
    "customTemplateUrl": "https://example.com/{owner}/{repository}/pulls/{branch}",
    "provider": "custom",
    "sourceRemote": "origin"
  },
  "version": 1
}
`;

function parseError(raw: string): string {
  const result = parseRepositoryConfig(raw);
  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    return result.error;
  }

  throw new Error("Expected a parser error");
}

describe("repository configuration sharing", () => {
  // ==========================================================================
  // exportRepositoryConfig
  // ==========================================================================
  describe("exportRepositoryConfig", () => {
    it("exports a full configuration in canonical field order", () => {
      expect(exportRepositoryConfig(fullConfig)).toBe(expectedFullJson);
    });

    it("produces stable formatting regardless of input insertion order", () => {
      const reordered = {
        version: 1,
        pullRequest: {
          destinationBranch: fullConfig.pullRequest?.destinationBranch,
          customTemplateUrl: fullConfig.pullRequest?.customTemplateUrl,
          customName: fullConfig.pullRequest?.customName,
          sourceRemote: fullConfig.pullRequest?.sourceRemote,
          provider: fullConfig.pullRequest?.provider
        },
        issueLinks: {
          urlTemplate: fullConfig.issueLinks?.urlTemplate,
          regex: fullConfig.issueLinks?.regex,
          enabled: fullConfig.issueLinks?.enabled
        }
      } satisfies RepositoryConfigFile;

      expect(exportRepositoryConfig(reordered)).toBe(expectedFullJson);
    });

    it("exports a minimal configuration with a trailing newline and omitted optionals", () => {
      expect(exportRepositoryConfig({ version: 1 })).toBe(`{
  "version": 1
}
`);
    });
  });

  // ==========================================================================
  // parseRepositoryConfig
  // ==========================================================================
  describe("parseRepositoryConfig", () => {
    it("parses valid full and minimal configurations", () => {
      expect(parseRepositoryConfig(exportRepositoryConfig(fullConfig))).toEqual({
        kind: "ok",
        data: fullConfig
      });
      expect(parseRepositoryConfig(exportRepositoryConfig({ version: 1 }))).toEqual({
        kind: "ok",
        data: { version: 1 }
      });
    });

    it("rejects malformed JSON and non-object roots with concise errors", () => {
      expect(parseError("{")).toMatch(/^Invalid JSON: /);
      expect(parseError("[]")).toBe("Repository configuration must be a JSON object");
      expect(parseError("null")).toBe("Repository configuration must be a JSON object");
    });

    it("rejects unknown fields at every object level", () => {
      expect(parseError(`{"version":1,"exportedAt":"2026-01-01"}`)).toBe(
        "Unknown field: exportedAt"
      );
      expect(
        parseError(
          `{"version":1,"issueLinks":{"enabled":false,"regex":"","urlTemplate":"https://x.test","extra":1}}`
        )
      ).toBe("Unknown field: issueLinks.extra");
      expect(
        parseError(
          `{"version":1,"pullRequest":{"provider":"github","sourceRemote":"origin","unknown":true}}`
        )
      ).toBe("Unknown field: pullRequest.unknown");
    });

    it("requires version to be exactly 1", () => {
      expect(parseError("{}")).toBe("Missing required field: version");
      expect(parseError(`{"version":2}`)).toBe("version must be exactly 1");
      expect(parseError(`{"version":"1"}`)).toBe("version must be exactly 1");
    });

    it("validates issue link fields", () => {
      expect(
        parseError(
          `{"version":1,"issueLinks":{"enabled":"yes","regex":"","urlTemplate":"https://x.test"}}`
        )
      ).toBe("issueLinks.enabled must be a boolean");
      expect(
        parseError(
          `{"version":1,"issueLinks":{"enabled":true,"regex":"[","urlTemplate":"https://x.test"}}`
        )
      ).toBe("issueLinks.regex must be a valid regular expression");
      expect(
        parseError(
          `{"version":1,"issueLinks":{"enabled":true,"regex":"","urlTemplate":"not-a-url"}}`
        )
      ).toBe("issueLinks.urlTemplate must be a valid http(s) URL");
      expect(
        parseError(
          `{"version":1,"issueLinks":{"enabled":true,"regex":"","urlTemplate":"https://x.test/a/../../b"}}`
        )
      ).toBe("issueLinks.urlTemplate must be a valid http(s) URL");
    });

    it("validates remote names and rejects traversal and control characters", () => {
      expect(
        parseError(`{"version":1,"pullRequest":{"provider":"github","sourceRemote":"../origin"}}`)
      ).toBe("pullRequest.sourceRemote must be a valid remote name");
      expect(
        parseError(`{"version":1,"pullRequest":{"provider":"github","sourceRemote":""}}`)
      ).toBe("pullRequest.sourceRemote must be a valid remote name");
      expect(
        parseError(
          `{"version":1,"pullRequest":{"provider":"custom","sourceRemote":"origin","customName":"bad\\u0000name","customTemplateUrl":"https://x.test"}}`
        )
      ).toBe("pullRequest.customName must be a non-empty string without control characters");
    });

    it("validates destination branches", () => {
      expect(
        parseError(
          `{"version":1,"pullRequest":{"provider":"github","sourceRemote":"origin","destinationBranch":"bad branch"}}`
        )
      ).toBe("pullRequest.destinationBranch contains an unsafe Git branch name");
    });

    it("enforces custom provider requirements", () => {
      expect(
        parseError(`{"version":1,"pullRequest":{"provider":"custom","sourceRemote":"origin"}}`)
      ).toBe("pullRequest.customName must be a non-empty string without control characters");
      expect(
        parseError(
          `{"version":1,"pullRequest":{"provider":"custom","sourceRemote":"origin","customName":"Gitea"}}`
        )
      ).toBe("Missing required field: pullRequest.customTemplateUrl");
      expect(
        parseError(
          `{"version":1,"pullRequest":{"provider":"github","sourceRemote":"origin","customTemplateUrl":"https://x.test"}}`
        )
      ).toBe("customName and customTemplateUrl are only allowed when provider is custom");
      expect(
        parseError(`{"version":1,"pullRequest":{"provider":"sourcehut","sourceRemote":"origin"}}`)
      ).toBe("pullRequest.provider must be github, gitlab, bitbucket, or custom");
    });
  });
});
