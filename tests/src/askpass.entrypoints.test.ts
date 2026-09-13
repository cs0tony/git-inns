import { describe, expect, it } from "vitest";

import {
  createAskpassEntrypoint,
  createEmptyAskpassEntrypoint,
  createWindowsAskpassEntrypoint
} from "../../src/askpass/entrypoints";

describe("Askpass runtime entrypoints", () => {
  it("sends the Git prompt as a nonce-authenticated JSON reference", () => {
    const script = createAskpassEntrypoint("\\\\.\\pipe\\private-endpoint", "nonce-value");

    expect(script).toContain('require("node:http")');
    expect(script).toContain('"\\\\\\\\.\\\\pipe\\\\private-endpoint"');
    expect(script).toContain("JSON.stringify({ prompt })");
    expect(script).toContain('"x-git-keizu-askpass-nonce": nonce');
    expect(script).not.toContain("password");
    expect(script).not.toContain("console");
  });

  it("provides empty entrypoints that return no credentials", () => {
    const script = createEmptyAskpassEntrypoint();
    const batch = createWindowsAskpassEntrypoint("empty-askpass.js");

    expect(script).toBe('#!/usr/bin/env node\n"use strict";\n');
    expect(batch).toContain('"%~dp0empty-askpass.js"');
  });
});
