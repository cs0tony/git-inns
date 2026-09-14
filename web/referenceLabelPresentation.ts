import type { GitRef } from "../src/types";

export type ReferenceLabelAlignment = "description" | "graph-branches";

export interface ReferenceLabelPresentation {
  alignment: ReferenceLabelAlignment;
  combine: boolean;
}

export interface ReferenceLabel {
  accessibleName: string;
  kind: "branch" | "remote" | "tag";
  name: string;
  remotes: string[];
}

export interface GroupedReferenceLabels {
  labels: ReferenceLabel[];
}

export const DEFAULT_REFERENCE_LABEL_PRESENTATION: Readonly<ReferenceLabelPresentation> =
  Object.freeze({ alignment: "description", combine: true });

const ALIGNMENTS: readonly ReferenceLabelAlignment[] = ["description", "graph-branches"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function isReferenceLabel(value: unknown): value is GitRef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.hash === "string" &&
    value.hash !== "" &&
    typeof value.name === "string" &&
    value.name !== "" &&
    !containsControlCharacter(value.name) &&
    (value.type === "head" || value.type === "remote" || value.type === "tag")
  );
}

/**
 * Normalize the persisted reference-label preference without throwing on partial
 * or malformed values.
 */
export function normalizeReferenceLabelPresentation(value: unknown): ReferenceLabelPresentation {
  const input = isRecord(value) ? value : {};

  return {
    alignment: ALIGNMENTS.includes(input.alignment as ReferenceLabelAlignment)
      ? (input.alignment as ReferenceLabelAlignment)
      : DEFAULT_REFERENCE_LABEL_PRESENTATION.alignment,
    combine: typeof input.combine === "boolean" ? input.combine : true
  };
}

/**
 * Return stable class names that the graph container can use to select its
 * label layout without embedding layout state in individual labels.
 */
export function getReferenceLabelPresentationClasses(value: unknown): string[] {
  const presentation = normalizeReferenceLabelPresentation(value);
  const classes: string[] = [];

  if (presentation.combine) {
    classes.push("referenceLabelsCombined");
  }
  if (presentation.alignment === "graph-branches") {
    classes.push("referenceLabelsAlignedToGraph");
  }

  return classes;
}

function branchName(remoteName: string): string {
  const slashIndex = remoteName.indexOf("/");

  return slashIndex > 0 ? remoteName.substring(slashIndex + 1) : remoteName;
}

function remoteName(remoteBranchName: string): string {
  const slashIndex = remoteBranchName.indexOf("/");

  return slashIndex > 0 ? remoteBranchName.substring(0, slashIndex) : remoteBranchName;
}

function addCompactRemote(label: ReferenceLabel, remoteBranchName: string): void {
  const name = remoteName(remoteBranchName);

  if (!label.remotes.includes(name)) {
    label.remotes.push(name);
  }
}

function accessibleBranchName(label: ReferenceLabel): string {
  return label.remotes.length > 0 ? `${label.name} (${label.remotes.join(", ")})` : label.name;
}

/**
 * Group refs for rendering. Combined mode pairs every remote ref with a local
 * branch on the same commit, while separate mode leaves remote refs intact.
 * Tags are always independent labels.
 */
export function groupReferenceLabels(
  refs: readonly GitRef[],
  presentation: unknown
): GroupedReferenceLabels {
  const selectedPresentation = normalizeReferenceLabelPresentation(presentation);
  const validRefs = refs.filter(isReferenceLabel);
  const branches: ReferenceLabel[] = [];
  const branchesByHash = new Map<string, ReferenceLabel[]>();
  const remotes: GitRef[] = [];
  const tags: ReferenceLabel[] = [];

  for (const ref of validRefs) {
    if (ref.type === "head") {
      const label: ReferenceLabel = {
        accessibleName: ref.name,
        kind: "branch",
        name: ref.name,
        remotes: []
      };
      branches.push(label);
      const sameCommitBranches = branchesByHash.get(ref.hash);
      if (sameCommitBranches === undefined) {
        branchesByHash.set(ref.hash, [label]);
      } else {
        sameCommitBranches.push(label);
      }
    } else if (ref.type === "remote") {
      remotes.push(ref);
    } else {
      tags.push({
        accessibleName: ref.name,
        kind: "tag",
        name: ref.name,
        remotes: []
      });
    }
  }

  const detachedRemotes: ReferenceLabel[] = [];
  for (const remote of remotes) {
    const candidates = selectedPresentation.combine ? branchesByHash.get(remote.hash) : undefined;
    const exactCandidate = candidates?.find((label) => label.name === branchName(remote.name));
    const target = exactCandidate ?? candidates?.[0];

    if (target === undefined) {
      detachedRemotes.push({
        accessibleName: remote.name,
        kind: "remote",
        name: remote.name,
        remotes: []
      });
    } else {
      addCompactRemote(target, remote.name);
    }
  }

  for (const branch of branches) {
    branch.accessibleName = accessibleBranchName(branch);
  }

  return { labels: [...branches, ...detachedRemotes, ...tags] };
}
