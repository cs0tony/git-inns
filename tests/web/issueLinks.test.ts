import { describe, expect, it } from "vitest";

import type { RepositorySettingsIssueLinks } from "../../src/types";
import { compileIssueLinkRegex, renderCommitBodyIssueLinks } from "../../web/issueLinks";

function issueLinkTitle(issueId: string): string {
  return `Open issue ${issueId}`;
}

function settings(overrides: Partial<RepositorySettingsIssueLinks> = {}) {
  return {
    enabled: true,
    regex: "#(\\d+)",
    urlTemplate: "https://example.test/issues/{0}",
    ...overrides
  };
}

describe("compileIssueLinkRegex", () => {
  it("creates a global Unicode regex for valid patterns", () => {
    const regex = compileIssueLinkRegex("#(\\d+)");

    expect(regex).not.toBeNull();
    expect(regex?.flags).toBe("gu");
  });

  it("rejects empty and invalid patterns", () => {
    expect(compileIssueLinkRegex("")).toBeNull();
    expect(compileIssueLinkRegex("[")).toBeNull();
  });
});

describe("renderCommitBodyIssueLinks", () => {
  it("renders escaped plain text when issue links are disabled", () => {
    const body = 'Fix #42 <img src=x onerror="alert(1)">';

    expect(renderCommitBodyIssueLinks(body, settings({ enabled: false }), issueLinkTitle)).toBe(
      "Fix #42 &lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  it("uses capture group 1 when the regex captures an issue id", () => {
    expect(renderCommitBodyIssueLinks("Fix #42 and #7", settings(), issueLinkTitle)).toBe(
      'Fix <a href="https://example.test/issues/42" target="_blank" rel="noopener noreferrer" ' +
        'title="Open issue 42">#42</a> and ' +
        '<a href="https://example.test/issues/7" target="_blank" rel="noopener noreferrer" ' +
        'title="Open issue 7">#7</a>'
    );
  });

  it("uses the entire match when the regex has no capture group", () => {
    const result = renderCommitBodyIssueLinks(
      "Fix #42",
      settings({ regex: "#\\d+" }),
      issueLinkTitle
    );

    expect(result).toContain('href="https://example.test/issues/%2342"');
    expect(result).toContain('">#42</a>');
  });

  it("replaces every {0} placeholder with an encoded issue id", () => {
    const result = renderCommitBodyIssueLinks(
      "Fix #1&2",
      settings({
        regex: "#([^\\s]+)",
        urlTemplate: "https://example.test/{0}?from={0}"
      }),
      issueLinkTitle
    );

    expect(result).toContain('href="https://example.test/1%262?from=1%262"');
  });

  it("escapes body text, issue ids, and safe template values", () => {
    const result = renderCommitBodyIssueLinks(
      "Issue #<b>1</b>",
      settings({ regex: "#(.+)" }),
      issueLinkTitle
    );

    expect(result).toContain("Issue ");
    expect(result).toContain('">#&lt;b&gt;1&lt;&#x2F;b&gt;</a>');
    expect(result).not.toContain("<b>");
    expect(result).not.toContain("</b>");
  });

  it("falls back to plain text for a template without a safe http(s) URL", () => {
    const body = "Fix #42";

    expect(
      renderCommitBodyIssueLinks(
        body,
        settings({ urlTemplate: 'javascript:alert("{0}")' }),
        issueLinkTitle
      )
    ).toBe(body);
    expect(
      renderCommitBodyIssueLinks(
        body,
        settings({ urlTemplate: "https://example.test/no-placeholder" }),
        issueLinkTitle
      )
    ).toBe(body);
  });

  it("renders escaped plain text when the regex is invalid", () => {
    const body = "Fix #42 <script>alert(1)</script>";

    expect(renderCommitBodyIssueLinks(body, settings({ regex: "[" }), issueLinkTitle)).toBe(
      "Fix #42 &lt;script&gt;alert(1)&lt;&#x2F;script&gt;"
    );
  });

  it("preserves newlines as line breaks around links", () => {
    const result = renderCommitBodyIssueLinks("Fix #1\nSee #2", settings(), issueLinkTitle);

    expect(result).toContain("</a><br>See ");
    expect(result).not.toContain("\n");
  });
});
