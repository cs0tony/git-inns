import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const HOST_SOURCE = readFileSync("src/commandManager.ts", "utf8");
const ENGLISH = JSON.parse(readFileSync("l10n/bundle.l10n.json", "utf8")) as Record<string, string>;
const JAPANESE = JSON.parse(readFileSync("l10n/bundle.l10n.ja.json", "utf8")) as Record<
  string,
  string
>;

const NEW_HOST_KEYS = [
  "Add Repository",
  "Added {0} to Git Keizu.",
  "{0} is not a Git repository.",
  "Select a repository to remove.",
  "Remove {0} from Git Keizu? This does not delete files on disk.",
  "Remove",
  "Removed {0} from Git Keizu.",
  "No known repositories are available.",
  "Select a repository to fetch.",
  "Fetching {0}...",
  "Fetched {0}.",
  "Open a Git Keizu revision file first.",
  "Git Keizu version: {0}"
] as const;

function extractHostSourceKeys(source: string): string[] {
  return [...source.matchAll(/\bt\("((?:\\.|[^"\\])+)"/gu)].map(
    ([, encodedKey]) => JSON.parse(`"${encodedKey}"`) as string
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\d+\}/gu)].map(([placeholder]) => placeholder);
}

describe("host localization parity", () => {
  it("extracts every new repository command UI key", () => {
    const sourceKeys = extractHostSourceKeys(HOST_SOURCE);

    for (const key of NEW_HOST_KEYS) {
      expect(sourceKeys).toContain(key);
    }
  });

  it("provides exact English keys and Japanese translations for every host key", () => {
    const sourceKeys = extractHostSourceKeys(HOST_SOURCE);

    expect(Object.keys(ENGLISH).sort()).toEqual(Object.keys(JAPANESE).sort());
    for (const key of sourceKeys) {
      expect(ENGLISH[key]).toBe(key);
      expect(JAPANESE[key]).not.toBe("");
      expect(JAPANESE[key]).not.toBe(key);
      expect(placeholders(JAPANESE[key])).toEqual(placeholders(key));
    }
  });
});
