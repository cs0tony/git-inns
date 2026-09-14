import { describe, expect, it } from "vitest";

import type { GitRef } from "../../src/types";
import {
  DEFAULT_REFERENCE_LABEL_PRESENTATION,
  getReferenceLabelPresentationClasses,
  groupReferenceLabels,
  normalizeReferenceLabelPresentation,
  type ReferenceLabel
} from "../../web/referenceLabelPresentation";

const ref = (hash: string, name: string, type: GitRef["type"]): GitRef => ({
  hash,
  name,
  type
});

describe("reference label presentation normalization", () => {
  it("uses the documented defaults for malformed and partial input", () => {
    expect(normalizeReferenceLabelPresentation(undefined)).toEqual(
      DEFAULT_REFERENCE_LABEL_PRESENTATION
    );
    expect(normalizeReferenceLabelPresentation(null)).toEqual(DEFAULT_REFERENCE_LABEL_PRESENTATION);
    expect(normalizeReferenceLabelPresentation("invalid")).toEqual(
      DEFAULT_REFERENCE_LABEL_PRESENTATION
    );
    expect(normalizeReferenceLabelPresentation({})).toEqual(DEFAULT_REFERENCE_LABEL_PRESENTATION);
    expect(normalizeReferenceLabelPresentation({ combine: false })).toEqual({
      alignment: "description",
      combine: false
    });
    expect(normalizeReferenceLabelPresentation({ alignment: "graph-branches" })).toEqual({
      alignment: "graph-branches",
      combine: true
    });
  });

  it("rejects invalid values independently and ignores unknown fields", () => {
    expect(
      normalizeReferenceLabelPresentation({
        alignment: "left",
        combine: "yes",
        unsupported: true
      })
    ).toEqual(DEFAULT_REFERENCE_LABEL_PRESENTATION);
    expect(normalizeReferenceLabelPresentation({ alignment: 1, combine: 0 })).toEqual(
      DEFAULT_REFERENCE_LABEL_PRESENTATION
    );
  });

  it("preserves both valid presentation settings", () => {
    expect(
      normalizeReferenceLabelPresentation({
        alignment: "graph-branches",
        combine: false
      })
    ).toEqual({ alignment: "graph-branches", combine: false });
  });
});

describe("reference label CSS classes", () => {
  it("maps presentation state to deterministic classes", () => {
    expect(getReferenceLabelPresentationClasses(DEFAULT_REFERENCE_LABEL_PRESENTATION)).toEqual([
      "referenceLabelsCombined"
    ]);
    expect(
      getReferenceLabelPresentationClasses({
        alignment: "graph-branches",
        combine: true
      })
    ).toEqual(["referenceLabelsCombined", "referenceLabelsAlignedToGraph"]);
    expect(
      getReferenceLabelPresentationClasses({
        alignment: "description",
        combine: false
      })
    ).toEqual([]);
    expect(
      getReferenceLabelPresentationClasses({
        alignment: "graph-branches",
        combine: false
      })
    ).toEqual(["referenceLabelsAlignedToGraph"]);
  });

  it("normalizes unsafe input before producing classes", () => {
    expect(getReferenceLabelPresentationClasses(null)).toEqual(["referenceLabelsCombined"]);
    expect(getReferenceLabelPresentationClasses({ alignment: "invalid" })).toEqual([
      "referenceLabelsCombined"
    ]);
  });
});

describe("reference label grouping", () => {
  it("merges same-commit remotes into an accessible local branch label", () => {
    const refs: GitRef[] = [
      ref("a", "main", "head"),
      ref("a", "v1.0.0", "tag"),
      ref("a", "origin/main", "remote"),
      ref("a", "upstream/main", "remote"),
      ref("b", "origin/feature", "remote"),
      ref("c", "local-feature", "head")
    ];

    expect(groupReferenceLabels(refs, DEFAULT_REFERENCE_LABEL_PRESENTATION).labels).toEqual<
      ReferenceLabel[]
    >([
      {
        accessibleName: "main (origin, upstream)",
        kind: "branch",
        name: "main",
        remotes: ["origin", "upstream"]
      },
      {
        accessibleName: "local-feature",
        kind: "branch",
        name: "local-feature",
        remotes: []
      },
      {
        accessibleName: "origin/feature",
        kind: "remote",
        name: "origin/feature",
        remotes: []
      },
      {
        accessibleName: "v1.0.0",
        kind: "tag",
        name: "v1.0.0",
        remotes: []
      }
    ]);
  });

  it("keeps local and remote labels separate when combining is disabled", () => {
    const refs: GitRef[] = [
      ref("a", "origin/main", "remote"),
      ref("a", "main", "head"),
      ref("a", "v1.0.0", "tag")
    ];
    const presentation = normalizeReferenceLabelPresentation({
      alignment: "graph-branches",
      combine: false
    });

    expect(groupReferenceLabels(refs, presentation).labels).toEqual<ReferenceLabel[]>([
      {
        accessibleName: "main",
        kind: "branch",
        name: "main",
        remotes: []
      },
      {
        accessibleName: "origin/main",
        kind: "remote",
        name: "origin/main",
        remotes: []
      },
      {
        accessibleName: "v1.0.0",
        kind: "tag",
        name: "v1.0.0",
        remotes: []
      }
    ]);
  });

  it("keeps remote-only labels and tags intact", () => {
    const refs: GitRef[] = [
      ref("a", "origin/main", "remote"),
      ref("b", "upstream/develop", "remote"),
      ref("a", "v1.0.0", "tag")
    ];

    expect(groupReferenceLabels(refs, DEFAULT_REFERENCE_LABEL_PRESENTATION).labels).toEqual<
      ReferenceLabel[]
    >([
      {
        accessibleName: "origin/main",
        kind: "remote",
        name: "origin/main",
        remotes: []
      },
      {
        accessibleName: "upstream/develop",
        kind: "remote",
        name: "upstream/develop",
        remotes: []
      },
      {
        accessibleName: "v1.0.0",
        kind: "tag",
        name: "v1.0.0",
        remotes: []
      }
    ]);
  });

  it("ignores malformed refs and malformed presentation values without throwing", () => {
    const refs = [
      null,
      ref("", "main", "head"),
      ref("a", "", "head"),
      { hash: "a", name: "main" },
      { hash: "a", name: "main", type: "unknown" },
      ref("a", "main", "head"),
      ref("a", "v1", "tag")
    ] as unknown as GitRef[];

    expect(groupReferenceLabels(refs, "invalid").labels).toEqual<ReferenceLabel[]>([
      {
        accessibleName: "main",
        kind: "branch",
        name: "main",
        remotes: []
      },
      {
        accessibleName: "v1",
        kind: "tag",
        name: "v1",
        remotes: []
      }
    ]);
  });
});
