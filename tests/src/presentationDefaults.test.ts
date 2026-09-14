import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRESENTATION_COLUMN_VISIBILITY,
  DEFAULT_REPOSITORY_ORDERING_MODE,
  deriveRepositoryName,
  normalizePresentationColumnVisibility,
  normalizeRepositoryOrderingMode,
  orderRepositories,
  type RepositoryOrderingEntry
} from "../../src/presentationDefaults";

describe("presentation column visibility", () => {
  it("exposes Date, Author, and Commit as visible by default", () => {
    expect(DEFAULT_PRESENTATION_COLUMN_VISIBILITY).toEqual({
      date: true,
      author: true,
      commit: true
    });
  });

  it("normalizes valid values independently and accepts reference-style keys", () => {
    expect(
      normalizePresentationColumnVisibility({
        date: false,
        author: true,
        commit: "yes"
      })
    ).toEqual({
      date: false,
      author: true,
      commit: true
    });

    expect(
      normalizePresentationColumnVisibility({
        Date: true,
        Author: false,
        Commit: true
      })
    ).toEqual({
      date: true,
      author: false,
      commit: true
    });
  });

  it("falls back to all-visible defaults for malformed input", () => {
    expect(normalizePresentationColumnVisibility(null)).toEqual(
      DEFAULT_PRESENTATION_COLUMN_VISIBILITY
    );
    expect(normalizePresentationColumnVisibility(undefined)).toEqual(
      DEFAULT_PRESENTATION_COLUMN_VISIBILITY
    );
    expect(normalizePresentationColumnVisibility("all")).toEqual(
      DEFAULT_PRESENTATION_COLUMN_VISIBILITY
    );
    expect(normalizePresentationColumnVisibility({ date: 1 })).toEqual(
      DEFAULT_PRESENTATION_COLUMN_VISIBILITY
    );
  });

  it("keeps at least one data column visible", () => {
    expect(
      normalizePresentationColumnVisibility({
        date: false,
        author: false,
        commit: false
      })
    ).toEqual(DEFAULT_PRESENTATION_COLUMN_VISIBILITY);

    expect(
      normalizePresentationColumnVisibility({
        Date: false,
        Author: false,
        Commit: true
      })
    ).toEqual({ date: false, author: false, commit: true });
  });
});

describe("repository ordering", () => {
  it("uses workspace-path ordering by default and rejects unknown modes", () => {
    expect(DEFAULT_REPOSITORY_ORDERING_MODE).toBe("workspace-path");

    expect(normalizeRepositoryOrderingMode(undefined)).toBe("workspace-path");
    expect(normalizeRepositoryOrderingMode(null)).toBe("workspace-path");
    expect(normalizeRepositoryOrderingMode(42)).toBe("workspace-path");
    expect(normalizeRepositoryOrderingMode("basename")).toBe("workspace-path");
    expect(normalizeRepositoryOrderingMode("full-path")).toBe("full-path");
    expect(normalizeRepositoryOrderingMode("name")).toBe("name");
  });

  it("derives repository names from POSIX and Windows paths", () => {
    expect(deriveRepositoryName("/workspace/services/api")).toBe("api");
    expect(deriveRepositoryName("C:\\workspace\\services\\api")).toBe("api");
    expect(deriveRepositoryName("/workspace/api/")).toBe("api");
    expect(deriveRepositoryName("/")).toBe("");
    expect(deriveRepositoryName("")).toBe("");
  });

  it("orders by workspace path, name, and full path", () => {
    const repositories: RepositoryOrderingEntry[] = [
      { path: "/work/zeta" },
      { path: "/Work/Alpha" },
      { path: "/other/beta" },
      { path: "/work/alpha" }
    ];

    expect(orderRepositories(repositories, "workspace-path").map((repo) => repo.path)).toEqual([
      "/other/beta",
      "/Work/Alpha",
      "/work/alpha",
      "/work/zeta"
    ]);

    expect(orderRepositories(repositories, "name").map((repo) => repo.path)).toEqual([
      "/Work/Alpha",
      "/work/alpha",
      "/other/beta",
      "/work/zeta"
    ]);

    expect(orderRepositories(repositories, "full-path").map((repo) => repo.path)).toEqual([
      "/other/beta",
      "/Work/Alpha",
      "/work/alpha",
      "/work/zeta"
    ]);
  });

  it("breaks name ties by full path and preserves input order for equal paths", () => {
    const first = { path: "/workspace/Foo", id: "first" };
    const second = { path: "/other/foo", id: "second" };
    const duplicate = { path: "/workspace/Foo", id: "duplicate" };

    expect(orderRepositories([first, second], "name")).toEqual([second, first]);
    expect(orderRepositories([first, duplicate], "name")).toEqual([first, duplicate]);
  });

  it("does not mutate the input array", () => {
    const repositories = [{ path: "/zeta" }, { path: "/alpha" }];
    const original = [...repositories];

    orderRepositories(repositories, "workspace-path");

    expect(repositories).toEqual(original);
  });
});
