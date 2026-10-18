// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { galleryAround, gallerySource, imageAtStart, imageSource, parseGallery, parseImage } from "./images";
import { plainText, renderPage } from "./markdown";

describe("image syntax", () => {
  it("finds an image with links in its caption", () => {
    const src = "[[File:A.png|left|small|See [[Page B|b]] here]] after";
    const m = imageAtStart(src)!;
    expect(src.slice(0, m.length)).toBe("[[File:A.png|left|small|See [[Page B|b]] here]]");
    expect(parseImage(m.inner)).toEqual({ file: "A.png", pos: "left", size: "small", caption: "See [[Page B|b]] here" });
  });

  it("defaults to right, medium, no caption", () => {
    expect(parseImage("File: A (2).svg ")).toEqual({ file: "A (2).svg", pos: "right", size: "medium", caption: "" });
    expect(parseImage("file:A.png|centre|Cap|large").pos).toBe("center");
  });

  it("is not an image when unclosed or across lines", () => {
    expect(imageAtStart("[[File:A.png|cap [[B]]")).toBeNull();
    expect(imageAtStart("[[File:A.png|cap\n]]")).toBeNull();
    expect(imageAtStart("[[Page]]")).toBeNull();
  });

  it("writes images back, keeping plain | in captions", () => {
    const img = { file: "A.png", pos: "full" as const, size: "large" as const, caption: "a | b [[P|q]]" };
    const src = imageSource(img);
    expect(src).toBe("[[File:A.png|full|large|a &#124; b [[P|q]]]]");
    expect(parseImage(imageAtStart(src)!.inner).caption).toBe("a &#124; b [[P|q]]");
    expect(imageSource(img, true)).toBe("[[File:A.png\\|full\\|large\\|a &#124; b [[P\\|q]]]]");
    expect(parseImage(imageAtStart(imageSource(img, true))!.inner)).toMatchObject({ pos: "full", size: "large" });
  });

  it("never writes an image that an unfinished link would break", () => {
    const src = imageSource({ file: "A.png", pos: "right", size: "medium", caption: "x ]] y [[B]] [[Page" });
    expect(src).toBe("[[File:A.png|right|medium|x ] y [[B]] [Page]]");
    expect(imageAtStart(src)!.length).toBe(src.length);
  });
});

describe("galleries", () => {
  it("reads and writes gallery lines", () => {
    const items = parseGallery(["A.png|Cap [[B|b]]", "", "File:C.jpg", "  D.svg | x "]);
    expect(items).toEqual([
      { file: "A.png", caption: "Cap [[B|b]]" },
      { file: "C.jpg", caption: "" },
      { file: "D.svg", caption: "x" },
    ]);
    expect(gallerySource(items)).toBe("<gallery>\nA.png|Cap [[B|b]]\nC.jpg\nD.svg|x\n</gallery>");
  });

  it("finds the gallery around a line", () => {
    const lines = ["x", "<gallery>", "A.png", "</gallery>", "y"];
    expect(galleryAround(lines, 2)).toEqual({ start: 1, end: 3 });
    expect(galleryAround(lines, 1)).toEqual({ start: 1, end: 3 });
    expect(galleryAround(lines, 3)).toEqual({ start: 1, end: 3 });
    expect(galleryAround(lines, 4)).toBeNull();
    expect(galleryAround(lines, 0)).toBeNull();
  });
});

describe("rendering images", () => {
  const links = { resolve: () => null, image: (f: string, w?: number) => `wikiasset://localhost/P%2F${f}${w ? `?w=${w}` : ""}` };
  const doc = (src: string) => new DOMParser().parseFromString(renderPage(src, { links }).html, "text/html");

  it("shows an image with position, size and caption", () => {
    const d = doc("Text [[File:A.png|left|small|A *b* [[Page C]]]] more");
    const box = d.querySelector(".wiki-image")!;
    expect(box.className).toBe("wiki-image pos-left size-small");
    const img = box.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("wikiasset://localhost/P%2FA.png?w=160");
    expect(img.getAttribute("data-full")).toBe("wikiasset://localhost/P%2FA.png");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(box.querySelector(".wiki-caption em")?.textContent).toBe("b");
    expect(box.querySelector(".wiki-caption a.wikilink.new")?.textContent).toBe("Page C");
  });

  it("leaves no empty line after an image on its own line", () => {
    const html = renderPage("[[File:A.png]]\n[[File:B.png]]\nText\nmore [[File:C.png]]\nend", { links }).html;
    expect(html).not.toContain("<!--");
    expect(html.match(/<br>/g)?.length).toBe(2);
    expect(html).toMatch(/<\/span>Text<br>/);
  });

  it("shows a gallery", () => {
    const d = doc("<gallery>\nA.png|One\nB.svg\n</gallery>\n\nAfter");
    const items = [...d.querySelectorAll(".wiki-gallery figure")];
    expect(items.map((f) => f.getAttribute("data-file"))).toEqual(["A.png", "B.svg"]);
    expect(items[0].querySelector("figcaption")?.textContent).toBe("One");
    expect(d.querySelector("p")?.textContent).toBe("After");
  });

  it("leaves images out of the word count", () => {
    expect(plainText("One [[File:A.png|Caption words]] two\n\n<gallery>\nA.png|More\n</gallery>")).toBe("One two");
  });
});
