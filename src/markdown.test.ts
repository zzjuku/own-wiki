// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { countWords, plainText, renderMarkdown, renderWithLineAnchors } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic Markdown", () => {
    const html = renderMarkdown("# Heading\n\nSome **bold** text.\n\n- item");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>item</li>");
  });

  it("strips scripts and event handlers", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
});

describe("line breaks", () => {
  it("one Enter is a line break, an empty line a new paragraph", () => {
    const html = renderMarkdown("a\nb\n\nc");
    expect(html).toContain("<p>a<br>b</p>");
    expect(html).toContain("<p>c</p>");
  });
});

describe("renderWithLineAnchors", () => {
  it("marks the source line of each block", () => {
    const html = renderWithLineAnchors("# One\n\npara\ngraph\n\n- a\n- b\n\nend");
    const lines = [...html.matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1]));
    expect(lines).toEqual([0, 2, 5, 8]);
  });
});

describe("word count", () => {
  it("counts the visible text, not Markdown symbols", () => {
    const text = plainText("## Head\n\nSome **bold** and *it*.\n\n- one\n- two\n\n---\n\n| a | b |\n|---|---|\n| c | d |");
    expect(text).toBe("Head Some bold and it. one two a b c d");
    expect(countWords(text)).toBe(11);
  });

  it("treats apostrophes and hyphens as part of a word", () => {
    expect(countWords("don't well-known e.g.")).toBe(4);
  });
});
