import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const COMMAND_IDS = [
  "git-keizu.view",
  "git-keizu.clearAvatarCache",
  "git-keizu.resumeActiveReview",
  "git-keizu.endActiveReview",
  "git-keizu.endAllReviews",
  "git-keizu.addRepository",
  "git-keizu.removeRepository",
  "git-keizu.fetch",
  "git-keizu.openActiveDiffFile",
  "git-keizu.version"
] as const;

describe("command manifest and localization parity", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { commands: Array<{ category: string; command: string; title: string }> };
  };
  const english = JSON.parse(readFileSync("package.nls.json", "utf8")) as Record<string, string>;
  const japanese = JSON.parse(readFileSync("package.nls.ja.json", "utf8")) as Record<
    string,
    string
  >;
  const commands = manifest.contributes.commands;

  it("registers every Wave 6 repository command exactly once", () => {
    const actualIds = commands.map((command) => command.command);

    for (const commandId of COMMAND_IDS) {
      expect(actualIds.filter((id) => id === commandId)).toHaveLength(1);
    }
    expect(actualIds).toEqual([...COMMAND_IDS]);
  });

  it("localizes every command title in English and Japanese", () => {
    for (const command of commands) {
      expect(command.category).toBe("%command.category%");
      expect(command.title).toMatch(/^%command\..+\.title%$/u);

      const key = command.title.slice(1, -1);
      expect(english[key]).toBeTruthy();
      expect(japanese[key]).toBeTruthy();
      expect(japanese[key]).not.toBe(english[key]);
    }
  });
});
