export interface HostViewPreferences {
  readonly retainContextWhenHidden: boolean;
  readonly openToActiveEditorRepository: boolean;
  readonly integratedTerminalShell: string;
}

export const DEFAULT_HOST_VIEW_PREFERENCES: HostViewPreferences = {
  integratedTerminalShell: "",
  openToActiveEditorRepository: false,
  retainContextWhenHidden: true
};

export type RegisteredRepositories = readonly string[] | Readonly<Record<string, unknown>>;

type HostViewPreferencesInput = Partial<Record<keyof HostViewPreferences, unknown>>;

interface NormalizedPath {
  readonly segments: readonly string[];
  readonly caseInsensitive: boolean;
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const WINDOWS_ABSOLUTE_PATTERN = /^[a-z]:[\\/]/i;

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeHostViewPreferences(value: unknown): HostViewPreferences {
  const candidate =
    typeof value === "object" && value !== null ? (value as HostViewPreferencesInput) : {};
  const shell =
    typeof candidate.integratedTerminalShell === "string"
      ? candidate.integratedTerminalShell.trim()
      : "";
  return {
    integratedTerminalShell: shell === "" || CONTROL_CHARACTER_PATTERN.test(shell) ? "" : shell,
    openToActiveEditorRepository: booleanOrDefault(
      candidate.openToActiveEditorRepository,
      DEFAULT_HOST_VIEW_PREFERENCES.openToActiveEditorRepository
    ),
    retainContextWhenHidden: booleanOrDefault(
      candidate.retainContextWhenHidden,
      DEFAULT_HOST_VIEW_PREFERENCES.retainContextWhenHidden
    )
  };
}

function isSafePath(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !CONTROL_CHARACTER_PATTERN.test(value);
}

function normalizePath(value: string): NormalizedPath | null {
  const windowsSeparator = WINDOWS_ABSOLUTE_PATTERN.test(value) || value.startsWith("\\\\");
  const posixAbsolute = value.startsWith("/");
  const windowsPlatform = process.platform === "win32";

  if (!posixAbsolute && !windowsSeparator && !windowsPlatform) {
    return null;
  }

  const normalized = windowsSeparator || windowsPlatform ? value.split("\\").join("/") : value;
  const rawSegments = normalized.split("/");
  const segments: string[] = [];

  for (const segment of rawSegments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return null;
  }

  return {
    caseInsensitive: windowsSeparator || windowsPlatform,
    segments: segments.map((segment) => (windowsSeparator ? segment.toLowerCase() : segment))
  };
}

function* getRepositoryPaths(repositories: RegisteredRepositories): Generator<string> {
  if (Array.isArray(repositories)) {
    for (const repository of repositories) {
      if (isSafePath(repository)) {
        yield repository;
      }
    }
    return;
  }

  for (const repository of Object.keys(repositories)) {
    if (isSafePath(repository)) {
      yield repository;
    }
  }
}

function containsPath(filePath: readonly string[], repositoryPath: readonly string[]): boolean {
  if (filePath.length < repositoryPath.length) {
    return false;
  }

  return repositoryPath.every((segment, index) => segment === filePath[index]);
}

export function findRepositoryForFilePath(
  repositories: RegisteredRepositories,
  filePath: unknown
): string | null {
  if (!isSafePath(filePath)) {
    return null;
  }

  const normalizedFilePath = normalizePath(filePath);
  if (normalizedFilePath === null) {
    return null;
  }

  let best: { path: string; length: number } | null = null;

  for (const repository of getRepositoryPaths(repositories)) {
    const normalizedRepository = normalizePath(repository);
    if (
      normalizedRepository === null ||
      normalizedRepository.caseInsensitive !== normalizedFilePath.caseInsensitive ||
      !containsPath(normalizedFilePath.segments, normalizedRepository.segments)
    ) {
      continue;
    }

    if (
      best === null ||
      normalizedRepository.segments.length > best.length ||
      (normalizedRepository.segments.length === best.length && repository < best.path)
    )
      best = { length: normalizedRepository.segments.length, path: repository };
  }

  return best?.path ?? null;
}
