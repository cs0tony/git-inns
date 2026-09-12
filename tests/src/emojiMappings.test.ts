import { describe, expect, it } from "vitest";

import {
  combineWithBuiltInEmojiMappings,
  DEFAULT_EMOJI_MAPPINGS,
  normalizeEmojiMappings
} from "../../src/emojiMappings";

describe("emoji mappings", () => {
  it("exposes the built-in emoji mappings", () => {
    expect(DEFAULT_EMOJI_MAPPINGS).toEqual({
      bug: "🐛",
      rocket: "🚀",
      shipped: "🚢",
      sparkles: "✨",
      wreck: "🚨"
    });
  });

  it("normalizes entries supplied as an array", () => {
    expect(
      normalizeEmojiMappings([
        { shortcode: "SHIP", emoji: "🚢" },
        { shortcode: "rocket", emoji: "🚀" },
        { shortcode: "party_parrot", emoji: "🦜" },
        { shortcode: "heart", emoji: "❤️" }
      ])
    ).toEqual({
      heart: "❤️",
      party_parrot: "🦜",
      rocket: "🚀",
      ship: "🚢"
    });
  });

  it("normalizes entries supplied as a record", () => {
    expect(
      normalizeEmojiMappings({
        SHIP: "🚢",
        rocket: "🚀",
        "+1": "👍"
      })
    ).toEqual({
      "+1": "👍",
      rocket: "🚀",
      ship: "🚢"
    });
  });

  it("ignores invalid shortcodes and emoji values", () => {
    expect(
      normalizeEmojiMappings([
        { shortcode: "has space", emoji: "🚢" },
        { shortcode: "Uppercase!", emoji: "🚀" },
        { shortcode: "empty", emoji: "" },
        { shortcode: "not-text", emoji: 42 },
        { emoji: "🐛" },
        { shortcode: "missing-emoji" }
      ])
    ).toEqual({});
  });

  it("falls back to an empty mapping for invalid top-level shapes", () => {
    for (const value of [undefined, null, "rocket", 42, true, () => "🚀"]) {
      expect(normalizeEmojiMappings(value)).toEqual({});
    }
  });

  it("lowercases shortcode keys before validating them", () => {
    expect(
      normalizeEmojiMappings({
        SHIP: "🚢",
        Rocket: "🚀"
      })
    ).toEqual({
      rocket: "🚀",
      ship: "🚢"
    });
  });

  it("lets custom mappings override built-in mappings", () => {
    expect(
      combineWithBuiltInEmojiMappings(
        normalizeEmojiMappings({
          bug: "🪲",
          rocket: "🛸",
          custom: "🌟"
        })
      )
    ).toEqual({
      bug: "🪲",
      custom: "🌟",
      rocket: "🛸",
      shipped: "🚢",
      sparkles: "✨",
      wreck: "🚨"
    });
  });

  it("handles prototype-related keys without polluting prototypes", () => {
    const maliciousRecord = JSON.parse(
      '{"__proto__":"polluted","constructor":"polluted","valid":"🚀"}'
    ) as Record<string, unknown>;

    const recordResult = normalizeEmojiMappings(maliciousRecord);
    expect(Object.entries(recordResult)).toEqual([
      ["__proto__", "polluted"],
      ["constructor", "polluted"],
      ["valid", "🚀"]
    ]);
    expect(Object.getPrototypeOf(recordResult)).toBeNull();

    expect(
      Object.entries(
        normalizeEmojiMappings([
          { shortcode: "__proto__", emoji: "polluted" },
          { shortcode: "constructor", emoji: "polluted" }
        ])
      )
    ).toEqual([
      ["__proto__", "polluted"],
      ["constructor", "polluted"]
    ]);
    expect(Object.getOwnPropertyDescriptor(Object.prototype, "polluted")).toBeUndefined();
    expect((globalThis as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects dangerous object-shaped prototype attempts", () => {
    const maliciousRecord = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"polluted":true}}'
    ) as Record<string, unknown>;

    expect(normalizeEmojiMappings(maliciousRecord)).toEqual({});
    expect(
      Object.entries(
        normalizeEmojiMappings([
          { shortcode: "__proto__", emoji: "polluted" },
          { shortcode: "constructor", emoji: {} }
        ])
      )
    ).toEqual([["__proto__", "polluted"]]);
    expect(Object.prototype.polluted).toBeUndefined();
    expect((globalThis as Record<string, unknown>).polluted).toBeUndefined();
  });
});
