// Search (M10) for the in-memory backend: the real matching rules
// (src/search.ts, the same as Rust's), with a simplified idea of what's on a
// page (plain text of each line, infobox values as short text, spoilers).
import type { Infobox, SearchHit, SearchPart, SearchRequest, SearchResults } from "../../../src/api";
import { valueText } from "../../../src/infobox";
import { findInText, parseQuery } from "../../../src/search";

export interface SearchPage {
  id: string;
  title: string;
  aliases: string[];
  body: string;
  infobox: Infobox | null;
  categories: string[];
}

interface Seg {
  place: string;
  rank: number;
  text: string;
  spoilers: [number, number][];
  hidden?: boolean;
}

/** Plain text of a line: spoilers recorded, links show their text, emphasis and block marks dropped. */
function plain(line: string): { text: string; spoilers: [number, number][] } {
  let text = "";
  const spoilers: [number, number][] = [];
  const src = line
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*)/, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\*\*|__|\*/g, "");
  let rest = src;
  for (let m = /\|\|([^|\s][^\n]*?)\|\|/.exec(rest); m; m = /\|\|([^|\s][^\n]*?)\|\|/.exec(rest)) {
    text += rest.slice(0, m.index);
    spoilers.push([text.length, text.length + m[1].length]);
    text += m[1];
    rest = rest.slice(m.index + m[0].length);
  }
  return { text: text + rest, spoilers };
}

function segs(pg: SearchPage): Seg[] {
  const out: Seg[] = [{ place: "Title", rank: 0, text: pg.title, spoilers: [] }];
  for (const a of pg.aliases) out.push({ place: "Alias", rank: 1, text: a, spoilers: [] });
  for (const f of pg.infobox?.fields ?? []) {
    if (f.type === "heading" || f.type === "divider" || f.value === undefined || f.value === null) continue;
    const p = plain(f.type === "links" || f.type === "list" ? (f.value as string[]).join(", ") : valueText(f));
    out.push({ place: `Infobox: ${f.label}`, rank: 2, ...p, hidden: !!f.spoiler });
  }
  let place = "Text";
  const sections = new Map<string, Seg>();
  for (const line of pg.body.split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) place = `Section: ${plain(h[1]).text}`;
    if (!line.trim() || /^\{\{.*\}\}$/.test(line.trim())) continue;
    const p = plain(line);
    const seg = sections.get(place) ?? { place, rank: 3, text: "", spoilers: [] };
    if (!sections.has(place)) sections.set(place, seg);
    const at = seg.text ? seg.text.length + 1 : 0;
    seg.text += (seg.text ? " " : "") + p.text;
    seg.spoilers.push(...p.spoilers.map(([a, b]) => [a + at, b + at] as [number, number]));
  }
  return [...out, ...sections.values()];
}

const overlaps = (list: [number, number][], a: number, b: number) => list.some(([s, e]) => s < b && a < e);

function snippet(seg: Seg, hits: [number, number][], spoilers: boolean): SearchPart[] {
  const spoilerRanges: [number, number][] = seg.hidden ? [[0, seg.text.length]] : seg.spoilers;
  const cuts = [...new Set([0, seg.text.length, ...hits.flat(), ...spoilerRanges.flat()])].sort((a, b) => a - b);
  const parts: SearchPart[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const spoiler = spoilerRanges.some(([s, e]) => s <= a && b <= e);
    const hit = hits.some(([s, e]) => s <= a && b <= e);
    if (spoiler && !spoilers) {
      if (!parts.at(-1)?.spoiler) parts.push({ text: "", spoiler: true });
    } else parts.push({ text: seg.text.slice(a, b), ...(hit ? { hit } : {}), ...(spoiler ? { spoiler } : {}) });
  }
  return parts;
}

export function search(
  pages: SearchPage[],
  catTexts: { name: string; text: string }[],
  req: SearchRequest,
  parent: (id: string) => string,
): SearchResults {
  const terms = parseQuery(req.query);
  if (!terms.length) return { hits: [], total: 0, terms };
  const filtered = !!(req.group || req.category || req.template);
  const docs: { kind: "page" | "category"; id: string; title: string; group: string; segs: Seg[] }[] = pages
    .filter((pg) => !req.group || parent(pg.id) === req.group || pg.id.startsWith(`${req.group}/`))
    .filter((pg) => !req.category || pg.categories.some((c) => c.toLowerCase() === req.category!.toLowerCase()))
    .filter((pg) => !req.template || pg.infobox?.template === req.template)
    .map((pg) => ({ kind: "page", id: pg.id, title: pg.title, group: parent(pg.id), segs: segs(pg) }));
  if (!filtered)
    for (const c of catTexts) docs.push({ kind: "category", id: c.name, title: c.name, group: "", segs: [{ place: "Category text", rank: 3, ...plain(c.text.replace(/\n/g, " ")) }] });
  const found: (SearchHit & { rank: number })[] = [];
  for (const d of docs) {
    const perSeg = d.segs.map((seg) =>
      seg.hidden && !req.spoilers
        ? []
        : findInText(seg.text, terms).filter(([a, b]) => req.spoilers || !overlaps(seg.spoilers, a, b)),
    );
    const all = terms.every((t) => d.segs.some((seg, i) => perSeg[i].some(([a, b]) => findInText(seg.text.slice(a, b), [t]).length)));
    if (!all) continue;
    const places = d.segs
      .map((seg, i) => ({ seg, hits: perSeg[i] }))
      .filter((x) => x.hits.length && x.seg.place !== "Title")
      .map((x) => ({ place: x.seg.place, parts: snippet(x.seg, x.hits, req.spoilers), count: x.hits.length }));
    found.push({
      kind: d.kind, id: d.id, title: d.title, group: d.group,
      count: perSeg.reduce((n, h) => n + h.length, 0),
      places: places.slice(0, 3), morePlaces: Math.max(0, places.length - 3),
      rank: Math.min(...d.segs.filter((_, i) => perSeg[i].length).map((s) => s.rank)),
    });
  }
  found.sort((a, b) => a.rank - b.rank || b.count - a.count || a.title.localeCompare(b.title, undefined, { numeric: true }));
  return { hits: found.slice(0, req.limit ?? 100).map(({ rank: _, ...h }) => h), total: found.length, terms };
}
