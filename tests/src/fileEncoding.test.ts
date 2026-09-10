import { describe, expect, it } from "vitest";

import {
  decodeGitBytes,
  DEFAULT_FILE_ENCODING,
  normalizeFileEncoding,
  SUPPORTED_FILE_ENCODINGS
} from "../../src/fileEncoding";

describe("file encoding selection and decoding", () => {
  it("accepts the required encoding identifiers", () => {
    expect(SUPPORTED_FILE_ENCODINGS).toEqual([
      "utf8",
      "shift_jis",
      "euc-jp",
      "iso-2022-jp",
      "utf-16le",
      "windows-1252"
    ]);
  });

  it("falls back to UTF-8 for unvalidated input", () => {
    expect(normalizeFileEncoding("SHIFT-JIS")).toBe("shift_jis");
    expect(normalizeFileEncoding(undefined)).toBe(DEFAULT_FILE_ENCODING);
    expect(normalizeFileEncoding("unknown" as never)).toBe(DEFAULT_FILE_ENCODING);
  });

  it("decodes raw bytes with the selected encoding", () => {
    expect(decodeGitBytes(Buffer.from([0x8a, 0xbf]), "shift_jis")).toBe("漢");
    expect(decodeGitBytes(Buffer.from([0xa4, 0xa2]), "euc-jp")).toBe("あ");
    expect(
      decodeGitBytes(
        Buffer.from([0x1b, 0x24, 0x42, 0x24, 0x22, 0x1b, 0x28, 0x42]),
        "iso-2022-jp"
      )
    ).toBe("あ");
    expect(decodeGitBytes(Buffer.from([0x41, 0, 0x42, 0]), "utf-16le")).toBe("AB");
    expect(decodeGitBytes(Buffer.from([0x93, 0x75]), "windows-1252")).toBe("“u");
  });

  it("safely falls back to UTF-8 when a decoder is unavailable", () => {
    const originalTextDecoder = globalThis.TextDecoder;
    class RestrictedTextDecoder {
      constructor(label?: string) {
        if (label !== undefined && label !== "utf-8") {
          throw new RangeError(`Unsupported encoding: ${label}`);
        }
      }

      decode() {
        return "";
      }
    }
    globalThis.TextDecoder = RestrictedTextDecoder as unknown as typeof TextDecoder;

    try {
      expect(decodeGitBytes(Buffer.from("ok"), "shift_jis")).toBe("ok");
    } finally {
      globalThis.TextDecoder = originalTextDecoder;
    }
  });
});
