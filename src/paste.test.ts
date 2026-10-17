// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./paste";

describe("htmlToMarkdown", () => {
  it("keeps basic formatting and drops colours, fonts and images", () => {
    const md = htmlToMarkdown(
      `<p><b>Bold</b>, <i>italic</i>, <s>gone</s> and <span style="color:red;font-family:Comic Sans">plain</span>.<img src="x.png"></p>`,
    );
    expect(md).toBe("**Bold**, *italic*, ~~gone~~ and plain.");
  });

  it("moves headings one level down", () => {
    expect(htmlToMarkdown("<h1>Big</h1><h2>Small</h2>")).toBe("## Big\n\n### Small");
  });

  it("keeps web links only", () => {
    expect(htmlToMarkdown(`<p><a href="https://example.com">web</a> <a href="/local">local</a></p>`)).toBe(
      "[web](https://example.com) local",
    );
  });

  it("converts lists and quotes", () => {
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul><blockquote><p>q</p></blockquote>")).toBe(
      "- a\n- b\n\n> q",
    );
  });

  it("converts tables, first row as header", () => {
    const md = htmlToMarkdown("<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>x|y</td></tr></table>");
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | x\\|y |");
  });

  it("reads Google Docs styling", () => {
    const html =
      `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">` +
      `<p><span style="font-weight:700">Strong</span> <span style="font-style:italic">slanted</span> ` +
      `<span style="text-decoration:line-through">struck</span></p></b>`;
    expect(htmlToMarkdown(html)).toBe("**Strong** *slanted* ~~struck~~");
  });

  it("nests Google Docs lists by aria-level", () => {
    const html = `<ul><li aria-level="1"><p>a</p></li></ul><ul><li aria-level="2"><p>b</p></li></ul><ul><li aria-level="1"><p>c</p></li></ul>`;
    expect(htmlToMarkdown(html)).toBe("- a\n  - b\n- c");
  });

  it("rebuilds Word lists", () => {
    const item = (level: number, marker: string, text: string) =>
      `<p class=MsoListParagraph style='mso-list:l0 level${level} lfo1'><span style='mso-list:Ignore'>${marker}<span>&nbsp;</span></span>${text}</p>`;
    const html = item(1, "1.", "One") + item(1, "2.", "Two") + `<p class=MsoNormal>After</p>`;
    expect(htmlToMarkdown(html)).toBe("1. One\n2. Two\n\nAfter");
  });
});

describe("plain HTML", () => {
  it("is left to the normal plain-text paste", () => {
    expect(htmlToMarkdown(`<span style="color:blue">a * b # c</span>`)).toBeNull();
  });

  it("but paragraphs still become paragraphs", () => {
    expect(htmlToMarkdown("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
  });
});
