// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CategoryIndex, categoryOf, fileMembers, isReservedName, letterOf } from "./categories";
import { renderPage } from "./markdown";

const m = (title: string, sort: string | null = null) => ({ id: `${title}.md`, title, group: "", sort });

describe("categories", () => {
  it("reads category link targets", () => {
    expect(categoryOf("Category:Cat A")).toBe("Cat A");
    expect(categoryOf(" category: Cat A")).toBe("Cat A");
    expect(categoryOf("Page")).toBeNull();
    expect(isReservedName("Category:X") && isReservedName("file: x.png") && !isReservedName("Files")).toBe(true);
  });

  it("files pages by Sort as, else title, under letters", () => {
    const groups = fileMembers([m("Page b"), m("Page A"), m("The Example", "Example"), m("Ébauche"), m("2nd"), m("_x")]);
    expect(groups.map((g) => [g.letter, g.members.map((x) => x.title)])).toEqual([
      ["#", ["_x"]],
      ["0–9", ["2nd"]],
      ["E", ["Ébauche", "The Example"]],
      ["P", ["Page A", "Page b"]],
    ]);
    expect(letterOf("ärger")).toBe("A");
  });

  it("finds categories", () => {
    const idx = new CategoryIndex([
      { name: "Cat B", pages: 1, subcategories: 0, parents: [], hasFile: false },
      { name: "Example cat", pages: 2, subcategories: 0, parents: [], hasFile: false },
    ]);
    expect(idx.resolve("cat b")?.name).toBe("Cat B");
    expect(idx.search("cat").map((c) => c.name)).toEqual(["Cat B", "Example cat"]);
  });

  it("renders [[Category:…]] links, red when missing", () => {
    const html = renderPage("[[Category:Cat A]] [[Category:Gone|x]]", {
      links: { resolve: () => null, category: (n) => n === "Cat A" },
    }).html;
    expect(html).toContain('<a class="wikilink catlink" href="#" data-category="Cat A" data-target="Category:Cat A">Category:Cat A</a>');
    expect(html).toContain('class="wikilink catlink new"');
    const self = renderPage("[[Category:Cat A]]", { links: { resolve: () => null, currentCategory: "cat a" } }).html;
    expect(self).toContain('<strong class="selflink">');
  });
});
