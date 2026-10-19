// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { gallerySource, imageAtStart, imageSource, parseImage } from "./images";
import { infoboxHtml } from "./infobox";
import { plainText, renderInline, renderPage } from "./markdown";
import { parseQuote, quoteAround, quoteSource } from "./quotes";
import { hasSpoilers, spoilerRanges, toggleSpoiler } from "./spoilers";
import type { LinkContext } from "./markdown";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

const links: LinkContext = { resolve: () => null };
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** Runs the Spoiler command on text where `^` marks the cursor or `{`…`}` a selection. */
function run(input: string): string {
  const doc = input.replace(/[\^{}]/g, "");
  const caret = input.indexOf("^");
  const sel = caret >= 0 ? EditorSelection.cursor(caret) : EditorSelection.range(input.indexOf("{"), input.indexOf("}") - 1);
  let state = EditorState.create({ doc, selection: sel });
  toggleSpoiler({ state, dispatch: (tr: Transaction) => (state = tr.state) });
  const { from, to } = state.selection.main;
  const out = state.doc.toString();
  return from === to ? out.slice(0, from) + "^" + out.slice(from) : out.slice(0, from) + "{" + out.slice(from, to) + "}" + out.slice(to);
}

describe("spoiler syntax", () => {
  it("hides text, links and formatting inside", () => {
    const d = doc(renderPage("A ||secret [[Page B|b]] **bold**|| end and ||two||.", { links }).html);
    const spoilers = d.querySelectorAll(".spoiler");
    expect(spoilers.length).toBe(2);
    expect(spoilers[0].textContent).toBe("secret b bold");
    expect(spoilers[0].querySelector("a.wikilink")?.getAttribute("data-target")).toBe("Page B");
    expect(spoilers[1].textContent).toBe("two");
  });

  it("is not a spoiler across lines, empty, or escaped", () => {
    for (const src of ["||a\nb||", "|| ||", "||||", "a || b", "\\|\\|x\\|\\|", "`||code||`"]) {
      expect(hasSpoilers(renderPage(src).html), src).toBe(false);
    }
  });

  it("works in tables (written \\|\\| there), infobox values and captions", () => {
    expect(doc(renderPage("| A |\n|---|\n| \\|\\|x\\|\\| |").html).querySelector("td .spoiler")?.textContent).toBe("x");
    expect(renderInline("a ||b||")).toContain('class="spoiler"');
    const img = parseImage(imageAtStart(imageSource({ file: "A.png", pos: "right", size: "medium", caption: "x ||y||" }))!.inner);
    expect(img.caption).toBe("x ||y||");
    expect(doc(renderPage(imageSource(img)).html).querySelector(".wiki-caption .spoiler")?.textContent).toBe("y");
  });

  it("finds spoiler ranges in source lines", () => {
    expect(spoilerRanges("a ||b|| c ||d||")).toEqual([
      { from: 2, to: 7, marker: 2 },
      { from: 10, to: 15, marker: 2 },
    ]);
    expect(spoilerRanges("| \\|\\|x\\|\\| |", true)).toEqual([{ from: 2, to: 11, marker: 4 }]);
  });

  it("keeps heading spoilers hidden in the contents, with shared keys", () => {
    const r = renderPage("## One ||secret|| part\n\n## Two\n\n## Three", { links });
    expect(r.toc[0].text).toBe("One secret part");
    expect(r.toc[0].parts).toEqual([
      { text: "One ", spoiler: false },
      { text: "secret", spoiler: true },
      { text: " part", spoiler: false },
    ]);
    const h = doc(r.html).querySelector("h2 .spoiler") as HTMLElement;
    expect(h.dataset.sp).toBe("h:one-secret-part:0");
    expect(doc(renderPage("## A ||b||\n\n## C\n\n## D").html).querySelector(".toc .spoiler")?.getAttribute("data-sp")).toBe("h:a-b:0");
  });

  it("counts spoiler words", () => {
    expect(plainText("A ||b c||.")).toBe("A b c.");
  });
});

describe("Spoiler button", () => {
  it("wraps a selection or the word at the cursor", () => {
    expect(run("a {word} b")).toBe("a ||{word}|| b");
    expect(run("a wo^rd b")).toBe("a ||wo^rd|| b");
    expect(run("a ^ b")).toBe("a ||^|| b");
  });

  it("removes the markers when inside a spoiler", () => {
    expect(run("a ||wo^rd|| b")).toBe("a wo^rd b");
    expect(run("a ||{word}|| b")).toBe("a {word} b");
  });

  it("wraps each selected line on its own, and writes \\|\\| in tables", () => {
    expect(run("{one\ntwo}")).toBe("||{one||\n||two}||");
    expect(run("| a {b} |")).toBe("| a \\|\\|{b}\\|\\| |");
    expect(run("| a \\|\\|b^\\|\\| |")).toBe("| a b^ |");
  });
});

describe("spoiler images, galleries and infobox fields", () => {
  it("reads and writes the spoiler option", () => {
    const src = imageSource({ file: "A.png", pos: "left", size: "small", caption: "Cap", spoiler: true });
    expect(src).toBe("[[File:A.png|left|small|spoiler|Cap]]");
    expect(parseImage(imageAtStart(src)!.inner)).toEqual({ file: "A.png", pos: "left", size: "small", caption: "Cap", spoiler: true });
    expect(doc(renderPage(src).html).querySelector(".wiki-image")?.className).toContain("spoiler spoiler-media");
    expect(gallerySource([{ file: "A.png", caption: "" }], true)).toBe("<gallery spoiler>\nA.png\n</gallery>");
    expect(doc(renderPage("<gallery spoiler>\nA.png\n</gallery>").html).querySelector(".wiki-gallery.spoiler")).not.toBeNull();
  });

  it("hides a whole field value and an image field", () => {
    const html = infoboxHtml(
      {
        fields: [
          { label: "Field A", type: "text", value: "Shown" },
          { label: "Field B", type: "yesno", value: true, spoiler: true },
          { label: "Field C", type: "longtext", value: "Para", spoiler: true },
          { label: "Picture", type: "image", value: { file: "a.png", caption: "Cap" }, spoiler: true },
        ],
      },
      { project: "P", title: "Page A", links },
    );
    const d = doc(html);
    expect(d.querySelectorAll(".infobox-value")[0].querySelector(".spoiler")).toBeNull();
    expect(d.querySelectorAll(".infobox-value")[1].querySelector("span.spoiler")?.textContent).toBe("Yes");
    expect(d.querySelectorAll(".infobox-value")[2].querySelector("div.spoiler-block")).not.toBeNull();
    expect(d.querySelector(".infobox-image .spoiler-media img")).not.toBeNull();
  });
});

describe("infobox dividers", () => {
  const box = (fields: { label: string; type: "text" | "divider" | "heading"; value?: string }[]) =>
    doc(infoboxHtml({ fields }, { project: "P", title: "Page A", links })).querySelectorAll(".infobox-divider");

  it("shows a line with an optional label between values", () => {
    const d = box([
      { label: "A", type: "text", value: "1" },
      { label: "Label", type: "divider" },
      { label: "B", type: "text", value: "2" },
    ]);
    expect(d.length).toBe(1);
    expect(d[0].textContent).toBe("Label");
  });

  it("leaves out dividers with nothing on one side", () => {
    expect(box([{ label: "", type: "divider" }, { label: "A", type: "text", value: "1" }, { label: "", type: "divider" }]).length).toBe(0);
    expect(
      box([
        { label: "A", type: "text", value: "1" },
        { label: "", type: "divider" },
        { label: "B", type: "text" },
      ]).length,
    ).toBe(0);
  });
});

describe("quote boxes", () => {
  const q = { text: "Line one\n\nLine **two** ||x||", by: "[[Page A]]", source: "Book B" };

  it("writes and reads a quote box", () => {
    const src = quoteSource(q);
    expect(src).toBe("<quote>\nLine one\n\nLine **two** ||x||\n<by>[[Page A]]</by>\n<source>Book B</source>\n</quote>");
    expect(parseQuote(src)).toEqual(q);
    expect(parseQuote(src.split("\n").slice(1, -1))).toEqual(q);
    expect(quoteSource({ text: "Only", by: " ", source: "" })).toBe("<quote>\nOnly\n</quote>");
  });

  it("renders quote, paragraphs and credit", () => {
    const d = doc(renderPage(`Before\n\n${quoteSource(q)}\n\nAfter`, { links }).html);
    const box = d.querySelector("figure.quote-box")!;
    expect(box.querySelectorAll(".quote-text p").length).toBe(2);
    expect(box.querySelector(".quote-text .spoiler")?.textContent).toBe("x");
    expect(box.querySelector(".quote-by")?.textContent).toBe("— Page A, Book B");
    expect(box.querySelector(".quote-by a.wikilink")).not.toBeNull();
    expect(d.body.textContent).toContain("After");
  });

  it("finds the quote box around a line", () => {
    const lines = ["x", "<quote>", "a", "<by>b</by>", "</quote>", "y"];
    expect(quoteAround(lines, 2)).toEqual({ start: 1, end: 4 });
    expect(quoteAround(lines, 5)).toBeNull();
  });

  it("keeps quote text that looks like its tags inside the box", () => {
    const src = quoteSource({ text: "a\n</quote>\nb", by: "", source: "" });
    expect(parseQuote(src).text).toBe("a\n&lt;/quote>\nb");
    expect(doc(renderPage(src).html).querySelector(".quote-text")?.textContent).toContain("</quote>");
  });
});
