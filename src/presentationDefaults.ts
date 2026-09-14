export interface PresentationColumnVisibility {
  date: boolean;
  author: boolean;
  commit: boolean;
}

export const DEFAULT_PRESENTATION_COLUMN_VISIBILITY: PresentationColumnVisibility = {
  date: true,
  author: true,
  commit: true
};

type PresentationColumnVisibilityInput = Partial<
  Record<keyof PresentationColumnVisibility | "Date" | "Author" | "Commit", unknown>
>;

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function hasVisibleColumn(visibility: PresentationColumnVisibility): boolean {
  return visibility.date || visibility.author || visibility.commit;
}

export function normalizePresentationColumnVisibility(
  value: unknown
): PresentationColumnVisibility {
  const candidate =
    typeof value === "object" && value !== null ? (value as PresentationColumnVisibilityInput) : {};
  const normalized: PresentationColumnVisibility = {
    date: booleanOrDefault(candidate.date ?? candidate.Date, true),
    author: booleanOrDefault(candidate.author ?? candidate.Author, true),
    commit: booleanOrDefault(candidate.commit ?? candidate.Commit, true)
  };

  return hasVisibleColumn(normalized) ? normalized : DEFAULT_PRESENTATION_COLUMN_VISIBILITY;
}

export type RepositoryOrderingMode = "workspace-path" | "name" | "full-path";

export const DEFAULT_REPOSITORY_ORDERING_MODE: RepositoryOrderingMode = "workspace-path";

const REPOSITORY_ORDERING_MODES: readonly RepositoryOrderingMode[] = [
  DEFAULT_REPOSITORY_ORDERING_MODE,
  "name",
  "full-path"
];

export function normalizeRepositoryOrderingMode(value: unknown): RepositoryOrderingMode {
  return (
    REPOSITORY_ORDERING_MODES.find((mode) => mode === value) ?? DEFAULT_REPOSITORY_ORDERING_MODE
  );
}

export interface RepositoryOrderingEntry {
  path: string;
}

export function deriveRepositoryName(repositoryPath: string): string {
  if (repositoryPath.length === 0) {
    return "";
  }

  const pathWithoutTrailingSeparator = repositoryPath.replace(/[\\/]+$/u, "");
  const name = pathWithoutTrailingSeparator.split(/[\\/]+/u).pop();
  return name ?? "";
}

function compareLocaleCaseInsensitive(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true
  });
}

export function orderRepositories<T extends RepositoryOrderingEntry>(
  repositories: readonly T[],
  mode: RepositoryOrderingMode = DEFAULT_REPOSITORY_ORDERING_MODE
): T[] {
  return [...repositories].sort((left, right) => {
    if (mode === "name") {
      const nameComparison = compareLocaleCaseInsensitive(
        deriveRepositoryName(left.path),
        deriveRepositoryName(right.path)
      );
      if (nameComparison !== 0) {
        return nameComparison;
      }

      return compareLocaleCaseInsensitive(left.path, right.path);
    }

    return compareLocaleCaseInsensitive(left.path, right.path);
  });
}
