export interface TagDetails {
  name: string;
  hash: string;
  tagType: "annotated" | "lightweight";
  tagger?: string;
  date?: string;
  message?: string;
}

interface TagHeader {
  hash: string;
  name: string;
  tagger?: string;
  date?: string;
}

const GIT_OBJECT_ID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const TAGGER_LINE = /^tagger\s+(.+)\s+<([^<>]*)>\s+([0-9]+)\s+([+-][0-9]{2}:?[0-9]{2})$/;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseHeaders(raw: string): TagHeader {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headerText = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const lines = headerText.split(/\r?\n/);
  const header: TagHeader = { hash: "", name: "" };

  for (const line of lines) {
    if (!header.hash && /^object\s+/.test(line)) {
      const value = line.slice("object ".length).trim();
      header.hash = GIT_OBJECT_ID.test(value) ? value.toLowerCase() : "";
      continue;
    }

    if (!header.name && /^tag\s+/.test(line)) {
      header.name = line.slice("tag ".length).trim();
      continue;
    }

    const tagger = TAGGER_LINE.exec(line);
    if (tagger) {
      header.tagger = tagger[1].trim();
      header.date = `${tagger[3]} ${tagger[4]}`;
    }
  }

  return header;
}

function parseMessage(raw: string): string | undefined {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (headerEnd === -1) return undefined;

  const separatorLength = raw.slice(headerEnd).match(/^\r?\n/)![0].length;
  const messageStart = headerEnd + separatorLength + 1;
  const message = raw.slice(messageStart).replace(/(?:\r?\n)+$/, "");
  return message.length === 0 ? undefined : message;
}

export function parseForCatFileTag(raw: string, fallbackName: string): TagDetails {
  const rawText = text(raw);
  const name = text(fallbackName);

  if (rawText.trim().length === 0) {
    return { name, hash: "", tagType: "lightweight" };
  }

  const header = parseHeaders(rawText);
  return {
    name: header.name || name,
    hash: header.hash,
    tagType: "annotated",
    tagger: header.tagger,
    date: header.date,
    message: parseMessage(rawText)
  };
}

export function formatTagDetails(details: TagDetails): string {
  const lines = [`Name: ${details.name}`, `Hash: ${details.hash}`, `Type: ${details.tagType}`];

  if (details.tagger !== undefined && details.tagger !== "") {
    lines.push(`Tagger: ${details.tagger}`);
  }

  if (details.date !== undefined && details.date !== "") {
    lines.push(`Date: ${details.date}`);
  }

  if (details.message !== undefined && details.message !== "") {
    lines.push("", "Message:", details.message);
  }

  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#x27;";
    }
  });
}

export function createTagDetailsElement(details: TagDetails): string {
  const items = [
    ["Name", details.name],
    ["Hash", details.hash],
    ["Type", details.tagType],
    ...(details.tagger !== undefined && details.tagger !== "" ? [["Tagger", details.tagger]] : []),
    ...(details.date !== undefined && details.date !== "" ? [["Date", details.date]] : [])
  ] as const;

  const rows = items
    .map(
      ([label, value]) =>
        `<dt class="tag-details-label">${escapeHtml(label)}</dt>` +
        `<dd class="tag-details-value">${escapeHtml(value)}</dd>`
    )
    .join("");

  const message =
    details.message !== undefined && details.message !== ""
      ? `<dt class="tag-details-label">Message</dt>` +
        `<dd class="tag-details-value">` +
        `<pre class="tag-details-message">${escapeHtml(details.message)}</pre>` +
        `</dd>`
      : "";

  return (
    `<section class="tag-details" aria-label="Tag details">` +
    `<dl class="tag-details-list">${rows}${message}</dl>` +
    `</section>`
  );
}
