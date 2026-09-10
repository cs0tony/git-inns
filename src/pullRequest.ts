export type PullRequestProviderKind = "github" | "gitlab" | "bitbucket" | "custom";

export interface ResolvedPullRequestConfig {
  provider: PullRequestProviderKind;
  sourceRemoteName: string;
  sourceOwner: string;
  sourceRepo: string;
  hostRootUrl: string;
  destinationBranch?: string;
  customName?: string;
  customTemplateUrl?: string;
}

export interface PullRequestConfigInput {
  remoteName: string;
  remoteUrl: string;
  provider: PullRequestProviderKind;
  hostRootUrl?: string;
  destinationBranch?: string;
  customName?: string;
  customTemplateUrl?: string;
}

export interface BuildPullRequestUrlOptions {
  targetBranch?: string;
}

type RemoteEndpoint = {
  host: string;
  hostRootUrl: string;
  path: string;
};

const PROVIDER_HOST_PATTERNS: ReadonlyArray<{
  kind: Exclude<PullRequestProviderKind, "custom">;
  pattern: RegExp;
}> = [
  { kind: "github", pattern: /(^|\.)github\.com$/ },
  { kind: "gitlab", pattern: /(^|\.)gitlab\./ },
  { kind: "bitbucket", pattern: /(^|\.)bitbucket\./ }
];

const DEFAULT_DESTINATION_CANDIDATES = ["main", "master", "develop", "trunk"] as const;

/** Infer an existing destination branch, preferring the source remote's HEAD. */
export function inferPullRequestDestination(
  remoteHead: string | null,
  existingBranches: readonly string[]
): string | null {
  const branches = existingBranches.filter(isSafePullRequestBranch);

  if (remoteHead !== null && branches.includes(remoteHead)) {
    return remoteHead;
  }

  return DEFAULT_DESTINATION_CANDIDATES.find((candidate) => branches.includes(candidate)) ?? null;
}

/** Whether a value can be used safely as a generated pull-request branch parameter. */
export function isSafePullRequestBranch(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }

  try {
    assertSafeBranch(value, "branch");
    return true;
  } catch {
    return false;
  }
}

/** Detect a supported provider from an HTTPS or SSH Git remote URL. */
export function detectPullRequestProvider(remoteUrl: string): PullRequestProviderKind | null {
  let endpoint: RemoteEndpoint;

  try {
    endpoint = parseRemoteEndpoint(remoteUrl);
  } catch {
    return null;
  }

  const hasRepositoryPath = endpoint.path
    .replace(/\.git$/u, "")
    .split("/")
    .some((segment) => segment !== "");
  const provider = PROVIDER_HOST_PATTERNS.find(({ pattern }) => pattern.test(endpoint.host));

  return provider === undefined || !hasRepositoryPath ? null : provider.kind;
}

/** Validate and normalize a pull-request provider configuration. */
export function resolvePullRequestConfig(input: PullRequestConfigInput): ResolvedPullRequestConfig {
  const remoteName = requireText(input.remoteName, "remoteName");
  requireText(input.remoteUrl, "remoteUrl");
  const provider = requireProvider(input.provider);
  const customName = optionalText(input.customName, "customName");
  const customTemplateUrl = optionalText(input.customTemplateUrl, "customTemplateUrl");
  let destinationBranch: string | undefined;
  if (input.destinationBranch !== undefined) {
    destinationBranch = requireText(input.destinationBranch, "destinationBranch");
    if (
      // A symmetric whitespace envelope is normalized away; one-sided whitespace
      // is ambiguous user input and is rejected before it reaches Git or a URL.
      input.destinationBranch !== destinationBranch &&
      !(input.destinationBranch.startsWith(" ") && input.destinationBranch.endsWith(" "))
    ) {
      throw new Error("destinationBranch must be a non-empty branch name without whitespace");
    }
    assertSafeBranch(destinationBranch, "destinationBranch");
  }

  if (provider === "custom" && customTemplateUrl === undefined) {
    throw new Error("A custom pull-request provider requires customTemplateUrl");
  }

  if (provider !== "custom" && (customName !== undefined || customTemplateUrl !== undefined)) {
    throw new Error("Custom pull-request settings are only valid for the custom provider");
  }

  if (customTemplateUrl !== undefined) {
    normalizeHttpUrl(customTemplateUrl, "customTemplateUrl");
  }

  const endpoint = parseRemoteEndpoint(input.remoteUrl);
  const hostRootUrl =
    input.hostRootUrl === undefined
      ? endpoint.hostRootUrl
      : normalizeHttpUrl(input.hostRootUrl, "hostRootUrl");
  const { owner, repo } = deriveOwnerAndRepo(endpoint);

  const baseConfig = {
    provider,
    sourceRemoteName: remoteName,
    sourceOwner: owner,
    sourceRepo: repo,
    hostRootUrl,
    ...(destinationBranch === undefined ? {} : { destinationBranch })
  };

  return {
    ...baseConfig,
    ...(customName === undefined ? {} : { customName }),
    ...(customTemplateUrl === undefined ? {} : { customTemplateUrl })
  };
}

/** Build a browser URL that starts the pull-request creation flow. */
export function buildPullRequestUrl(
  config: ResolvedPullRequestConfig,
  sourceBranch: string,
  options: BuildPullRequestUrlOptions = {}
): string {
  assertSafeBranch(sourceBranch, "sourceBranch");
  const targetBranch = options.targetBranch ?? config.destinationBranch;

  if (targetBranch !== undefined) {
    assertSafeBranch(targetBranch, "targetBranch");
  }

  if (config.provider === "custom") {
    if (config.customTemplateUrl === undefined) {
      throw new Error("Custom pull-request configuration is missing customTemplateUrl");
    }

    return buildCustomPullRequestUrl(config.customTemplateUrl, sourceBranch, targetBranch);
  }

  requireRepository(config);

  if (config.provider === "github") {
    const comparison =
      targetBranch === undefined
        ? encodeURIComponent(sourceBranch)
        : `${encodeURIComponent(sourceBranch)}...${encodeURIComponent(targetBranch)}`;
    const url = new URL(
      `${hostRootPath(config)}/${encodePath(config.sourceOwner)}/${encodePath(config.sourceRepo)}/compare/${comparison}`
    );
    url.searchParams.set("expand", "1");
    return url.toString();
  }

  if (config.provider === "gitlab") {
    const projectPath = `${encodePath(config.sourceOwner)}/${encodePath(config.sourceRepo)}`;
    const url = new URL(`${hostRootPath(config)}/${projectPath}/-/merge_requests/new`);
    url.searchParams.set("merge_request[source_branch]", sourceBranch);

    if (targetBranch !== undefined) {
      url.searchParams.set("merge_request[target_branch]", targetBranch);
    }

    return url.toString();
  }

  const url = new URL(
    `${hostRootPath(config)}/${encodePath(config.sourceOwner)}/${encodePath(config.sourceRepo)}/pull-requests/new`
  );
  url.searchParams.set("source", sourceBranch);

  if (targetBranch !== undefined) {
    url.searchParams.set("dest", `${config.sourceOwner}/${config.sourceRepo}:${targetBranch}`);
  }

  return url.toString().replace(/\/+$/u, "");
}

function parseRemoteEndpoint(remoteUrl: string): RemoteEndpoint {
  const trimmedUrl = requireText(remoteUrl, "remoteUrl");

  if (containsControlCharacters(trimmedUrl)) {
    throw new Error("remoteUrl must not contain control characters");
  }

  if (trimmedUrl.startsWith("https://", 0)) {
    let url: URL;

    try {
      url = new URL(trimmedUrl);
    } catch {
      throw new Error("remoteUrl must be a valid HTTPS or SSH remote URL");
    }

    return endpointFromUrl(url);
  }

  if (trimmedUrl.startsWith("ssh://")) {
    let url: URL;

    try {
      // ssh is a non-special URL scheme, so parsing it as HTTPS gives consistent host and port handling.
      url = new URL(`https://${trimmedUrl.slice("ssh://".length)}`);
    } catch {
      throw new Error("remoteUrl must be a valid HTTPS or SSH remote URL");
    }

    return endpointFromUrl(url);
  }

  const scpUrl = /^(?:[^@/\s]+@)?([A-Za-z0-9._-]+):([^/].*)$/u.exec(trimmedUrl);
  if (scpUrl === null) {
    throw new Error("remoteUrl must be an HTTPS or SSH remote URL");
  }

  const host = scpUrl[1]!.toLowerCase();
  return {
    host,
    hostRootUrl: `https://${host}`,
    path: scpUrl[2]!
  };
}

function endpointFromUrl(url: URL): RemoteEndpoint {
  if (url.hostname === "" || (url.username !== "" && url.password !== "")) {
    throw new Error("remoteUrl must include a valid remote host");
  }

  const hostRootUrl = normalizeHttpUrl(url.origin, "remoteUrl");
  return {
    host: url.hostname.toLowerCase(),
    hostRootUrl,
    path: url.pathname
  };
}

function deriveOwnerAndRepo(endpoint: RemoteEndpoint): { owner: string; repo: string } {
  const segments = endpoint.path
    .replace(/\.git$/u, "")
    .split("/")
    .filter((segment) => segment !== "");

  if (segments.length < 2) {
    return { owner: "", repo: "" };
  }

  return {
    owner: segments.slice(0, -1).join("/"),
    repo: segments.at(-1)!
  };
}

function requireProvider(provider: PullRequestProviderKind): PullRequestProviderKind {
  if (
    provider !== "github" &&
    provider !== "gitlab" &&
    provider !== "bitbucket" &&
    provider !== "custom"
  ) {
    throw new Error("provider must be github, gitlab, bitbucket, or custom");
  }

  return provider;
}

function requireText(value: string, field: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue === "" || containsControlCharacters(trimmedValue)) {
    throw new Error(`${field} must be non-empty text`);
  }

  return trimmedValue;
}

function optionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireText(value, field);
}

function normalizeHttpUrl(value: string, field: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTP or HTTPS URL`);
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") {
    throw new Error(`${field} must be an absolute HTTP or HTTPS URL`);
  }

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  while (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString().replace(/\/+$/u, "");
}

function hostRootPath(config: ResolvedPullRequestConfig): string {
  return config.hostRootUrl.replace(/\/+$/u, "");
}

function requireRepository(config: ResolvedPullRequestConfig): void {
  if (config.sourceOwner === "" || config.sourceRepo === "") {
    throw new Error("The source owner and repository could not be derived from remoteUrl");
  }
}

function assertSafeBranch(branch: string, field: string): void {
  if (
    branch === "" ||
    branch.trim() !== branch ||
    /\s/u.test(branch) ||
    containsControlCharacters(branch)
  ) {
    throw new Error(`${field} must be a non-empty branch name without whitespace`);
  }

  if (
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("//") ||
    branch.startsWith(".") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith("@") ||
    branch.endsWith(".lock") ||
    /[~^:?*[\]\\]/u.test(branch)
  ) {
    throw new Error(
      `${field} contains characters or patterns that are unsafe in a Git branch name`
    );
  }
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codeUnit = character.codePointAt(0)!;

    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }

  return false;
}

function encodePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildCustomPullRequestUrl(
  templateUrl: string,
  sourceBranch: string,
  targetBranch: string | undefined
): string {
  const encodedSourceBranch = encodeURIComponent(sourceBranch);
  const encodedTargetBranch = targetBranch === undefined ? null : encodeURIComponent(targetBranch);
  let targetTokenSeen = false;
  const substitutedTemplate = templateUrl.replace(
    /\{(sourceBranch|targetBranch|source_branch|target_branch|source|target)\}/gu,
    (_match: string, token: string) => {
      if (token.startsWith("target")) {
        targetTokenSeen = true;

        if (encodedTargetBranch === null) {
          throw new Error("The custom template requires targetBranch to replace its target token");
        }

        return encodedTargetBranch;
      }

      return encodedSourceBranch;
    }
  );

  if (targetTokenSeen && targetBranch === undefined) {
    throw new Error("The custom template requires targetBranch to replace its target token");
  }

  let url: URL;

  try {
    url = new URL(substitutedTemplate);
  } catch {
    throw new Error("The substituted custom template is not a valid absolute URL");
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") {
    throw new Error("The custom template must be an absolute HTTP or HTTPS URL");
  }

  return url.toString();
}
