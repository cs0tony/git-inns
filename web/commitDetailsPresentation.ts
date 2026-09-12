export type CommitDetailsLocation = "inline" | "right";
export type CommitFileViewMode = "tree" | "list";

export interface CommitDetailsPresentationSettings {
  location: CommitDetailsLocation;
  fileViewMode: CommitFileViewMode;
  compactFolders: boolean;
  autoCenter: boolean;
}

const COMMIT_DETAILS_LOCATIONS: readonly CommitDetailsLocation[] = [
  "inline",
  "right"
];
const COMMIT_FILE_VIEW_MODES: readonly CommitFileViewMode[] = ["tree", "list"];

const DEFAULT_SETTINGS: CommitDetailsPresentationSettings = {
  location: "inline",
  fileViewMode: "tree",
  compactFolders: true,
  autoCenter: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLocation(value: unknown, fallback: unknown) {
  if (
    typeof value === "string" &&
    COMMIT_DETAILS_LOCATIONS.includes(value as CommitDetailsLocation)
  ) {
    return value as CommitDetailsLocation;
  }

  if (
    typeof fallback === "string" &&
    COMMIT_DETAILS_LOCATIONS.includes(fallback as CommitDetailsLocation)
  ) {
    return fallback as CommitDetailsLocation;
  }

  return DEFAULT_SETTINGS.location;
}

function normalizeFileViewMode(value: unknown, fallback: unknown) {
  if (
    typeof value === "string" &&
    COMMIT_FILE_VIEW_MODES.includes(value as CommitFileViewMode)
  ) {
    return value as CommitFileViewMode;
  }

  if (
    typeof fallback === "string" &&
    COMMIT_FILE_VIEW_MODES.includes(fallback as CommitFileViewMode)
  ) {
    return fallback as CommitFileViewMode;
  }

  return DEFAULT_SETTINGS.fileViewMode;
}

function normalizeFlag(value: unknown, fallback: unknown, defaultValue: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof fallback === "boolean") {
    return fallback;
  }

  return defaultValue;
}

export function normalizeCommitDetailsPresentation(
  value: unknown,
  fallback?: Partial<CommitDetailsPresentationSettings>
): CommitDetailsPresentationSettings {
  const input = isRecord(value) ? value : {};
  const fallbackInput = isRecord(fallback) ? fallback : {};

  return {
    location: normalizeLocation(input.location, fallbackInput.location),
    fileViewMode: normalizeFileViewMode(
      input.fileViewMode,
      fallbackInput.fileViewMode
    ),
    compactFolders: normalizeFlag(
      input.compactFolders,
      fallbackInput.compactFolders,
      DEFAULT_SETTINGS.compactFolders
    ),
    autoCenter: normalizeFlag(
      input.autoCenter,
      fallbackInput.autoCenter,
      DEFAULT_SETTINGS.autoCenter
    )
  };
}

export function getCommitDetailsBodyClassName(
  settings: CommitDetailsPresentationSettings
): string {
  return [
    "commitDetailsBody",
    settings.location === "right" ? "commitDetailsRight" : "",
    settings.fileViewMode === "tree"
      ? "commitDetailsFileTree"
      : "commitDetailsFileList",
    settings.compactFolders ? "commitDetailsCompactFolders" : "",
    settings.autoCenter ? "commitDetailsAutoCenter" : ""
  ]
    .filter(Boolean)
    .join(" ");
}
