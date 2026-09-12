export interface RepositoryVisibility {
  showTags: boolean;
  showStashes: boolean;
  showRemoteHeads: boolean;
  showUntrackedFiles: boolean;
}

export const DEFAULT_REPOSITORY_VISIBILITY: RepositoryVisibility = {
  showTags: true,
  showStashes: true,
  showRemoteHeads: true,
  showUntrackedFiles: true
};

type RepositoryVisibilityInput = Partial<Record<keyof RepositoryVisibility, unknown>>;

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeRepositoryVisibility(value: unknown): RepositoryVisibility {
  const candidate =
    typeof value === "object" && value !== null ? (value as RepositoryVisibilityInput) : {};

  return {
    showTags: booleanOrDefault(candidate.showTags, DEFAULT_REPOSITORY_VISIBILITY.showTags),
    showStashes: booleanOrDefault(candidate.showStashes, DEFAULT_REPOSITORY_VISIBILITY.showStashes),
    showRemoteHeads: booleanOrDefault(
      candidate.showRemoteHeads,
      DEFAULT_REPOSITORY_VISIBILITY.showRemoteHeads
    ),
    showUntrackedFiles: booleanOrDefault(
      candidate.showUntrackedFiles,
      DEFAULT_REPOSITORY_VISIBILITY.showUntrackedFiles
    )
  };
}

export function appendVisibilityGitArgs(
  args: readonly string[],
  visibility: RepositoryVisibility
): string[] {
  const result = [...args];

  if (!visibility.showTags && !result.includes("--no-tags")) {
    result.push("--no-tags");
  }
  if (visibility.showStashes && !result.includes("--all")) {
    result.push("--all");
  }

  return result;
}

export function filterRemoteHeadRefs<
  T extends { name?: string; remote?: boolean; type?: string }
>(
  refs: readonly T[],
  visibility: RepositoryVisibility
): T[] {
  if (visibility.showRemoteHeads) {
    return [...refs];
  }

  return refs.filter(
    (ref) => !(ref.remote === true || (ref.type === "remote" && ref.name?.endsWith("/HEAD")))
  );
}

export function shouldIncludeUntrackedFiles(visibility: RepositoryVisibility): boolean {
  return visibility.showUntrackedFiles;
}
