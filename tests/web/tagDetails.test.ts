// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  createTagDetailsElement,
  formatTagDetails,
  parseForCatFileTag
} from "../../src/tagDetails";

const annotatedTag = [
  "object 6f8f9a36e8344a25f699403e5cd2f79c930d0d47",
  "type commit",
  "tag release-1",
  "tagger A U Thor <author@example.com> 1700000000 +0000",
  "",
  "Release 1",
  "",
  "  Notes with whitespace",
  ""
].join("\n");

describe("parseForCatFileTag", () => {
  it("parses annotated tag headers and preserves message whitespace", () => {
    const details = parseForCatFileTag(annotatedTag, "fallback");

    expect(details).toEqual({
      name: "release-1",
      hash: "6f8f9a36e8344a25f699403e5cd2f79c930d0d47",
      tagType: "annotated",
      tagger: "A U Thor",
      date: "1700000000 +0000",
      message: "Release 1\n\n  Notes with whitespace"
    });
  });

  it("classifies empty raw output as lightweight", () => {
    expect(parseForCatFileTag("", "v1")).toEqual({
      name: "v1",
      hash: "",
      tagType: "lightweight"
    });
    expect(parseForCatFileTag("   \n\t", "v1")).toEqual({
      name: "v1",
      hash: "",
      tagType: "lightweight"
    });
  });

  it("falls back safely when the annotated output is incomplete", () => {
    expect(parseForCatFileTag("object no-thanks\ntag ", "fallback")).toEqual({
      name: "fallback",
      hash: "",
      tagType: "annotated",
      tagger: undefined,
      date: undefined,
      message: undefined
    });
  });
});

describe("formatTagDetails", () => {
  it("produces concise multiline details", () => {
    const text = formatTagDetails(parseForCatFileTag(annotatedTag, "fallback"));

    expect(text).toBe(
      [
        "Name: release-1",
        "Hash: 6f8f9a36e8344a25f699403e5cd2f79c930d0d47",
        "Type: annotated",
        "Tagger: A U Thor",
        "Date: 1700000000 +0000",
        "",
        "Message:",
        "Release 1",
        "",
        "  Notes with whitespace"
      ].join("\n")
    );
  });

  it("omits unavailable lightweight metadata", () => {
    expect(formatTagDetails(parseForCatFileTag("", "v1"))).toBe(
      "Name: v1\nHash: \nType: lightweight"
    );
  });
});

describe("createTagDetailsElement", () => {
  it("renders an accessible semantic fragment", () => {
    const html = createTagDetailsElement(parseForCatFileTag(annotatedTag, "fallback"));
    const document = new DOMParser().parseFromString(html, "text/html");
    const root = document.querySelector("section.tag-details");

    expect(root?.getAttribute("aria-label")).toBe("Tag details");
    expect(document.querySelector("dl.tag-details-list")).not.toBeNull();

    const values = [...document.querySelectorAll(".tag-details-value")].map(
      (element) => element.textContent
    );
    expect(values.slice(0, 5)).toEqual([
      "release-1",
      "6f8f9a36e8344a25f699403e5cd2f79c930d0d47",
      "annotated",
      "A U Thor",
      "1700000000 +0000"
    ]);
    expect(document.querySelector(".tag-details-message")?.textContent).toBe(
      "Release 1\n\n  Notes with whitespace"
    );
  });

  it("escapes untrusted values without inline styles", () => {
    const html = createTagDetailsElement({
      name: '<v1 onclick="alert(1)">',
      hash: "6f8f9a36e8344a25f699403e5cd2f79c930d0d47",
      tagType: "annotated",
      message: "<script>alert(2)</script>"
    });
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(html).not.toContain("<v1");
    expect(html).not.toContain("<script>");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("[style]")).toBeNull();
    expect(document.querySelector(".tag-details-value")?.textContent).toBe(
      '<v1 onclick="alert(1)">'
    );
    expect(document.querySelector(".tag-details-message")?.textContent).toBe(
      "<script>alert(2)</script>"
    );
  });

  it("omits absent metadata for lightweight tags", () => {
    const document = new DOMParser().parseFromString(
      createTagDetailsElement(parseForCatFileTag("", "v1")),
      "text/html"
    );

    expect(document.querySelector(".tag-details-message")).toBeNull();
    expect(
      [...document.querySelectorAll(".tag-details-label")].map((element) => element.textContent)
    ).toEqual(["Name", "Hash", "Type"]);
  });
});
