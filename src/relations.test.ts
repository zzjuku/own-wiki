// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));

import type { Field, IncomingField, PageInfo, Relations, Template } from "./api";
import { infoboxHtml } from "./infobox";
import { NameIndex } from "./names";
import { fromProblems, renameFieldInTemplates, reverseEntries, sortEntries, twoWayExtras, typedNames } from "./relations";

const pages: PageInfo[] = ["Page A", "Page B", "Page C", "Page D", "Page 10", "Page 9"].map((t) => ({ id: `${t}.md`, title: t, group: "", aliases: [] }));
pages[1].aliases = ["Alias B"];
const names = new NameIndex(pages);
const resolve = (n: string) => names.resolve(n);

const inc = (field: string, title: string, extra: Partial<IncomingField> = {}): IncomingField => ({
  field,
  id: `${title}.md`,
  title,
  twoWay: false,
  spoiler: false,
  ...extra,
});

const children = (options: Field["options"], value?: string[]): Field => ({ label: "Children", type: "linkedfrom", options, value });

describe("reverse fields", () => {
  const rel: Relations = {
    incoming: [
      inc("Father", "Page B", { template: "t-person" }),
      inc("mother", "Page C", { template: "t-person", spoiler: true }),
      inc("Location", "Page D", { template: "t-place" }),
      inc("Note", "Page C", { template: "t-person" }),
      inc("Father", "Page 10"),
      inc("Father", "Page 9"),
    ],
    values: { "Page B.md": { born: [250, 3, 0] }, "Page 10.md": { born: [250, 1, 0] } },
  };

  it("reads the named fields, case-insensitive, sorted by title (natural order)", () => {
    const got = reverseEntries(children({ from: ["Father", "Mother"] }), rel, resolve);
    expect(got.map((e) => [e.name, e.spoiler, e.typed])).toEqual([
      ["Page 9", false, false],
      ["Page 10", false, false],
      ["Page B", false, false],
      ["Page C", true, false],
    ]);
  });

  it("filters by template and merges typed-in names, each page once", () => {
    const f = children({ from: ["Father", "Mother", "Note"], templates: ["t-person"] }, ["Alias B", "Page Z", "page z", ""]);
    const got = reverseEntries(f, rel, resolve);
    // Page 10/9 have no template; Page C is open through Note; Alias B is Page B.
    expect(got.map((e) => [e.name, e.id, e.spoiler, e.typed, e.sources.length])).toEqual([
      ["Alias B", "Page B.md", false, true, 1],
      ["Page C", "Page C.md", false, false, 2],
      ["Page Z", null, false, true, 0],
    ]);
  });

  it("sorts by a date or number field; pages without it come last by title", () => {
    const got = reverseEntries(children({ from: ["Father"], sortBy: "born" }), rel, resolve);
    expect(got.map((e) => e.name)).toEqual(["Page 10", "Page B", "Page 9"]);
    const n = sortEntries(
      [
        { name: "B", id: "b" },
        { name: "A", id: "a" },
        { name: "C", id: "c" },
      ],
      "Chapter no.",
      { a: { "chapter no.": [12] }, b: { "chapter no.": [2] } },
    );
    expect(n.map((e) => e.name)).toEqual(["B", "A", "C"]);
  });

  it("two-way entries from other pages, not repeated when the field has them", () => {
    const r: Relations = {
      incoming: [inc("Spouse", "Page B", { twoWay: true }), inc("Spouse", "Page C", { twoWay: true, spoiler: true }), inc("Spouse", "Page D")],
      values: {},
    };
    const spouse: Field = { label: "spouse", type: "links", value: ["Alias B"] };
    expect(twoWayExtras(spouse, r, resolve).map((e) => [e.name, e.spoiler])).toEqual([["Page C", true]]);
    expect(twoWayExtras({ ...spouse, label: "Partner" }, r, resolve)).toEqual([]);
  });

  it("hides entries from spoiler fields in the infobox", () => {
    const ctx = { project: "Project A", title: "Page A", links: { resolve, currentId: "Page A.md" }, relations: rel };
    const html = infoboxHtml({ fields: [children({ from: ["Mother", "Father"] })] }, ctx);
    expect(html).toMatch(/<span class="spoiler"[^>]*><a class="wikilink"[^>]*data-page="Page C.md"/);
    expect(html).not.toMatch(/<span class="spoiler"[^>]*><a class="wikilink"[^>]*data-page="Page B.md"/);
    // A field that is a spoiler as a whole: one spoiler around all entries.
    const whole = infoboxHtml({ fields: [{ ...children({ from: ["Mother", "Father"] }), spoiler: true }] }, ctx);
    expect(whole.match(/class="spoiler"/g)?.length).toBe(1);
  });

  it("lists typed-in names for the backend", () => {
    expect(typedNames({ fields: [children({}, ["Page A#Early", " "]), { label: "X", type: "links", value: ["Page B"] }] })).toEqual(["Page A"]);
  });
});

describe("renameFieldInTemplates", () => {
  const t = (id: string, fields: Field[]): Template => ({ id, name: id, fields });
  const person = t("person", [
    { key: "a", label: "Sire", type: "links" },
    { key: "b", label: "Children", type: "linkedfrom", options: { from: ["Father", "Mother"], sortBy: "Born" } },
  ]);
  const place = t("place", [{ key: "c", label: "Born", type: "date" }]);

  it("renames the name in every Linked from field", () => {
    const out = renameFieldInTemplates([person, place], "father", "Sire");
    expect(out[0].fields[1].options).toEqual({ from: ["Sire", "Mother"], sortBy: "Born" });
    expect(out[1]).toBe(place);
  });

  it("adds the new name next to the old one while another template still uses it", () => {
    const other = t("other", [{ key: "d", label: "Father", type: "link" }]);
    const out = renameFieldInTemplates([person, other], "Father", "Sire");
    expect(out[0].fields[1].options?.from).toEqual(["Father", "Mother", "Sire"]);
  });

  it("follows the sort field, and changes nothing for blank or same names", () => {
    const born = renameFieldInTemplates([person, t("x", [{ key: "e", label: "Birth", type: "date" }])], "Born", "Birth");
    expect(born[0].fields[1].options?.sortBy).toBe("Birth");
    const list = [person, place];
    expect(renameFieldInTemplates(list, "Mother", " mother ")).toBe(list);
    expect(renameFieldInTemplates(list, "Mother", "")).toBe(list);
    expect(renameFieldInTemplates(list, "Nothing", "Else")).toBe(list);
  });
});

describe("fromProblems", () => {
  it("flags names no field has, and names only Linked from fields have", () => {
    const t: Template = {
      id: "t",
      name: "T",
      fields: [
        { label: "Father", type: "linkedfrom", options: { from: ["Children"] } },
        { label: "Children", type: "linkedfrom", options: { from: ["Father", "Mother"] } },
        { label: "Spouse", type: "links" },
      ],
    };
    expect(fromProblems([t], ["father", "Mother", "Spouse"])).toEqual([
      { name: "father", problem: "reverse" },
      { name: "Mother", problem: "missing" },
    ]);
  });
});
