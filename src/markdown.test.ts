// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { countWords, plainText, renderMarkdown, renderPage } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic Markdown", () => {
    const html = renderMarkdown("# Heading\n\nSome **bold** text.\n\n- item");
    expect(html).toContain(`<h1 id="heading">Heading</h1>`);
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
    const { html } = renderPage("# One\n\npara\ngraph\n\n- a\n- b\n\nend", { lineAnchors: true });
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

describe("heading anchors", () => {
  it("are lower-case with dashes, repeats numbered", () => {
    const { html } = renderPage("## Early Life\n\n## Early Life\n\n## **Title**");
    expect(html).toContain(`<h2 id="early-life">`);
    expect(html).toContain(`<h2 id="early-life-2">`);
    // Kept even when the id matches a document property name.
    expect(html).toContain(`<h2 id="title">`);
  });
});

describe("table of contents", () => {
  it("appears after the intro once there are 3 headings, numbered", () => {
    const { html, toc } = renderPage("Intro text.\n\n## A\n\n### A1\n\n## B");
    expect(toc.map((e) => `${e.number} ${e.text}`)).toEqual(["1 A", "1.1 A1", "2 B"]);
    expect(html.indexOf("Intro text")).toBeLessThan(html.indexOf(`class="toc"`));
    expect(html.indexOf(`class="toc"`)).toBeLessThan(html.indexOf(`<h2 id="a">`));
    expect(html).toContain(`href="#a1"`);
  });

  it("can be left out of the text but still listed", () => {
    const { html, toc } = renderPage("## A\n\n## B\n\n## C", { tocBox: false });
    expect(html).not.toContain(`class="toc"`);
    expect(toc).toHaveLength(3);
  });

  it("is left out with fewer than 3 headings", () => {
    const { html, toc } = renderPage("## A\n\n## B");
    expect(toc).toEqual([]);
    expect(html).not.toContain("toc");
  });

  it("nests skipped levels one step", () => {
    const { toc } = renderPage("## A\n\n#### Deep\n\n## B");
    expect(toc.map((e) => e.number)).toEqual(["1", "1.1", "2"]);
  });
});

describe("footnotes", () => {
  const src = "First[^x] and second[^a], first again[^x].\n\n[^a]: Note A\n[^x]: Note X";

  it("numbers notes in order of appearance with links both ways", () => {
    const { html } = renderPage(src);
    expect(html).toContain(`<sup class="footnote-ref" id="cite-ref-1"><a href="#cite-note-1">[1]</a></sup>`);
    expect(html).toContain(`id="cite-ref-2"><a href="#cite-note-2">[2]</a>`);
    expect(html).toContain(`id="cite-ref-1-2"><a href="#cite-note-1">[1]</a>`);
    expect(html).toContain(`<li id="cite-note-1" value="1"><a class="footnote-back" href="#cite-ref-1"`);
    expect(html.indexOf("Note X")).toBeLessThan(html.indexOf("Note A"));
  });

  it("lists notes under a Notes heading at the end, included in the contents", () => {
    const { html, toc } = renderPage("## A\n\n## B\n\nText[^1]\n\n[^1]: The note");
    expect(html).toMatch(/<h2 id="notes">Notes<\/h2>\s*<ol class="footnotes">/);
    expect(toc.at(-1)).toMatchObject({ text: "Notes", number: "3" });
  });

  it("leaves an undefined marker as text", () => {
    expect(renderMarkdown("Text[^nope]")).toContain("Text[^nope]");
  });
});
