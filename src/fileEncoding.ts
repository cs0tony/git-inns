import type { FileEncoding } from "./types";

export type { FileEncoding };

export const DEFAULT_FILE_ENCODING: FileEncoding = "utf8";

export const SUPPORTED_FILE_ENCODINGS: readonly FileEncoding[] = [
  "utf8",
  "shift_jis",
  "euc-jp",
  "iso-2022-jp",
  "utf-16le",
  "windows-1252"
];

const FILE_ENCODING_ALIASES: Readonly<Record<string, FileEncoding>> = {
  "euc-jp": "euc-jp",
  "iso-2022-jp": "iso-2022-jp",
  shift_jis: "shift_jis",
  "shift-jis": "shift_jis",
  "utf-16le": "utf-16le",
  "utf-8": "utf8",
  utf8: "utf8",
  "windows-1252": "windows-1252"
};

const TEXT_DECODER_LABELS: Readonly<Record<FileEncoding, string>> = {
  "euc-jp": "euc-jp",
  "iso-2022-jp": "iso-2022-jp",
  shift_jis: "shift_jis",
  "utf-16le": "utf-16le",
  utf8: "utf-8",
  "windows-1252": "windows-1252"
};

export function normalizeFileEncoding(value: unknown): FileEncoding {
  if (typeof value !== "string") return DEFAULT_FILE_ENCODING;
  return FILE_ENCODING_ALIASES[value.trim().toLowerCase()] ?? DEFAULT_FILE_ENCODING;
}

export function isSupportedFileEncoding(value: unknown): value is FileEncoding {
  return typeof value === "string" && value.trim().toLowerCase() in FILE_ENCODING_ALIASES;
}

export function decodeGitBytes(bytes: Uint8Array, encoding: string): string {
  const normalizedEncoding = normalizeFileEncoding(encoding);
  const TextDecoderConstructor = globalThis.TextDecoder;
  if (TextDecoderConstructor === undefined) {
    return Buffer.from(bytes).toString("utf8");
  }

  try {
    type DecodingTextDecoder = new (
      label: string,
      options?: { fatal?: boolean }
    ) => { decode(input?: Uint8Array): string };
    const decoder = new (TextDecoderConstructor as unknown as DecodingTextDecoder)(
      TEXT_DECODER_LABELS[normalizedEncoding],
      { fatal: false }
    );
    return decoder.decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("utf8");
  }
}
