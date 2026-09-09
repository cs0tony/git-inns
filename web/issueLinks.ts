import type { RepositorySettingsIssueLinks } from "../src/types";

const ISSUE_PLACEHOLDER = "{0}";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"'/]/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#x27;";
      default:
        return "&#x2F;";
    }
  });
}

function compileRegex(pattern: string): RegExp | null {
  if (pattern === "") return null;
  try {
    return new RegExp(pattern, "gu");
  } catch {
    return null;
  }
}

export function compileIssueLinkRegex(pattern: string): RegExp | null {
  return compileRegex(pattern);
}

function buildIssueHref(urlTemplate: string, issueId: string): string | null {
  if (!urlTemplate.includes(ISSUE_PLACEHOLDER)) return null;

  const issueIdSegment = encodeURIComponent(issueId);
  const candidate = urlTemplate
    .split(ISSUE_PLACEHOLDER)
    .join(issueIdSegment);
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return candidate;
}

function buildIssueAnchor(
  match: string,
  issueId: string,
  urlTemplate: string,
  getLinkTitle: (issueId: string) => string
): string | null {
  const href = buildIssueHref(urlTemplate, issueId);
  if (href === null) return null;

  const escapedTitle = escapeHtml(getLinkTitle(issueId));
  return (
    `<a href="${escapeHtml(href).replace(/&#x2F;/g, "/")}" target="_blank" ` +
    `rel="noopener noreferrer" title="${escapedTitle}">${escapeHtml(match)}</a>`
  );
}

export function renderCommitBodyIssueLinks(
  body: string,
  settings: RepositorySettingsIssueLinks,
  getLinkTitle: (issueId: string) => string
): string {
  if (!settings.enabled) {
    return escapeHtml(body).replace(/\n/g, "<br>");
  }

  const regex = compileRegex(settings.regex);
  if (regex === null) {
    return escapeHtml(body).replace(/\n/g, "<br>");
  }

  let html = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(body.slice(lastIndex, match.index));
    }

    if (match[0] === "") {
      const char = body.slice(match.index, match.index + 1);
      html += escapeHtml(char);
      lastIndex = match.index + char.length;
      regex.lastIndex = lastIndex;
      if (lastIndex >= body.length) break;
      continue;
    }

    const issueId = match[1] ?? match[0];
    const anchor = buildIssueAnchor(
      match[0],
      issueId,
      settings.urlTemplate,
      getLinkTitle
    );
    html += anchor ?? escapeHtml(match[0]);
    lastIndex = match.index + match[0].length;
    if (regex.lastIndex === match.index) {
      regex.lastIndex = lastIndex;
    }
  }

  if (lastIndex < body.length) {
    html += escapeHtml(body.slice(lastIndex));
  }
  return html.replace(/\n/g, "<br>");
}
