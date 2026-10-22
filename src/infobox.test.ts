// @vitest-environment jsdom
import { minZoom, pictureStyle, placement } from "./infobox";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));

import type { Field, Infobox, PageInfo, Template } from "./api";
import { notesFrom, remapNotes } from "./notes";
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

  it("shows fields placed above, below and beside the title in the title area", () => {
    const ib: Infobox = {
      fields: [
        f("Title", "text", "Example title", { options: { place: "above" } }),
        f("Nickname", "text", "the [[Page B]]", { options: { place: "below" }, spoiler: true }),
        f("Arms", "image", { file: "Arms.png" }, { options: { place: "beside" } }),
        f("Example field", "text", "Example value"),
      ],
    };
    const html = infoboxHtml(ib, ctx);
    const title = html.slice(html.indexOf("infobox-title"), html.indexOf("Example field"));
    expect(title).toMatch(/infobox-title-above">Example title<\/div><div class="infobox-title-name">Page A<\/div><div class="infobox-title-below"><span class="spoiler"/);
    // One picture: on both sides, the copy marked as such.
    expect(title.match(/<img class="infobox-title-picture/g)?.length).toBe(2);
    expect(title).toContain("infobox-title-copy");
    // Placed fields don't show again as rows.
    expect(html.match(/infobox-label/g)?.length).toBe(1);
    // Only title-area fields: the box still shows.
    expect(infoboxHtml({ fields: [ib.fields[0]] }, ctx)).toContain("Example title");
    // "Also in the box": shown in the title area and as a row.
    const both = infoboxHtml({ fields: [f("Title", "text", "Example title", { options: { place: "above", inBox: true } })] }, ctx);
    expect(both.match(/Example title/g)?.length).toBe(2);
    expect(both).toContain("infobox-label");
    // A place the type can't have is ignored.
    expect(infoboxHtml({ fields: [f("Count", "number", 3, { options: { place: "above" } })] }, ctx)).toContain("infobox-label");
  });

  it("Date, place and Date, text fields: a date with text after it, one entry or several", () => {
    const ib: Infobox = {
      fields: [
        f("Born", "dateplace", { date: { year: 283, era: "AC" }, text: "[[Page B]]" }),
        f("Reign", "datetext", [
          { date: { start: { year: 283 }, end: { year: 298, era: "AC" } }, text: "King" },
          { date: { year: 300, era: "AC" }, text: "Lord" },
        ], { options: { multiple: true, ranges: true } }),
      ],
    };
    const html = infoboxHtml(ib, ctx);
    // The place goes on its own line under the date.
    expect(html).toMatch(/283 AC<br><a class="wikilink"[^>]*>Page B<\/a>/);
    expect(html).toContain('283 – 298 AC <span class="infobox-date-note">King</span><br>300 AC <span class="infobox-date-note">Lord</span>');
    expect(valueProblem(ib.fields[1])).toBeNull();
    expect(valueProblem(f("X", "datetext", "text"))).not.toBeNull();
    expect(convertValue({ year: 5 }, "dateplace")).toEqual({ date: { year: 5 } });
    expect(convertValue({ date: { year: 5 } }, "date")).toEqual({ year: 5 });
  });

  it("shows words around a Page link value; the link stays a link", () => {
    const html = infoboxHtml({ fields: [f("Father", "links", ["Lord [[Page B]] (supposedly)", "Page A"])] }, ctx);
    expect(html).toMatch(/Lord <a class="wikilink"[^>]*data-page="Page B.md"[^>]*>Page B<\/a> \(supposedly\)<br><strong class="selflink">Page A<\/strong>/);
  });

  it("shows ages after birth and death dates", () => {
    const born = (v: unknown, extra: Partial<Field> = {}) => f("Born", "dateplace", v, { options: { age: "birth" }, ...extra });
    const died = (v: unknown, extra: Partial<Field> = {}) => f("Died", "date", v, { options: { age: "death" }, ...extra });
    const today = { year: 300, month: 5, era: "AC" };
    // Alive: age to the present day (not yet had this year's birthday: one less).
    let html = infoboxHtml({ fields: [born({ date: { year: 283, month: 6, era: "AC" }, text: "Place" }), died(undefined)] }, { ...ctx, presentDay: today });
    expect(html).toContain('283 AC <span class="infobox-age">(age 16)</span><br>Place');
    // Without a present day: no age.
    expect(infoboxHtml({ fields: [born({ date: { year: 283 } })] }, ctx)).not.toContain("infobox-age");
    // Dead: aged at the death date; the birth date shows no age.
    html = infoboxHtml({ fields: [born({ date: { year: 231, qualifier: "c" } }), died({ year: 300 })] }, { ...ctx, presentDay: today });
    expect(html).toContain('300 <span class="infobox-age">(aged c. 69)</span>');
    expect(html.match(/infobox-age/g)?.length).toBe(1);
    // A death field with only a place still means no age "now".
    html = infoboxHtml({ fields: [born({ date: { year: 283 } }), f("Died", "dateplace", { text: "Place" }, { options: { age: "death" } })] }, { ...ctx, presentDay: today });
    expect(html).not.toContain("infobox-age");
    // Different eras can't be compared yet; a hidden birth date hides the age at death too.
    expect(infoboxHtml({ fields: [born({ date: { year: 5, era: "BC" } })] }, { ...ctx, presentDay: today })).not.toContain("infobox-age");
    html = infoboxHtml({ fields: [born({ date: { year: 231 } }, { spoiler: true }), died({ year: 300 })] }, ctx);
    expect(html).toMatch(/<span class="spoiler"[^>]*><span class="infobox-age">\(aged 69\)/);
  });

  it("merges linked-from and two-way entries", () => {
    const ib: Infobox = {
      fields: [
        f("Children", "linkedfrom", undefined, { options: { from: ["Father", "mother"] } }),
        f("Spouse", "links", ["Alias B"], { options: { twoWay: true } }),
      ],
    };
    const incoming = [
      { field: "Father", id: "Page B.md", title: "Page B", twoWay: false, spoiler: false },
      { field: "Spouse", id: "Page B.md", title: "Page B", twoWay: true, spoiler: false },
      { field: "Spouse", id: "Page C.md", title: "Page C", twoWay: true, spoiler: false },
      { field: "Spouse", id: "Page D.md", title: "Page D", twoWay: false, spoiler: false },
    ];
    const html = infoboxHtml(ib, { ...ctx, relations: { incoming, values: {} } });
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
    expect(html).toContain('data-full="wikiasset://localhost/Project%20A%2FImage%20A.png"');
    expect(html).toContain("<em>caption</em>");
  });

  it("places zoomed pictures in the frame", () => {
    const frame = { width: 200, height: 200 };
    // A 2:1 picture filling a square frame is twice as wide as the frame.
    expect(placement({ x: 0, y: 50, zoom: 1, aspect: 2 }, frame)).toEqual({ width: 200, height: 100, left: 0, top: 0 });
    expect(placement({ x: 100, y: 50, zoom: 1, aspect: 2 }, frame)).toEqual({ width: 200, height: 100, left: -100, top: 0 });
    // Zoomed out to the whole picture: half as high as the frame, centred.
    expect(minZoom(2, frame)).toBe(0.5);
    expect(placement({ x: 50, y: 50, zoom: 0.1, aspect: 2 }, frame)).toEqual({ width: 100, height: 50, left: 0, top: 25 });
    // Without a zoom it simply fills the frame.
    expect(placement({ x: 10, y: 20 }, frame)).toBeNull();
    expect(pictureStyle({ x: 10, y: 20 }, frame)).toBe("object-position:10% 20%");
    expect(pictureStyle({ x: 50, y: 50, zoom: 2, aspect: 1 }, frame)).toBe("position:absolute;max-width:none;max-height:none;width:200%;height:200%;left:-50%;top:-50%");
  });

  it("puts images in the frame, cropped where chosen, and widens the box for it", () => {
    const ib: Infobox = { fields: [f("Picture", "image", { file: "Image A.png", crop: { x: 20, y: 0 } })] };
    const html = infoboxHtml(ib, { ...ctx, frame: { width: 400, height: 200 } });
    expect(html).toContain('style="--frame-width:400px"');
    expect(html).toContain('<span class="infobox-frame" style="width:400px;aspect-ratio:400 / 200">');
    expect(html).toContain('src="wikiasset://localhost/Project%20A%2FImage%20A.png?w=800"');
    expect(html).toContain('style="object-position:20% 0%"');
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

describe("field notes (M13)", () => {
  it("show before or after their entry, formatted, on every kind of field", () => {
    const ib: Infobox = {
      fields: [
        { label: "House", type: "links", value: ["Page B", "Page C"], notes: [{ i: 1, text: "*(by marriage)*" }] },
        { label: "Titles", type: "list", value: ["A", "B"], notes: [{ i: 0, text: "(claimed)", before: true }] },
        { label: "Size", type: "number", value: 5, notes: [{ i: 0, text: "(about)" }] },
        { label: "Battles", type: "datetext", value: [{ date: { year: 290 }, text: "Battle A" }], notes: [{ i: 0, text: "(won)" }] },
        { label: "Kids", type: "linkedfrom", options: { from: ["Father"] }, value: ["Typed X"], notes: [{ i: 0, text: "(adopted)" }] },
        { label: "Broken", type: "text", value: "Value", notes: [{ i: 0, text: "" }, { i: "x", text: "y" } as never] },
      ],
    };
    const html = infoboxHtml(ib, ctx);
    expect(html).toContain('Page C</a> <span class="infobox-note"><em>(by marriage)</em></span>');
    expect(html).toContain('<span class="infobox-note">(claimed)</span> A');
    expect(html).toContain('5 <span class="infobox-note">(about)</span>');
    expect(html).toContain('290 <span class="infobox-note">(won)</span> <span class="infobox-date-note">Battle A</span>');
    expect(html).toContain('Typed X</a> <span class="infobox-note">(adopted)</span>');
    // Empty or broken notes are left out.
    expect(html).toMatch(/Value<\/td>/);
  });

  it("are kept in place when entries go", () => {
    expect(notesFrom([null, { text: " x " }, { text: "" }, { text: "y", before: true }])).toEqual([{ i: 1, text: "x" }, { i: 3, text: "y", before: true }]);
    expect(remapNotes([{ i: 0, text: "a" }, { i: 2, text: "c" }], [2, 1])).toEqual([{ i: 0, text: "c" }]);
  });
});
