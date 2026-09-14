export interface CustomPullRequestProvider {
  name: string;
  templateUrl: string;
}

const PROVIDER_NAME_MAX_LENGTH = 80;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

const CASE_INSENSITIVE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

function isSameProviderName(left: string, right: string): boolean {
  return CASE_INSENSITIVE_COLLATOR.compare(left, right) === 0;
}

type UnknownRecord = Record<string, unknown>;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? Number.NaN;

    if ((codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }

  return false;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > PROVIDER_NAME_MAX_LENGTH ||
    containsControlCharacter(name)
  ) {
    return null;
  }

  return name;
}

function normalizeTemplateUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const templateUrl = value.trim();
  if (templateUrl.length === 0 || containsControlCharacter(templateUrl)) {
    return null;
  }

  try {
    const url = new URL(templateUrl);
    if (
      !ALLOWED_URL_PROTOCOLS.has(url.protocol) ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
  } catch {
    return null;
  }

  // Keep the caller's template text so query, hash, and substitution
  // placeholders remain available to the pull request URL builder.
  return templateUrl;
}

export function normalizeCustomPullRequestProviders(value: unknown): CustomPullRequestProvider[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const providers: CustomPullRequestProvider[] = [];
  const seenNames = new Set<string>();

  for (const entry of value) {
    const candidate = asRecord(entry);
    if (candidate === null) {
      continue;
    }

    const name = normalizeName(candidate.name);
    const templateUrl = normalizeTemplateUrl(candidate.templateUrl);
    if (name === null || templateUrl === null) {
      continue;
    }

    const lookupName = name.toLocaleLowerCase();
    if (seenNames.has(lookupName)) {
      continue;
    }

    seenNames.add(lookupName);
    providers.push({ name, templateUrl });
  }

  return providers;
}

export function findCustomPullRequestProvider(
  providers: readonly CustomPullRequestProvider[],
  name: string
): CustomPullRequestProvider | null {
  if (typeof name !== "string") {
    return null;
  }

  const searchName = name.trim();
  if (searchName.length === 0) {
    return null;
  }

  const provider = providers.find((candidate) => isSameProviderName(candidate.name, searchName));

  return provider ?? null;
}

export function sortCustomPullRequestProviders(
  providers: readonly CustomPullRequestProvider[]
): CustomPullRequestProvider[] {
  return [...providers].sort((left, right) =>
    CASE_INSENSITIVE_COLLATOR.compare(left.name, right.name)
  );
}
