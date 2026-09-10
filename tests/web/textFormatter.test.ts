// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_EMOJI_MAPPINGS,
  formatCommitBody,
  normalizeEmojiMappings
} from "../../web/textFormatter";

function htmlIn(containerHtml: string, selector: string): string[] {
  const container = document.createElement("div");
  container.innerHTML = containerHtml;
  return Array.from(container.querySelectorAll(selector), (element) => element.innerHTML);
}

describe("normalizeEmojiMappings", () => {
  it("normalizes shortcode delimiters, whitespace, and case", () => {
    const mappings = normalizeEmojiMappings([
      [" :PARTY: ", "🥳"],
      [":PARTY_POPPER:", "🎉"]
    ]);

    expect(mappings.get("party")).toBe("🥳");
    expect(mappings.get("party_popper")).toBe("🎉");
  });

  it("accepts normalized record input and skips unsafe or malformed entries", () => {
    const mappings = normalizeEmojiMappings({
      rocket: "🚀",
      "": "⚠️",
      "bad space": "⚠️",
      markup: "<script>alert(1)</script>",
      text: "not-an-emoji",
      control: "A\u0000B"
    });

    expect(mappings.get("rocket")).toBe("🚀");
    expect(mappings.has("bad space")).toBe(false);
    expect(mappings.has("markup")).toBe(false);
    expect(mappings.has("text")).toBe(false);
    expect(mappings.has("control")).toBe(false);
  });

  it("exposes the small built-in map in normalized form", () => {
    expect(BUILT_IN_EMOJI_MAPPINGS.get("smile")).toBe("🙂");
    expect(BUILT_IN_EMOJI_MAPPINGS.get("white_check_mark")).toBe("✅");
  });
});

describe("formatCommitBody: plain fallback", () => {
  it("matches escaped plain text behavior and preserves line breaks", () => {
    const body = 'First\n<img src=x onerror="alert(1)">/Second';

    expect(formatCommitBody(body, { mode: "plain" })).toBe(
      "First&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#x2F;Second"
    );
  });

  it("does not render Markdown or replace emoji in plain mode", () => {
    const body = "# No heading :tada:";

    expect(formatCommitBody(body, { mode: "plain", emoji: true })).toBe("# No heading :tada:");
  });
});

describe("formatCommitBody: Markdown", () => {
  it("renders paragraphs and explicit soft line breaks", () => {
    expect(formatCommitBody("One\nTwo\n\nThree", { mode: "rich" })).toBe(
      '<p class="commit-body-paragraph">One<br>Two</p>' +
        '<p class="commit-body-paragraph">Three</p>'
    );
  });

  it("renders semantic ATX headings", () => {
    expect(formatCommitBody("## Release notes", { mode: "rich" })).toBe(
      '<h2 class="commit-body-heading commit-body-heading-2">Release notes</h2>'
    );
  });

  it("renders bold, italic, and inline code", () => {
    expect(formatCommitBody("**bold** *italic* _emphasis_ `code`", { mode: "rich" })).toBe(
      '<p class="commit-body-paragraph">' +
        '<strong class="commit-body-bold">bold</strong> ' +
        '<em class="commit-body-italic">italic</em> ' +
        '<em class="commit-body-italic">emphasis</em> ' +
        '<code class="commit-body-inline-code">code</code></p>'
    );
  });

  it("renders fenced code blocks with a safe language token", () => {
    const html = formatCommitBody('```ts title="ignored"\nconst value = "<b>";\n```', {
      mode: "rich"
    });

    expect(html).toBe(
      '<pre class="commit-body-code-block"><code class="commit-body-inline-code language-ts">' +
        "const value = &quot;&lt;b&gt;&quot;;</code></pre>"
    );
  });

  it("renders indented code blocks", () => {
    expect(formatCommitBody("    const value = '<b>';", { mode: "rich" })).toBe(
      '<pre class="commit-body-code-block"><code class="commit-body-inline-code">' +
        "const value = &#x27;&lt;b&gt;&#x27;;</code></pre>"
    );
  });

  it("renders HTTP and HTTPS autolinks", () => {
    expect(
      formatCommitBody("<https://example.test/a> <http://example.test/b>", { mode: "rich" })
    ).toBe(
      '<p class="commit-body-paragraph">' +
        '<a class="commit-body-link" href="https://example.test/a" target="_blank" rel="noopener noreferrer">https://example.test/a</a> ' +
        '<a class="commit-body-link" href="http://example.test/b" target="_blank" rel="noopener noreferrer">http://example.test/b</a>' +
        "</p>"
    );
  });

  it("renders labelled HTTP and HTTPS links with escaped labels", () => {
    const html = formatCommitBody("[<b>Docs</b>](https://example.test/path?a=1&b=2)", {
      mode: "rich"
    });

    expect(html).toBe(
      '<p class="commit-body-paragraph"><a class="commit-body-link" ' +
        'href="https://example.test/path?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">' +
        "&lt;b&gt;Docs&lt;/b&gt;</a></p>"
    );
  });

  it("neutralizes unsafe labelled-link destinations", () => {
    const html = formatCommitBody("[click](javascript:alert(1))", { mode: "rich" });

    expect(html).toBe('<p class="commit-body-paragraph">[click](javascript:alert(1))</p>');
    expect(htmlIn(html, "a")).toHaveLength(0);
  });

  it("neutralizes unsafe autolink destinations and angle-bracket markup", () => {
    const html = formatCommitBody("<javascript:alert(1)> <iframe src=x>", { mode: "rich" });

    expect(html).toBe(
      '<p class="commit-body-paragraph">&lt;javascript:alert(1)&gt; &lt;iframe src=x&gt;</p>'
    );
    expect(htmlIn(html, "iframe")).toHaveLength(0);
  });

  it("escapes HTML in headings, body text, and code", () => {
    const html = formatCommitBody(
      '# Title <img src=x onerror="alert(1)">\n\nBody <script>alert(2)</script>',
      { mode: "rich" }
    );

    expect(htmlIn(html, "h1")[0]).toBe('Title &lt;img src=x onerror="alert(1)"&gt;');
    expect(htmlIn(html, "p")[0]).toBe("Body &lt;script&gt;alert(2)&lt;/script&gt;");
    expect(htmlIn(html, "script")).toHaveLength(0);
    expect(htmlIn(html, "img")).toHaveLength(0);
  });
});

describe("formatCommitBody: emoji", () => {
  it("replaces built-in shortcodes only when enabled in rich mode", () => {
    const body = "Ship it :rocket: :tada:!";

    expect(formatCommitBody(body, { mode: "rich" })).toBe(
      '<p class="commit-body-paragraph">Ship it :rocket: :tada:!</p>'
    );
    expect(formatCommitBody(body, { mode: "rich", emoji: true })).toBe(
      '<p class="commit-body-paragraph">Ship it 🚀 🎉!</p>'
    );
  });

  it("supports custom mappings and lets them override built-ins", () => {
    const html = formatCommitBody(":shipit: :rocket: :unsafe:", {
      mode: "rich",
      emoji: true,
      customEmoji: {
        SHIPIT: "🚢",
        rocket: "🛸",
        unsafe: "<b>alert(1)</b>"
      }
    });

    expect(html).toBe('<p class="commit-body-paragraph">🚢 🛸 :unsafe:</p>');
  });
});

describe("formatCommitBody: end-to-end safety", () => {
  it("produces only supported semantic elements", () => {
    const body = [
      "## Changes",
      "",
      "**Added** `formatCommitBody` :rocket:",
      "See <https://example.test/docs>.",
      "",
      "```text",
      "<script>alert(1)</script>",
      "```"
    ].join("\n");
    const container = document.createElement("div");
    container.innerHTML = formatCommitBody(body, { mode: "rich", emoji: true });

    expect(Array.from(container.children, (element) => element.tagName.toLowerCase())).toEqual([
      "h2",
      "p",
      "pre"
    ]);
    expect(container.querySelectorAll("script,img,iframe,style")).toHaveLength(0);
    expect(container.querySelectorAll('a[rel="noopener noreferrer"]')).toHaveLength(1);
  });
});
