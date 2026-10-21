// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));

import type { Infobox, IncomingField, PageInfo, Relations, Template } from "./api";
import { renderWithEmbeds } from "./embeds";
import { NameIndex } from "./names";
import { pageListOnLine, pageListSource } from "./pageLists";

const inc = (field: string, title: string, extra: Partial<IncomingField> = {}): IncomingField => ({ field, id: `${title}.md`, title, twoWay: false, spoiler: false, ...extra });
const templates: Template[] = [{ id: "t-ch", name: "Chapter", fields: [] }];

function setup(n = 4) {
  const pages: PageInfo[] = [{ id: "Place.md", title: "Place", group: "", aliases: [] }];
  for (let i = 1; i <= n; i++) pages.push({ id: `Page ${i}.md`, title: `Page ${i}`, group: "", aliases: [] });
  const names = new NameIndex(pages);
  const links = { resolve: (s: string) => names.resolve(s), currentId: "Place.md" };
  return { links };
}

describe("page list lines", () => {
  it("are written and read back", () => {
    const call = { from: ["Location", "Setting"], templates: ["Chapter"], sortBy: "Chapter no." };
    const line = pageListSource(call);
    expect(line).toBe('<pagelist from="Location, Setting" templates="Chapter" sort="Chapter no.">');
    expect(pageListOnLine(line)).toEqual({ ...call, field: undefined });
    expect(pageListOnLine("text <pagelist>")).toBeNull();
    expect(pageListSource({ from: ['A "B"'], templates: [] })).toBe('<pagelist from="A &quot;B&quot;">');
    expect(pageListOnLine(pageListSource({ from: ['A "B"'], templates: [] }))?.from).toEqual(['A "B"']);
  });

  it("list the pages whose fields point here: template filter, sort, spoilers; empty shows nothing", () => {
    const { links } = setup();
    const relations: Relations = {
      incoming: [
        inc("Location", "Page 2", { template: "t-ch" }),
        inc("Location", "Page 1", { template: "t-ch", spoiler: true }),
        inc("Location", "Page 3"),
        inc("Owner", "Page 4", { template: "t-ch" }),
      ],
      values: { "Page 2.md": { "chapter no.": [1] }, "Page 1.md": { "chapter no.": [2] } },
    };
    const text = 'Text.\n\n<pagelist from="location" templates="Chapter" sort="Chapter no.">\n\n<pagelist from="Nothing">\n';
    const html = renderWithEmbeds(text, { links }, null, { infobox: null, relations, templates }).html;
    expect(html).toMatch(/<ul class="page-list"><li><a[^>]*>Page 2<\/a><\/li><li><span class="spoiler"[^>]*><a[^>]*>Page 1<\/a><\/span><\/li><\/ul>/);
    expect(html).not.toContain("Page 3");
    expect(html.match(/page-list/g)?.length).toBe(1);
    // The editor preview says when a list is empty.
    expect(renderWithEmbeds("<pagelist from=\"Nothing\">", { links }, null, { infobox: null, relations, templates, preview: true }).html).toContain("no page points here yet");
  });

  it("Linked from fields shown as a list go to the bottom of the page, with a heading in Contents", () => {
    const { links } = setup();
    const infobox: Infobox = {
      fields: [
        { label: "Chapters", type: "linkedfrom", options: { from: ["Location"], show: "list", listHeading: "Chapters set here" } },
        { label: "Owned", type: "linkedfrom", options: { from: ["Owner"], show: "list" } },
        { label: "Empty", type: "linkedfrom", options: { from: ["Nothing"], show: "list" } },
      ],
    };
    const relations: Relations = { incoming: [inc("Location", "Page 1"), inc("Owner", "Page 4")], values: {} };
    const r = renderWithEmbeds("## Section A\n\nText.", { links, tocBox: false }, null, { infobox, relations, templates });
    expect(r.toc.map((t) => t.text)).toEqual(["Section A", "Chapters set here", "Owned"]);
    expect(r.html).toMatch(/<h2 id="chapters-set-here">Chapters set here<\/h2>\s*<ul class="page-list"><li><a[^>]*>Page 1<\/a>/);
    expect(r.html).not.toContain("Empty");
  });

  it("a list with 2,000 entries renders quickly (M9 speed target)", () => {
    const { links } = setup(2000);
    const relations: Relations = { incoming: Array.from({ length: 2000 }, (_, i) => inc("Location", `Page ${i + 1}`)), values: {} };
    const t = performance.now();
    const html = renderWithEmbeds('<pagelist from="Location">', { links }, null, { infobox: null, relations, templates }).html;
    const ms = performance.now() - t;
    expect(html.match(/<li>/g)?.length).toBe(2000);
    expect(ms).toBeLessThan(300);
  });
});
