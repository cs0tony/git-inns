import { describe, expect, it } from "vitest";

import {
  type CommitDetailsPresentationSettings,
  getCommitDetailsBodyClassName,
  normalizeCommitDetailsPresentation
} from "../../web/commitDetailsPresentation";

const DEFAULT_SETTINGS: CommitDetailsPresentationSettings = {
  location: "inline",
  fileViewMode: "tree",
  compactFolders: true,
  autoCenter: false
};

function expectedClassName(settings: CommitDetailsPresentationSettings) {
  return [
    "commitDetailsBody",
    settings.location === "right" ? "commitDetailsRight" : "",
    settings.fileViewMode === "tree" ? "commitDetailsFileTree" : "",
    settings.fileViewMode === "list" ? "commitDetailsFileList" : "",
    settings.compactFolders ? "commitDetailsCompactFolders" : "",
    settings.autoCenter ? "commitDetailsAutoCenter" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

describe("normalizeCommitDetailsPresentation", () => {
  it("returns stable defaults when no input is provided", () => {
    expect(normalizeCommitDetailsPresentation(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns stable defaults for non-object inputs", () => {
    expect(normalizeCommitDetailsPresentation(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeCommitDetailsPresentation("settings")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeCommitDetailsPresentation([])).toEqual(DEFAULT_SETTINGS);
  });

  it("uses a valid fallback for every invalid field", () => {
    expect(
      normalizeCommitDetailsPresentation(
        {
          location: 7,
          fileViewMode: true,
          compactFolders: "yes",
          autoCenter: 0
        },
        {
          location: "right",
          fileViewMode: "list",
          compactFolders: false,
          autoCenter: true
        }
      )
    ).toEqual({
      location: "right",
      fileViewMode: "list",
      compactFolders: false,
      autoCenter: true
    });
  });

  it("uses stable defaults when both input and fallback are invalid", () => {
    expect(
      normalizeCommitDetailsPresentation(
        {
          location: Object.create(null),
          fileViewMode: ["tree"],
          compactFolders: null,
          autoCenter: "false"
        },
        {
          location: "center",
          fileViewMode: "grid",
          compactFolders: 1,
          autoCenter: undefined
        }
      )
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("normalizes fields independently and preserves valid input", () => {
    expect(
      normalizeCommitDetailsPresentation(
        {
          location: "right",
          fileViewMode: "invalid",
          compactFolders: false,
          autoCenter: true
        },
        { fileViewMode: "list", compactFolders: true }
      )
    ).toEqual({
      location: "right",
      fileViewMode: "list",
      compactFolders: false,
      autoCenter: true
    });
  });

  it("returns a new settings object rather than exposing an input object", () => {
    const input = {
      location: "right",
      fileViewMode: "list",
      compactFolders: false,
      autoCenter: true
    } as const;
    const result = normalizeCommitDetailsPresentation(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe("getCommitDetailsBodyClassName", () => {
  it("returns the default body and tree classes for stable defaults", () => {
    expect(getCommitDetailsBodyClassName(DEFAULT_SETTINGS)).toBe(
      "commitDetailsBody commitDetailsFileTree commitDetailsCompactFolders"
    );
  });

  it("adds classes for all enabled flags and the right location", () => {
    const settings: CommitDetailsPresentationSettings = {
      location: "right",
      fileViewMode: "list",
      compactFolders: true,
      autoCenter: true
    };

    expect(getCommitDetailsBodyClassName(settings)).toBe(
      "commitDetailsBody commitDetailsRight commitDetailsFileList " +
        "commitDetailsCompactFolders commitDetailsAutoCenter"
    );
  });

  it("omits flag classes when flags are disabled", () => {
    const settings: CommitDetailsPresentationSettings = {
      location: "inline",
      fileViewMode: "tree",
      compactFolders: false,
      autoCenter: false
    };

    expect(getCommitDetailsBodyClassName(settings)).toBe("commitDetailsBody commitDetailsFileTree");
  });

  it("uses the list class for the list file view mode", () => {
    expect(
      getCommitDetailsBodyClassName({
        ...DEFAULT_SETTINGS,
        fileViewMode: "list"
      })
    ).toBe("commitDetailsBody commitDetailsFileList commitDetailsCompactFolders");
  });

  it("matches its expected class for each normalized setting combination", () => {
    for (const location of ["inline", "right"] as const) {
      for (const fileViewMode of ["tree", "list"] as const) {
        for (const compactFolders of [false, true]) {
          for (const autoCenter of [false, true]) {
            const settings = normalizeCommitDetailsPresentation({
              location,
              fileViewMode,
              compactFolders,
              autoCenter
            });

            expect(getCommitDetailsBodyClassName(settings)).toBe(expectedClassName(settings));
          }
        }
      }
    }
  });
});
