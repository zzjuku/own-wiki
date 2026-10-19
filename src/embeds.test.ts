// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { embedOnLine, embedSource, embedTargets, parseEmbed } from "./embedSyntax";
import { renderWithEmbeds, type EmbedEnv, type EmbedSource } from "./embeds";
import { renderPage, sectionSource, type LinkContext } from "./markdown";
import type { PageInfo } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

const PAGES: EmbedSource[] = [
  { id: "A.md", title: "Page A", body: "Text of A with [[Page C]].\n\n## Part one\n\nOne[^1].\n\n### Deeper\n\nDeep.\n\n## Part two\n\nTwo.\n\n[^1]: Note.", infobox: { fields: [{ label: "Field", type: "text", value: "Value A" }] } },
  { id: "B.md", title: "Page B", body: "B embeds A:\n\n{{Page A#Part two}}", infobox: null },
  { id: "L1.md", title: "Loop 1", body: "{{Loop 2}}", infobox: null },
  { id: "L2.md", title: "Loop 2", body: "{{Loop 1}}", infobox: null },
  ...[1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `D${i}.md`, title: `Deep ${i}`, body: `Level ${i}\n\n{{Deep ${i + 1}}}`, infobox: null })),
];
const info = (p: EmbedSource): PageInfo => ({ id: p.id, title: p.title, group: "", aliases: [] });
const links: LinkContext = {
  resolve: (n) => {
    const p = PAGES.find((x) => x.title.toLowerCase() === n.trim().toLowerCase());
    return p ? { page: info(p) } : null;
  },
  currentId: "H.md",
};
const env = (hostId = "H.md"): EmbedEnv => ({ project: "P", sources: new Map(PAGES.map((p) => [p.id, p])), hostId, frame: () => ({ width: 250, height: 300 }) });
const doc = (src: string, e: EmbedEnv | null = env()) => new DOMParser().parseFromString(renderWithEmbeds(src, { tocBox: false, links }, e).html, "text/html");

describe("embed syntax", () => {
  it("reads and writes the three kinds", () => {
    expect(parseEmbed("Page A")).toEqual({ page: "Page A", section: null, infobox: false, box: null });
    expect(parseEmbed(" Page A # Part one ")).toEqual({ page: "Page A", section: "Part one", infobox: false, box: null });
    expect(parseEmbed("Page A|Infobox")).toEqual({ page: "Page A", section: null, infobox: true, box: null });
    expect(parseEmbed("Page A#S|collapsed")).toEqual({ page: "Page A", section: "S", infobox: false, box: "closed" });
    expect(parseEmbed("Page A|infobox|collapsible")?.box).toBe("open");
    expect(parseEmbed("Page A|other")).toBeNull();
    expect(parseEmbed("Category:X")).toBeNull();
    expect(embedSource({ page: "Page A", section: "Part one", infobox: false, box: null })).toBe("{{Page A#Part one}}");
    expect(embedSource({ page: "Page A", section: null, infobox: true, box: null })).toBe("{{Page A|infobox}}");
    expect(embedSource({ page: "Page A", section: "S", infobox: false, box: "closed" })).toBe("{{Page A#S|collapsed}}");
    expect(embedSource({ page: "Page A", section: null, infobox: true, box: "open" })).toBe("{{Page A|infobox|collapsible}}");
    expect(embedOnLine("  {{Page A}} ")?.page).toBe("Page A");
    expect(embedOnLine("text {{Page A}}")).toBeNull();
    expect(embedTargets("{{A}}\n```\n{{B}}\n```\n{{C#x}}")).toEqual(["A", "C"]);
  });

  it("finds one section with its notes", () => {
    expect(sectionSource(PAGES[0].body, "part one")).toBe("One[^1].\n\n### Deeper\n\nDeep.\n\n[^1]: Note.\n");
    expect(sectionSource(PAGES[0].body, "Part two")).toBe("Two.\n\n");
    expect(sectionSource(PAGES[0].body, "Nope")).toBeNull();
  });
});

describe("embeds", () => {
  it("shows the whole page: infobox and text, links still links", () => {
    const d = doc("Host text.\n\n{{Page A}}\n\nAfter.");
    const e = d.querySelector(".embed")!;
    expect(e.querySelector(".infobox")?.textContent).toContain("Value A");
    expect(e.textContent).toContain("Text of A with Page C.");
    expect(e.querySelector("a.wikilink.new")?.getAttribute("data-target")).toBe("Page C");
    expect(e.querySelector(".embed-open")?.getAttribute("data-page")).toBe("A.md");
    expect(d.body.textContent).toContain("After.");
  });

  it("keeps embedded headings out of the host's contents and ids", () => {
    const r = renderWithEmbeds("## Host one\n\n{{Page A}}\n\n## Host two\n\n## Host three", { tocBox: false, links }, env());
    expect(r.toc.map((t) => t.text)).toEqual(["Host one", "Host two", "Host three"]);
    const d = new DOMParser().parseFromString(r.html, "text/html");
    expect(d.querySelector(".embed h2")?.id).toBe("");
    expect(d.querySelector(".embed .footnote-ref a")?.getAttribute("href")).toBe("#e1-cite-note-1");
    expect(d.querySelector(".embed [id='e1-cite-note-1']")).not.toBeNull();
  });

  it("shows one section, or only the infobox", () => {
    const s = doc("{{Page A#Part one}}").querySelector(".embed")!;
    expect(s.textContent).toContain("One");
    expect(s.textContent).toContain("Deep.");
    expect(s.textContent).not.toContain("Two.");
    const i = doc("{{Page A|infobox}}").querySelector(".embed")!;
    expect(i.querySelector(".infobox")).not.toBeNull();
    expect(i.textContent).not.toContain("Text of A");
    expect(doc("{{Page B|infobox}}").querySelector(".embed-warning")?.textContent).toContain("no infobox");
    expect(doc("{{Page A#Nope}}").querySelector(".embed-warning")?.textContent).toContain("no section");
  });

  it("nests, and blocks self-embeds, loops and too deep embeds", () => {
    expect(doc("{{Page B}}").querySelectorAll(".embed .embed").length).toBe(1);
    expect(doc("{{Page A}}", env("A.md")).querySelector(".embed-warning")?.textContent).toContain("can't embed itself");
    expect(doc("{{Loop 1}}").querySelector(".embed .embed .embed-warning")?.textContent).toContain("loop");
    const deep = doc("{{Deep 1}}");
    expect(deep.body.textContent).toContain("Level 5");
    expect(deep.body.textContent).not.toContain("Level 6");
    expect(deep.querySelector(".embed-warning")?.textContent).toContain("5 levels");
  });

  it("can be a collapsible box with a title bar", () => {
    const closed = doc("{{Page A|collapsed}}").querySelector("details.embed-box")!;
    expect(closed.hasAttribute("open")).toBe(false);
    expect(closed.querySelector("summary a.wikilink")?.getAttribute("data-page")).toBe("A.md");
    expect(closed.querySelector(".embed-box-body")?.textContent).toContain("Text of A");
    expect(doc("{{Page A#Part two|collapsible}}").querySelector("details.embed-box")?.hasAttribute("open")).toBe(true);
  });

  it("shows a red box for a missing page and waits for content", () => {
    const m = doc("{{Page Z}}").querySelector("a.embed-missing")!;
    expect(m.classList.contains("new")).toBe(true);
    expect(m.getAttribute("data-target")).toBe("Page Z");
    expect(doc("{{Page A}}", { ...env(), sources: new Map() }).querySelector(".embed-loading")).not.toBeNull();
  });

  it("is plain text without the Markdown (no slot left behind)", () => {
    expect(renderPage("{{Page A}}").embeds).toEqual([{ page: "Page A", section: null, infobox: false, box: null }]);
    expect(doc("{{Page A}}", null).querySelector(".embed-slot")).toBeNull();
  });
});
