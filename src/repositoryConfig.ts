export interface ShareableIssueLinks {
  enabled: boolean;
  regex: string;
  urlTemplate: string;
}

export interface ShareablePullRequestConfig {
  provider: "github" | "gitlab" | "bitbucket" | "custom";
  sourceRemote: string;
  customName?: string;
  customTemplateUrl?: string;
}

export interface RepositoryConfigFile {
  version: 1;
  issueLinks?: ShareableIssueLinks;
  pullRequest?: ShareablePullRequestConfig;
}

type RecordValue = Record<string, unknown>;

const ROOT_FIELDS = new Set(["issueLinks", "pullRequest", "version"]);
const ISSUE_LINK_FIELDS = new Set(["enabled", "regex", "urlTemplate"]);
const PULL_REQUEST_FIELDS = new Set([
  "customName",
  "customTemplateUrl",
  "provider",
  "sourceRemote"
]);
const PULL_REQUEST_PROVIDERS = new Set(["bitbucket", "custom", "github", "gitlab"]);

export function exportRepositoryConfig(input: RepositoryConfigFile): string {
  const error = validateRepositoryConfig(input);
  if (error !== null) {
    throw new Error(error);
  }

  return `${canonicalJson(input)}\n`;
}

export function parseRepositoryConfig(
  raw: string
): { kind: "ok"; data: RepositoryConfigFile } | { kind: "error"; error: string } {
  if (typeof raw !== "string") {
    return { kind: "error", error: "Repository configuration must be JSON text" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      kind: "error",
      error: `Invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`
    };
  }

  const validationError = validateRepositoryConfig(value);
  if (validationError !== null) {
    return { kind: "error", error: validationError };
  }

  return { kind: "ok", data: value as RepositoryConfigFile };
}

function validateRepositoryConfig(value: unknown): string | null {
  if (!isObject(value)) {
    return "Repository configuration must be a JSON object";
  }

  const unknownField = findUnknownField(value, ROOT_FIELDS);
  if (unknownField !== null) {
    return `Unknown field: ${unknownField}`;
  }
  if (!hasOwnField(value, "version")) {
    return "Missing required field: version";
  }
  if (value.version !== 1) {
    return "version must be exactly 1";
  }

  if (hasOwnField(value, "issueLinks")) {
    const error = validateIssueLinks(value.issueLinks);
    if (error !== null) {
      return error;
    }
  }

  if (hasOwnField(value, "pullRequest")) {
    const error = validatePullRequest(value.pullRequest);
    if (error !== null) {
      return error;
    }
  }

  return null;
}

function validateIssueLinks(value: unknown): string | null {
  if (!isObject(value)) {
    return "issueLinks must be an object";
  }

  const unknownField = findUnknownField(value, ISSUE_LINK_FIELDS);
  if (unknownField !== null) {
    return `Unknown field: issueLinks.${unknownField}`;
  }

  const requiredFields: Array<keyof ShareableIssueLinks> = ["enabled", "regex", "urlTemplate"];
  for (const field of requiredFields) {
    if (!hasOwnField(value, field)) {
      return `Missing required field: issueLinks.${field}`;
    }
  }

  if (typeof value.enabled !== "boolean") {
    return "issueLinks.enabled must be a boolean";
  }
  if (typeof value.regex !== "string" || containsControlCharacter(value.regex)) {
    return "issueLinks.regex must be a string without control characters";
  }

  try {
    new RegExp(value.regex, "gu");
  } catch {
    return "issueLinks.regex must be a valid regular expression";
  }

  return validateHttpUrl(value.urlTemplate, "issueLinks.urlTemplate");
}

function validatePullRequest(value: unknown): string | null {
  if (!isObject(value)) {
    return "pullRequest must be an object";
  }

  const unknownField = findUnknownField(value, PULL_REQUEST_FIELDS);
  if (unknownField !== null) {
    return `Unknown field: pullRequest.${unknownField}`;
  }

  const requiredFields: Array<keyof ShareablePullRequestConfig> = ["provider", "sourceRemote"];
  for (const field of requiredFields) {
    if (!hasOwnField(value, field)) {
      return `Missing required field: pullRequest.${field}`;
    }
  }

  const { provider } = value;
  if (typeof provider !== "string" || !PULL_REQUEST_PROVIDERS.has(provider)) {
    return "pullRequest.provider must be github, gitlab, bitbucket, or custom";
  }
  if (typeof value.sourceRemote !== "string" || !isValidRemoteName(value.sourceRemote)) {
    return "pullRequest.sourceRemote must be a valid remote name";
  }

  const hasCustomName = hasOwnField(value, "customName");
  const hasCustomTemplateUrl = hasOwnField(value, "customTemplateUrl");
  if (provider === "custom") {
    if (
      !hasCustomName ||
      typeof value.customName !== "string" ||
      !isValidDisplayName(value.customName)
    ) {
      return "pullRequest.customName must be a non-empty string without control characters";
    }
    if (!hasCustomTemplateUrl) {
      return "Missing required field: pullRequest.customTemplateUrl";
    }
    return validateHttpUrl(value.customTemplateUrl, "pullRequest.customTemplateUrl");
  }

  if (hasCustomName || hasCustomTemplateUrl) {
    return "customName and customTemplateUrl are only allowed when provider is custom";
  }

  return null;
}

function validateHttpUrl(value: unknown, label: string): string | null {
  if (typeof value !== "string" || containsControlCharacter(value) || containsTraversal(value)) {
    return `${label} must be a valid http(s) URL`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label} must be a valid http(s) URL`;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `${label} must be a valid http(s) URL`;
  }

  return null;
}

function isValidRemoteName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== "." && value !== "..";
}

function isValidDisplayName(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.trim() &&
    !containsControlCharacter(value) &&
    !value.includes("\\") &&
    !containsTraversal(value)
  );
}

function containsControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value);
}

function containsTraversal(value: string): boolean {
  return /(?:^|\/)\.\.(?:\/|$)/.test(value);
}

function findUnknownField(value: RecordValue, knownFields: Set<string>): string | null {
  for (const field of Object.keys(value)) {
    if (!knownFields.has(field)) {
      return field;
    }
  }

  return null;
}

function hasOwnField(value: RecordValue, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function isObject(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue: unknown) => {
      if (!isObject(nestedValue)) {
        return nestedValue;
      }

      return Object.keys(nestedValue)
        .sort()
        .reduce<RecordValue>((sorted, field) => {
          sorted[field] = nestedValue[field];
          return sorted;
        }, {});
    },
    2
  );
}
