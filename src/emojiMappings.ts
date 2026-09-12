export type EmojiMappingRecord = Record<string, string>;

export const DEFAULT_EMOJI_MAPPINGS: Readonly<EmojiMappingRecord> = Object.freeze({
  bug: "🐛",
  rocket: "🚀",
  shipped: "🚢",
  sparkles: "✨",
  wreck: "🚨"
});

const EMOJI_SHORTCODE_PATTERN = /^[a-z0-9_+-]+$/;

export function normalizeEmojiMappings(value: unknown): EmojiMappingRecord {
  const mappings = Object.create(null) as EmojiMappingRecord;

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) continue;

      const candidate = entry as Record<string, unknown>;
      const shortcode = candidate.shortcode;
      const emoji = candidate.emoji;
      if (typeof shortcode !== "string" || typeof emoji !== "string" || emoji === "") continue;

      const normalizedShortcode = shortcode.toLowerCase();
      if (!EMOJI_SHORTCODE_PATTERN.test(normalizedShortcode)) continue;

      mappings[normalizedShortcode] = emoji;
    }
    return mappings;
  }

  if (typeof value !== "object" || value === null) return mappings;

  const entries = value as Record<string, unknown>;
  for (const [shortcode, emoji] of Object.entries(entries)) {
    if (typeof emoji !== "string" || emoji === "") continue;

    const normalizedShortcode = shortcode.toLowerCase();
    if (!EMOJI_SHORTCODE_PATTERN.test(normalizedShortcode)) continue;

    mappings[normalizedShortcode] = emoji;
  }
  return mappings;
}

export function combineWithBuiltInEmojiMappings(custom: EmojiMappingRecord): EmojiMappingRecord {
  const combined = normalizeEmojiMappings(DEFAULT_EMOJI_MAPPINGS);
  Object.assign(combined, normalizeEmojiMappings(custom));
  return combined;
}
