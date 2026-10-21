import { describe, expect, it } from "vitest";
import { buildModel, DEFAULT_FILTERS, edgeLabel, type GraphData, type GraphFilters } from "./model";

// Nodes 0–3 are pages, 4 is a red link.
const DATA: GraphData = {
  pages: [
    { id: "Page A.md", title: "Page A", categories: ["Category A"], template: "t-1" },
    { id: "Group A/Page B.md", title: "Page B", categories: ["category a", "Category B"] },
    { id: "Group A/Sub/Page C.md", title: "Page C", template: "t-1" },
    { id: "Page D.md", title: "Page D" },
  ],
  missing: ["Missing X"],
  links: [
    { a: 0, b: 1, ab: true, ba: true, text: true, fields: [{ name: "Father" }, { name: "Secret", spoiler: true }] },
    { a: 1, b: 2, ba: true, fields: [{ name: "Spouse" }] },
    { a: 0, b: 4, ab: true, text: true },
  ],
};
const EXTRAS = { categories: [{ name: "Category A", parents: ["Category Top"] }, { name: "Category B", parents: [] }, { name: "Category Top", parents: [] }] };
const build = (f: Partial<GraphFilters> = {}) => buildModel(DATA, EXTRAS, { ...DEFAULT_FILTERS, ...f });
const keys = (f: Partial<GraphFilters> = {}) => build(f).nodes.map((n) => n.key);

describe("graph model", () => {
  it("shows every page and page link; red links only when switched on", () => {
    const m = build();
    expect(m.nodes.map((n) => n.key)).toEqual(["p:Page A.md", "p:Group A/Page B.md", "p:Group A/Sub/Page C.md", "p:Page D.md"]);
    expect(m.edges.map((e) => e.key)).toEqual(["l:0:1", "l:1:2"]);
    expect(m.nodes.map((n) => n.degree)).toEqual([1, 2, 1, 0]);
    expect(keys({ redLinks: true })).toContain("r:missing x");
    expect(build({ redLinks: true }).edges.find((e) => e.key === "l:0:4")).toMatchObject({ source: "p:Page A.md", target: "r:missing x" });
  });

  it("points one-way lines from the linking page", () => {
    const e = build().edges.find((x) => x.key === "l:1:2")!;
    expect(e).toMatchObject({ source: "p:Group A/Sub/Page C.md", target: "p:Group A/Page B.md", forward: true, backward: false });
    expect(build().edges[0]).toMatchObject({ forward: true, backward: true });
  });

  it("filters by group (with subgroups), category and template, and hides orphans", () => {
    expect(keys({ group: "Group A" })).toEqual(["p:Group A/Page B.md", "p:Group A/Sub/Page C.md"]);
    expect(keys({ group: "Group A/Sub" })).toEqual(["p:Group A/Sub/Page C.md"]);
    expect(keys({ category: "CATEGORY A" })).toEqual(["p:Page A.md", "p:Group A/Page B.md"]);
    expect(keys({ template: "t-1" })).toEqual(["p:Page A.md", "p:Group A/Sub/Page C.md"]);
    expect(keys({ hideOrphans: true })).not.toContain("p:Page D.md");
    // A line to a page filtered out isn't drawn.
    expect(build({ template: "t-1" }).edges).toEqual([]);
  });

  it("switches text links and infobox links separately", () => {
    expect(build({ fieldLinks: false }).edges.map((e) => e.key)).toEqual(["l:0:1"]);
    expect(build({ fieldLinks: false }).edges[0].fields).toEqual([]);
    expect(build({ textLinks: false }).edges.map((e) => e.key)).toEqual(["l:0:1", "l:1:2"]);
    expect(build({ textLinks: false, fieldLinks: false }).edges).toEqual([]);
    expect(keys({ textLinks: false, fieldLinks: false, hideOrphans: true })).toEqual([]);
  });

  it("adds category nodes with their members and parent categories", () => {
    const m = build({ categories: true });
    expect(m.nodes.filter((n) => n.kind === "category").map((n) => n.label)).toEqual(["Category A", "Category Top", "Category B"]);
    const lines = m.edges.filter((e) => e.kind !== "link").map((e) => `${e.source} > ${e.target}`);
    expect(lines).toEqual([
      "c:category a > c:category top",
      "p:Page A.md > c:category a",
      "p:Group A/Page B.md > c:category a",
      "p:Group A/Page B.md > c:category b",
    ]);
  });

  it("adds group nodes with the pages directly inside and parent groups", () => {
    const m = build({ groups: true });
    expect(m.nodes.filter((n) => n.kind === "group").map((n) => [n.key, n.label])).toEqual([
      ["g:Group A", "Group A"],
      ["g:Group A/Sub", "Sub"],
    ]);
    const lines = m.edges.filter((e) => e.kind !== "link").map((e) => `${e.source} > ${e.target}`);
    expect(lines).toEqual(["p:Group A/Page B.md > g:Group A", "g:Group A/Sub > g:Group A", "p:Group A/Sub/Page C.md > g:Group A/Sub"]);
  });

  it("labels lines with field names, spoiler fields only while spoilers are shown", () => {
    const e = build().edges[0];
    expect(edgeLabel(e, false)).toBe("Father");
    expect(edgeLabel(e, true)).toBe("Father, Secret");
    expect(edgeLabel(build({ redLinks: true }).edges.find((x) => x.key === "l:0:4")!, true)).toBe("");
  });
});
