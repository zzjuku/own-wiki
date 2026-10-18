// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));

import type { Field, Infobox, PageInfo, Template } from "./api";
import {
  changeTemplate,
  cleanValue,
  contrastText,
  convertValue,
  formatDate,
  infoboxHtml,
  instantiate,
  newFieldKey,
  valueProblem,
  type BoxContext,
} from "./infobox";
import { NameIndex } from "./names";

const pages: PageInfo[] = [
  { id: "Page A.md", title: "Page A", group: "", aliases: [] },
  { id: "Page B.md", title: "Page B", group: "", aliases: ["Alias B"] },
];
const names = new NameIndex(pages);
const ctx: BoxContext = { project: "Project A", title: "Page A", links: { resolve: (n) => names.resolve(n), currentId: "Page A.md" } };

const f = (label: string, type: Field["type"], value?: unknown, extra: Partial<Field> = {}): Field => ({ label, type, value, ...extra });

describe("infoboxHtml", () => {
  it("shows filled fields with their section headings, and colours the box", () => {
    const ib: Infobox = {
      color: "#203040",
      fields: [
        f("Personal", "heading"),
        f("Name", "text", "**Bold** and [[Page B]]"),
        f("Empty", "text"),
        f("Unused section", "heading"),
        f("Nothing", "number"),
        f("Stats", "heading"),
        f("Age", "number", 1200),
        f("Alive", "yesno", false),
        f("Kind", "choice", "One", { options: { choices: ["One", "Two"] } }),
        f("Things", "list", ["first", "", "[[Missing]]"]),
      ],
    };
    const html = infoboxHtml(ib, ctx);
    expect(html).toContain('style="--infobox-header-bg:#203040;--infobox-header-text:#ffffff"');
    expect(html).toContain('<th colspan="2" class="infobox-title">Page A</th>');
    expect(html).toContain(">Personal<");
    expect(html).not.toContain("Unused section");
    expect(html).not.toContain("Empty");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain('data-page="Page B.md"');
    expect(html).toContain("1,200");
    expect(html).toContain(">No<");
    expect(html).toContain("first<br>");
    expect(html).toContain('class="wikilink new"');
  });

  it("is empty without values, except as a template preview", () => {
    const ib: Infobox = { fields: [f("A", "text"), f("S", "heading")] };
    expect(infoboxHtml(ib, ctx)).toBe("");
    expect(infoboxHtml(null, ctx)).toBe("");
    const preview = infoboxHtml(ib, { ...ctx, placeholders: true });
    expect(preview).toContain("infobox-placeholder");
  });

  it("escapes labels and shows values that don't fit as plain text", () => {
    const ib: Infobox = { fields: [f("<b>x</b>", "number", "<i>not a number</i>")] };
    const html = infoboxHtml(ib, ctx);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;not a number&lt;/i&gt;");
  });

  it("merges linked-from and two-way entries", () => {
    const ib: Infobox = {
      fields: [
        f("Children", "linkedfrom", undefined, { options: { from: ["Father", "mother"] } }),
        f("Spouse", "links", ["Alias B"], { options: { twoWay: true } }),
      ],
    };
    const incoming = [
      { field: "Father", id: "Page B.md", title: "Page B", twoWay: false },
      { field: "Spouse", id: "Page B.md", title: "Page B", twoWay: true },
      { field: "Spouse", id: "Page C.md", title: "Page C", twoWay: true },
      { field: "Spouse", id: "Page D.md", title: "Page D", twoWay: false },
    ];
    const html = infoboxHtml(ib, { ...ctx, incoming });
    const children = html.slice(html.indexOf("Children"), html.indexOf("Spouse"));
    expect(children).toContain("Page B");
    const spouse = html.slice(html.indexOf("Spouse"));
    // Page B is already there through its alias; Page C is added; Page D isn't two-way.
    expect(spouse.match(/data-page="Page B.md"/g)?.length).toBe(1);
    expect(spouse).toContain("Page C");
    expect(spouse).not.toContain("Page D");
  });

  it("shows images with captions", () => {
    const ib: Infobox = { fields: [f("Picture", "image", { file: "Image A.png", caption: "A *caption*" })] };
    const html = infoboxHtml(ib, ctx);
    expect(html).toContain('src="wikiasset://localhost/Project%20A%2FImage%20A.png"');
    expect(html).toContain("<em>caption</em>");
  });
});

describe("values", () => {
  it("knows values that don't fit", () => {
    expect(valueProblem(f("A", "number", 3))).toBeNull();
    expect(valueProblem(f("A", "number", "x"))).toBe("This isn't a number.");
    expect(valueProblem(f("A", "choice", "Three", { options: { choices: ["One"] } }))).toContain("isn't one of the options");
    expect(valueProblem(f("A", "list", "x"))).not.toBeNull();
    expect(valueProblem(f("A", "text"))).toBeNull();
    // A caption typed before an image is chosen is fine.
    expect(valueProblem(f("A", "image", { caption: "x" }))).toBeNull();
    expect(valueProblem(f("A", "image", "x.png"))).not.toBeNull();
  });

  it("converts values like the Rust side", () => {
    expect(convertValue("x", "list")).toEqual(["x"]);
    expect(convertValue(["x"], "text")).toBe("x");
    expect(convertValue(["x", "y"], "text")).toEqual(["x", "y"]);
    expect(convertValue(" 12 ", "number")).toBe(12);
    expect(convertValue("abc", "number")).toBe("abc");
    expect(convertValue(4, "text")).toBe("4");
  });

  it("stores empty values as nothing", () => {
    expect(cleanValue("  ")).toBeUndefined();
    expect(cleanValue(["", "a"])).toEqual(["a"]);
    expect(cleanValue([""])).toBeUndefined();
    expect(cleanValue(0)).toBe(0);
    expect(cleanValue(false)).toBe(false);
  });

  it("formats dates", () => {
    expect(formatDate({ year: 250, era: "AC", qualifier: "c" })).toBe("c. 250 AC");
    expect(formatDate({ year: -40 })).toBe("−40");
    expect(formatDate({ year: 250, month: 3, day: 12, era: "AC" })).toBe("12.3.250 AC");
    expect(formatDate({ start: { year: 283, era: "AC" }, end: { year: 298, era: "AC" } })).toBe("283 – 298 AC");
    expect(formatDate({ start: { year: 283, era: "AC" }, end: { year: 5, era: "NE" } })).toBe("283 AC – 5 NE");
    expect(formatDate({ start: { year: 283, era: "AC" }, end: "present" })).toBe("283 AC – present");
    expect(formatDate({ start: { year: 1, qualifier: "after" }, end: { year: 9, qualifier: "before" } })).toBe("after 1 – before 9");
  });

  it("picks readable text on a colour", () => {
    expect(contrastText("#cedff2")).toBe("#202122");
    expect(contrastText("#102030")).toBe("#ffffff");
  });

  it("makes unique field keys", () => {
    const fields: Field[] = [];
    for (let i = 0; i < 200; i++) fields.push({ key: newFieldKey(fields), label: "x", type: "text" });
    expect(new Set(fields.map((x) => x.key)).size).toBe(200);
    expect(fields[0].key).toMatch(/^f-[0-9a-z]{4}$/);
  });
});

describe("templates", () => {
  const t: Template = {
    id: "t-2",
    name: "Template B",
    color: "#d5e8d4",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "age", label: "Age", type: "number" },
    ],
  };

  it("instantiates without values", () => {
    expect(instantiate(t)).toEqual({ template: "t-2", color: "#d5e8d4", fields: t.fields });
  });

  it("changes template: same names keep values, the rest become hidden", () => {
    const ib: Infobox = {
      template: "t-1",
      color: "#ffffff",
      ownColor: true,
      fields: [
        { key: "n", label: "name", type: "text", value: "Kept" },
        { key: "a", label: "Age", type: "text", value: "30" },
        { key: "x", label: "Other", type: "text", value: "Hidden now" },
        { key: "e", label: "Empty", type: "text" },
      ],
    };
    const next = changeTemplate(ib, t);
    expect(next.template).toBe("t-2");
    expect(next.color).toBe("#ffffff");
    expect(next.fields).toEqual([
      { key: "name", label: "Name", type: "text", value: "Kept" },
      { key: "age", label: "Age", type: "number", value: 30 },
    ]);
    expect(next.hidden).toEqual([{ label: "Other", type: "text", value: "Hidden now" }]);
    expect(changeTemplate({ ...ib, ownColor: false }, t).color).toBe("#d5e8d4");
  });
});
