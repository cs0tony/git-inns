// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { getSignaturePresentation } from "../../web/commitSignature";

describe("getSignaturePresentation", () => {
  it.each([
    ["G", "good"],
    ["B", "bad"],
    ["U", "unknown"],
    ["X", "expired"],
    ["Y", "expired"],
    ["R", "revoked"],
    ["E", "cannotCheck"],
    ["N", "unsigned"]
  ] as const)("maps %s to the %s presentation", (status, id) => {
    expect(getSignaturePresentation(status).id).toBe(id);
  });

  it("falls back to unknown without exposing the raw status", () => {
    const presentation = getSignaturePresentation("<");

    expect(presentation).toEqual({
      badge: "•",
      id: "unknown",
      label: "Unknown"
    });
  });

  it("identifies signature states by concise labels", () => {
    expect(getSignaturePresentation("G").label).toBe("Verified");
    expect(getSignaturePresentation("N").label).toBe("Unsigned");
  });
});
