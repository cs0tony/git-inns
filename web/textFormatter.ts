export type CommitBodyFormatMode = "plain" | "rich";

export type EmojiMappingInput = Iterable<readonly [string, string]> | Record<string, string>;

export interface CommitBodyFormatOptions {
  mode?: CommitBodyFormatMode;
  emoji?: boolean;
  customEmoji?: EmojiMappingInput;
}

interface TokenOptions {
  emojiMappings?: ReadonlyMap<string, string>;
}

const HTML_ESCAPE_PATTERN = /[&<>"'/]/g;

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;"
};

const SHORTCODE_PATTERN = /:([a-z0-9_+-]+):/gi;
const SHORTCODE_KEY_PATTERN = /^[a-z0-9_+-]+$/;
const WHITESPACE_PATTERN = /\s/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]/u;
const KEYCAP_PATTERN = /^[#*0-9]\u{FE0F}?\u{20E3}$/u;

const fenceMarkers = ["```", "~~~"] as const;

export const BUILT_IN_EMOJI_MAPPINGS: ReadonlyMap<string, string> = new Map([
  ["smile", "🙂"],
  ["tada", "🎉"],
  ["rocket", "🚀"],
  ["white_check_mark", "✅"]
]);

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => htmlEscapes[character]!);
}

function escapeHtmlWithoutSlashes(value: string): string {
  return escapeHtml(value).replace(/&#x2F;/g, "/");
}

function escapeHref(value: string): string {
  return escapeHtmlWithoutSlashes(value);
}

function normalizeShortcodeKey(value: string): string | null {
  const key = value
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  return SHORTCODE_KEY_PATTERN.test(key) ? key : null;
}

function safeEmojiReplacement(value: string): string | null {
  const containsControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

  if (
    value === "" ||
    containsControlCharacter ||
    WHITESPACE_PATTERN.test(value) ||
    /[&<>"'`]/.test(value) ||
    (!EMOJI_PATTERN.test(value) && !value.includes("\u20E3") && !KEYCAP_PATTERN.test(value))
  ) {
    return null;
  }

  return value;
}

function isMappingEntries(value: unknown): value is Iterable<readonly [string, string]> {
  return typeof value === "object" && value !== null && Symbol.iterator in value;
}

export function normalizeEmojiMappings(input: EmojiMappingInput): Map<string, string> {
  const mappings = new Map<string, string>();
  const entries: Iterable<unknown> = Array.isArray(input)
    ? input
    : isMappingEntries(input)
      ? input
      : Object.entries(input ?? {});

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;

    const [rawKey, rawValue] = entry;
    if (typeof rawKey !== "string" || typeof rawValue !== "string") continue;

    const key = normalizeShortcodeKey(rawKey);
    const value = safeEmojiReplacement(rawValue);
    if (key === null || value === null) continue;

    mappings.set(key, value);
  }

  return mappings;
}

function replaceEmoji(value: string, mappings: ReadonlyMap<string, string> | undefined): string {
  if (mappings === undefined || mappings.size === 0) return value;

  return value.replace(SHORTCODE_PATTERN, (shortcode, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return mappings.get(key) ?? shortcode;
  });
}

function combineEmojiMappings(custom: EmojiMappingInput | undefined): Map<string, string> {
  const mappings = new Map(BUILT_IN_EMOJI_MAPPINGS);
  for (const [key, value] of normalizeEmojiMappings(custom ?? {})) {
    mappings.set(key, value);
  }
  return mappings;
}

function escapeText(value: string, options: TokenOptions = {}): string {
  return escapeHtml(replaceEmoji(value, options.emojiMappings));
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildLink(destination: string, label: string, options: TokenOptions): string | null {
  if (!/^https?:\/\//i.test(destination) || !isSafeHttpUrl(destination)) {
    return null;
  }

  return (
    `<a class="commit-body-link" href="${escapeHref(destination)}" ` +
    `target="_blank" rel="noopener noreferrer">${escapeHtmlWithoutSlashes(
      replaceEmoji(label, options.emojiMappings)
    )}</a>`
  );
}

function renderInlineCode(value: string): string {
  let content = value;
  const hasPadding =
    content.length > 1 &&
    content.startsWith(" ") &&
    content.endsWith(" ") &&
    content.trim().length > 0;

  if (hasPadding) {
    content = content.slice(1, -1);
  }

  return `<code class="commit-body-inline-code">${escapeHtml(content)}</code>`;
}

function renderInline(value: string, options: TokenOptions = {}): string {
  let html = "";
  let textStart = 0;
  let index = 0;

  const appendText = (end: number) => {
    if (end > textStart) {
      html += escapeText(value.slice(textStart, end), options);
    }
  };

  while (index < value.length) {
    const autolink = /^<(https?:\/\/[^\s<>]+)>/iy.exec(value.slice(index));
    if (autolink !== null) {
      const anchor = buildLink(autolink[1]!, autolink[1]!, options);
      if (anchor !== null) {
        appendText(index);
        html += anchor;
        index += autolink[0].length;
        textStart = index;
        continue;
      }
    }

    const link = /^\[([^\]\n]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/iy.exec(
      value.slice(index)
    );
    if (link !== null) {
      const anchor = buildLink(link[2]!, link[1]!, options);
      if (anchor !== null) {
        appendText(index);
        html += anchor;
        index += link[0].length;
        textStart = index;
        continue;
      }
    }

    const code = /^(`+)([\s\S]*?)\1/y.exec(value.slice(index));
    if (code !== null && code[2] !== "") {
      appendText(index);
      html += renderInlineCode(code[2]!);
      index += code[0].length;
      textStart = index;
      continue;
    }

    const bold = /(?<![\w_])(\*\*|__)(?!\s)(.+?)(?<!\s)\1(?![\w_*])/y.exec(value.slice(index));
    if (bold !== null) {
      appendText(index);
      html += `<strong class="commit-body-bold">${renderInline(bold[2]!, options)}</strong>`;
      index += bold[0].length;
      textStart = index;
      continue;
    }

    const italic = /(?<![\w_])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![\w_*])/y.exec(value.slice(index));
    if (italic !== null) {
      appendText(index);
      html += `<em class="commit-body-italic">${renderInline(italic[2]!, options)}</em>`;
      index += italic[0].length;
      textStart = index;
      continue;
    }

    index += 1;
  }

  appendText(value.length);
  return html;
}

function safeLanguageToken(value: string): string | null {
  const token = value.trim().split(/\s+/u, 1)[0] ?? "";
  return /^[a-z0-9][a-z0-9+#._-]{0,39}$/i.test(token) ? token : null;
}

function renderHeading(level: string, content: string, options: TokenOptions): string {
  return (
    `<h${level.length} class="commit-body-heading commit-body-heading-${level.length}">` +
    `${renderInline(content.trim(), options)}</h${level.length}>`
  );
}

function renderCodeBlock(content: string, language: string | null = null): string {
  const languageClass = language === null ? "" : ` language-${language}`;
  return (
    `<pre class="commit-body-code-block">` +
    `<code class="commit-body-inline-code${languageClass}">${escapeHtml(content)}</code></pre>`
  );
}

function removeCodeIndent(line: string): string | null {
  if (line.startsWith("    ")) return line.slice(4);
  if (line.startsWith("\t")) return line.slice(1);
  return null;
}

function parseFence(line: string): { marker: (typeof fenceMarkers)[number]; info: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
  if (match === null) return null;

  const marker = match[1]!;
  if (marker.startsWith("```")) {
    return { marker: "```", info: match[2] ?? "" };
  }

  return { marker: "~~~", info: match[2] ?? "" };
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

export function formatCommitBody(body: string, options: CommitBodyFormatOptions = {}): string {
  if (options.mode !== "rich") {
    return escapeHtml(body).replace(/\r?\n/gu, "");
  }

  const emojiMappings =
    options.emoji === true ? combineEmojiMappings(options.customEmoji) : undefined;
  const tokenOptions: TokenOptions = { emojiMappings };
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = parseFence(line);
    if (fence !== null) {
      const contentLines: string[] = [];
      index += 1;

      while (index < lines.length) {
        const contentLine = lines[index]!;
        const closingFence = parseFence(contentLine);
        if (closingFence !== null && closingFence.marker === fence.marker) {
          index += 1;
          break;
        }

        contentLines.push(contentLine);
        index += 1;
      }

      const language = safeLanguageToken(fence.info);
      blocks.push(renderCodeBlock(contentLines.join("\n"), language));
      continue;
    }

    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    if (heading !== null) {
      blocks.push(renderHeading(heading[1]!, heading[2] ?? "", tokenOptions));
      index += 1;
      continue;
    }

    const indentedContent = removeCodeIndent(line);
    if (indentedContent !== null) {
      const contentLines = [indentedContent];
      index += 1;

      while (index < lines.length) {
        const contentLine = lines[index]!;
        const nextIndented = removeCodeIndent(contentLine);
        if (nextIndented === null) break;

        contentLines.push(nextIndented);
        index += 1;
      }

      blocks.push(renderCodeBlock(contentLines.join("\n")));
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlank(lines[index]!)) {
      const paragraphLine = lines[index]!;
      if (parseFence(paragraphLine) !== null || /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(paragraphLine)) {
        break;
      }

      const paragraphIndent = removeCodeIndent(paragraphLine);
      paragraphLines.push(paragraphIndent ?? paragraphLine);
      index += 1;
    }

    if (paragraphLines.length > 0) {
      const content = paragraphLines.join("\n").trim();
      if (content !== "") {
        blocks.push(
          `<p class="commit-body-paragraph">${renderInline(content, tokenOptions).replace(
            /\n/g,
            "<br>"
          )}</p>`
        );
      }
    }
  }

  return blocks.join("");
}
