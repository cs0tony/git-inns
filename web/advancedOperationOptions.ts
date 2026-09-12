export interface TagOptions {
  annotated: boolean;
  pushToRemote: boolean;
}

export interface BranchOptions {
  checkOut: boolean;
  forceDelete: boolean;
}

export interface FetchOptions {
  force: boolean;
  prune: boolean;
  pruneTags: boolean;
}

export interface PullOptions {
  noFastForward: boolean;
  squash: boolean;
  rebase: boolean;
  ignoreDate: boolean;
}

export interface StashOptions {
  reinstateIndex: boolean;
  includeUntracked: boolean;
}

export interface OperationOptionMap {
  tag: TagOptions;
  branch: BranchOptions;
  fetch: FetchOptions;
  pull: PullOptions;
  stash: StashOptions;
}

interface BooleanOptionMetadata<T extends object> {
  field: keyof T & string;
  default: boolean;
  token: string;
}

const TAG_OPTION_METADATA = [
  { field: "annotated", default: true, token: "--annotated" },
  { field: "pushToRemote", default: false, token: "--push" }
] as const satisfies readonly BooleanOptionMetadata<TagOptions>[];

const BRANCH_OPTION_METADATA = [
  { field: "checkOut", default: true, token: "--checkout" },
  { field: "forceDelete", default: false, token: "--force-delete" }
] as const satisfies readonly BooleanOptionMetadata<BranchOptions>[];

const FETCH_OPTION_METADATA = [
  { field: "force", default: false, token: "--force" },
  { field: "prune", default: false, token: "--prune" },
  { field: "pruneTags", default: false, token: "--prune-tags" }
] as const satisfies readonly BooleanOptionMetadata<FetchOptions>[];

const PULL_OPTION_METADATA = [
  { field: "noFastForward", default: false, token: "--no-ff" },
  { field: "squash", default: false, token: "--squash" },
  { field: "rebase", default: false, token: "--rebase" },
  { field: "ignoreDate", default: false, token: "--ignore-date" }
] as const satisfies readonly BooleanOptionMetadata<PullOptions>[];

const STASH_OPTION_METADATA = [
  { field: "reinstateIndex", default: false, token: "--index" },
  { field: "includeUntracked", default: false, token: "--include-untracked" }
] as const satisfies readonly BooleanOptionMetadata<StashOptions>[];

function normalizeBooleanOptions<T extends object>(
  metadata: readonly BooleanOptionMetadata<T>[],
  value: unknown
): T {
  const input = isRecord(value) ? value : {};
  const result = {} as Record<keyof T & string, boolean>;

  for (const { field, default: defaultValue } of metadata) {
    result[field] = typeof input[field] === "boolean" ? input[field]! : defaultValue;
  }

  return result as T;
}

function toTokens<T extends object>(
  metadata: readonly BooleanOptionMetadata<T>[],
  options: T
): string[] {
  return metadata.filter(({ field }) => options[field]).map(({ token }) => token);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const OPTION_NORMALIZERS = {
  tag: (value: unknown): TagOptions => normalizeBooleanOptions(TAG_OPTION_METADATA, value),
  branch: (value: unknown): BranchOptions => normalizeBooleanOptions(BRANCH_OPTION_METADATA, value),
  fetch: (value: unknown): FetchOptions => normalizeBooleanOptions(FETCH_OPTION_METADATA, value),
  pull: (value: unknown): PullOptions => normalizeBooleanOptions(PULL_OPTION_METADATA, value),
  stash: (value: unknown): StashOptions => normalizeBooleanOptions(STASH_OPTION_METADATA, value)
} satisfies {
  [K in keyof OperationOptionMap]: (value: unknown) => OperationOptionMap[K];
};

const ARGUMENT_TOKEN_BUILDERS = {
  tag: (options: TagOptions): string[] => toTokens(TAG_OPTION_METADATA, options),
  branch: (options: BranchOptions): string[] => toTokens(BRANCH_OPTION_METADATA, options),
  fetch: (options: FetchOptions): string[] => toTokens(FETCH_OPTION_METADATA, options),
  pull: (options: PullOptions): string[] => toTokens(PULL_OPTION_METADATA, options),
  stash: (options: StashOptions): string[] => toTokens(STASH_OPTION_METADATA, options)
} satisfies {
  [K in keyof OperationOptionMap]: (options: OperationOptionMap[K]) => string[];
};

export function normalizeAdvancedOperationOptions<K extends keyof OperationOptionMap>(
  kind: K,
  value: unknown
): OperationOptionMap[K] {
  return (OPTION_NORMALIZERS[kind] as (value: unknown) => OperationOptionMap[K])(value);
}

export function toGitArgumentTokens<K extends keyof OperationOptionMap>(
  kind: K,
  options: OperationOptionMap[K]
): string[] {
  return (ARGUMENT_TOKEN_BUILDERS[kind] as (options: OperationOptionMap[K]) => string[])(options);
}
