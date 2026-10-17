// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import cases from "../shared-tests/links.json";
import type { PageInfo } from "./api";
import { renderPage, type LinkContext } from "./markdown";
import { NameIndex } from "./names";
import { norm, parseInner, pipeTrick, shownText } from "./wikilinks";

function linksIn(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("a.wikilink, strong.selflink")].map((a) => ({
    page: a.getAttribute("data-target"),
    section: a.getAttribute("data-section"),
    text: a.textContent,
  }));
}

describe("shared link cases (same as the Rust parser)", () => {
  for (const c of cases.links) {
    it(c.name, () => {
      expect(linksIn(renderPage(c.input).html)).toEqual(c.links);
    });
  }
});

describe("shared section anchor cases", () => {
  for (const c of cases.anchors) {
    it(c.name, () => {
      const doc = new DOMParser().parseFromString(renderPage(c.input).html, "text/html");
      expect([...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => h.id)).toEqual(c.anchors);
    });
  }
});

const page = (id: string, title: string, aliases: string[] = []): PageInfo => ({
  id,
  title,
  group: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "",
  aliases,
});

describe("rendering with a project", () => {
  const names = new NameIndex([page("G/A.md", "Page A", ["Nick"]), page("B.md", "Page B")]);
  const ctx: LinkContext = { resolve: (n) => names.resolve(n), currentId: "B.md" };
  const html = (src: string) => renderPage(src, { links: ctx }).html;

  it("links existing pages by title or alias, any case", () => {
    expect(html("[[page a]]")).toContain(`<a class="wikilink" href="#" data-target="page a" data-page="G/A.md">page a</a>`);
    expect(html("[[NICK|n]]")).toContain(`data-page="G/A.md" data-via="Nick">n</a>`);
  });

  it("shows missing pages as red links", () => {
    expect(html("[[Missing]]")).toContain(`<a class="wikilink new" href="#" data-target="Missing">Missing</a>`);
  });

  it("shows links to the page itself as bold text, but section links stay links", () => {
    expect(html("[[Page B]]")).toContain(`<strong class="selflink">Page B</strong>`);
    expect(html("[[Page B#Later]]")).toContain(`data-page="B.md">Page B § Later</a>`);
    expect(html("[[#Early Life]]")).toContain(`href="#early-life" data-target="" data-section="Early Life" data-page="B.md"`);
  });

  it("escapes what it shows", () => {
    expect(html(`[[Missing|<b>"x"</b>]]`)).toContain(`>&lt;b&gt;"x"&lt;/b&gt;</a>`);
  });
});

describe("link helpers", () => {
  it("parses the inside of a link", () => {
    expect(parseInner(" Page # Sec | shown ")).toEqual({ page: "Page", section: "Sec", label: "shown", suffix: "" });
    expect(parseInner("#")).toBeNull();
    expect(shownText(parseInner("A (B)|", "s")!)).toBe("As");
    expect(pipeTrick("(Only)")).toBe("(Only)");
    expect(norm("  Page   A ")).toBe("page a");
  });
});

describe("NameIndex", () => {
  const names = new NameIndex([
    page("A.md", "Page A", ["Old name"]),
    page("G/B.md", "Grand (Page A)"),
    page("C.md", "Säge"),
  ]);

  it("resolves titles before aliases, ignoring case and spaces", () => {
    expect(names.resolve(" page  a ")?.page.id).toBe("A.md");
    expect(names.resolve("OLD NAME")).toEqual({ page: names.entries.find((e) => e.alias)!.page, via: "Old name" });
    expect(names.resolve("nope")).toBeNull();
  });

  it("finds titles and aliases, best match first", () => {
    expect(names.search("page a").map((e) => e.name)).toEqual(["Page A", "Grand (Page A)"]);
    expect(names.search("old").map((e) => [e.name, e.alias])).toEqual([["Old name", true]]);
    expect(names.search("sage").map((e) => e.name)).toEqual(["Säge"]);
    expect(names.search("").map((e) => e.name)).toEqual(["Grand (Page A)", "Old name", "Page A", "Säge"]);
  });
});
