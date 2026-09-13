import { describe, expect, it } from "vitest";

import {
  ASKPASS_MAIN_SCRIPT_NAME,
  createAskpassEntrypoint,
  createEmptyAskpassEntrypoint,
  createPosixAskpassEntrypoint,
  createWindowsAskpassEntrypoint
} from "../../src/askpass/entrypoints";

describe("Askpass runtime entrypoints", () => {
  it("sends the Git prompt as a nonce-authenticated JSON reference", () => {
    const script = createAskpassEntrypoint("\\\\.\\pipe\\private-endpoint", "nonce-value");

    expect(script).toContain('require("node:http")');
    expect(script).toContain('"\\\\\\\\.\\\\pipe\\\\private-endpoint"');
    expect(script).toContain("JSON.stringify({ prompt })");
    expect(script).toContain('"x-git-keizu-askpass-nonce": nonce');
    expect(script.startsWith("#!")).toBe(false);
    expect(script).not.toContain("password");
    expect(script).not.toContain("console");
  });

  it("provides empty entrypoints that return no credentials", () => {
    const script = createEmptyAskpassEntrypoint();
    const batch = createWindowsAskpassEntrypoint("empty-askpass.cjs");

    expect(script).toBe('"use strict";\n');
    expect(batch).toContain('"%~dp0empty-askpass.cjs"');
  });

  it("uses the dedicated runtime variable in quoted platform wrappers", () => {
    const posix = createPosixAskpassEntrypoint(ASKPASS_MAIN_SCRIPT_NAME);
    const batch = createWindowsAskpassEntrypoint(ASKPASS_MAIN_SCRIPT_NAME);

    expect(posix).toContain("#!/bin/sh\n");
    expect(posix).toContain('exec "$GIT_KEIZU_NODE"');
    expect(posix).toContain(`"$script_dir/${ASKPASS_MAIN_SCRIPT_NAME}"`);
    expect(posix).not.toContain("process.execPath");
    expect(batch).toContain('"%GIT_KEIZU_NODE%"');
    expect(batch).toContain(`"%~dp0${ASKPASS_MAIN_SCRIPT_NAME}"`);
    expect(batch).not.toContain("process.execPath");
  });
});
