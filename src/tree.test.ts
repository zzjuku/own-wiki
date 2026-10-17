import { describe, expect, it } from "vitest";
import type { PageInfo, Tree } from "./api";
import { NameIndex } from "./names";
import {
  allGroupsInOrder,
  buildIndex,
  canMoveGroupInto,
  countInside,
  groupChain,
  remapId,
  visibleRows,
} from "./tree";

const page = (id: string, title: string): PageInfo => ({
  id,
  title,
  group: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "",
  aliases: [],
});

const tree: Tree = {
  groups: [
    { id: "b group", name: "b group" },
    { id: "A group", name: "A group" },
    { id: "A group/Sub", name: "Sub" },
    { id: "Empty", name: "Empty" },
  ],
  pages: [
    page("Page 10.md", "Page 10"),
    page("Page 2.md", "Page 2"),
    page("A group/Inner.md", "Inner"),
    page("A group/Sub/Deep.md", "Deep"),
    page("b group/Other.md", "Other"),
  ],
};

describe("tree", () => {
  it("lists groups first, alphabetically, numbers in natural order", () => {
    const rows = visibleRows(buildIndex(tree), new Set());
    expect(rows.map((r) => r.label)).toEqual(["A group", "b group", "Empty", "Page 2", "Page 10"]);
    expect(rows.find((r) => r.id === "Empty")?.empty).toBe(true);
  });

  it("shows children of expanded groups only, indented", () => {
    const rows = visibleRows(buildIndex(tree), new Set(["A group", "A group/Sub"]));
    expect(rows.map((r) => `${r.depth}:${r.label}`)).toEqual([
      "0:A group",
      "1:Sub",
      "2:Deep",
      "1:Inner",
      "0:b group",
      "0:Empty",
      "0:Page 2",
      "0:Page 10",
    ]);
    // A collapsed parent hides an expanded child.
    const collapsed = visibleRows(buildIndex(tree), new Set(["A group/Sub"]));
    expect(collapsed.some((r) => r.label === "Deep")).toBe(false);
  });

  it("counts contents at any depth", () => {
    const index = buildIndex(tree);
    expect(countInside(index, "A group")).toEqual({ pages: 2, groups: 1 });
    expect(countInside(index, "Empty")).toEqual({ pages: 0, groups: 0 });
  });

  it("remaps ids after a group rename or move", () => {
    expect(remapId("A group/Sub/Deep.md", "A group", "X/A group")).toBe("X/A group/Sub/Deep.md");
    expect(remapId("A group", "A group", "B")).toBe("B");
    expect(remapId("A groupie/x", "A group", "B")).toBe("A groupie/x");
  });

  it("blocks moving a group into itself", () => {
    expect(canMoveGroupInto("A", "A")).toBe(false);
    expect(canMoveGroupInto("A", "A/Sub")).toBe(false);
    expect(canMoveGroupInto("A", "AB")).toBe(true);
    expect(canMoveGroupInto("A/Sub", "")).toBe(true);
  });

  it("chains and picker order", () => {
    expect(groupChain("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
    expect(groupChain("")).toEqual([]);
    expect(allGroupsInOrder(buildIndex(tree)).map((g) => `${g.depth}:${g.name}`)).toEqual([
      "0:A group",
      "1:Sub",
      "0:b group",
      "0:Empty",
    ]);
  });
});

describe("NameIndex.search", () => {
  const pages = [
    "Example field",
    "Page A",
    "Page AB",
    "Another page",
    "Säge",
    "page a",
    "Grand (Page A)",
  ].map((t) => page(`${t}.md`, t));
  const titles = (q: string) => new NameIndex(pages).search(q).map((e) => e.name);

  it("ranks exact, prefix, word start, then contains", () => {
    expect(titles("page a")).toEqual([
      "Page A",
      "page a",
      "Page AB",
      "Grand (Page A)",
      "Another page",
    ]);
    expect(titles("age")).toEqual([
      "Another page",
      "Grand (Page A)",
      "Page A",
      "page a",
      "Page AB",
      "Säge",
    ]);
  });

  it("ignores accents, matches all words, empty lists everything", () => {
    expect(titles("sage")).toEqual(["Säge"]);
    expect(titles("grand a")).toEqual(["Grand (Page A)"]);
    expect(titles("  ")).toHaveLength(pages.length);
  });

  it("is fast with thousands of pages", () => {
    const many = Array.from({ length: 20000 }, (_, i) => page(`P${i}.md`, `Page ${i}`));
    const names = new NameIndex(many);
    const start = performance.now();
    expect(names.search("page 1999")[0].name).toBe("Page 1999");
    expect(performance.now() - start).toBeLessThan(200);
  });
});
