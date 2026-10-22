// Family tree data (M12) for the in-memory backend, as src-tauri/src/family.rs makes it.
import type { Infobox, ProjectSettings } from "../../../src/api";
import type { FamilyData, FamilyPerson, LifeDate, ParentLink, PartnerLink } from "../../../src/family/data";

interface Page {
  id: string;
  title: string;
  aliases: string[];
  infobox: Infobox | null;
}

const lc = (s: string) => s.trim().toLowerCase();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string");
const LINK = /\[\[([^\]|#]*)[^\]]*\]\]/;

/** The page and the words around it of a Page link entry ("[[Bea]] (m. 283)"). */
function entry(v: string): { target: string; words?: string } {
  const m = LINK.exec(v);
  if (!m) return { target: v.split("#")[0].trim() };
  const words = (v.slice(0, m.index) + " " + v.slice(m.index + m[0].length)).split(/\s+/).filter(Boolean).join(" ");
  return { target: m[1].trim(), ...(words ? { words } : {}) };
}

function life(ib: Infobox | null, role: string): LifeDate | undefined {
  for (const f of ib?.fields ?? []) {
    if ((f.type !== "date" && f.type !== "dateplace") || f.options?.age !== role || !f.value) continue;
    let v = f.value as any;
    if (f.type === "dateplace") v = (Array.isArray(v) ? v[0] : v)?.date;
    const p = v?.start ?? v;
    if (typeof p?.year !== "number") continue;
    return { year: p.year, month: p.month, day: p.day, era: p.era, qualifier: p.qualifier, ...(f.spoiler ? { spoiler: true } : {}) };
  }
  return undefined;
}

export function familyData(pages: Page[], settings: ProjectSettings): FamilyData {
  const ft = { parents: settings.familyTree?.parents ?? [], partners: settings.familyTree?.partners ?? [] };
  const index = (list: { field: string }[], name: string) => list.findIndex((f) => f.field.trim() && lc(f.field) === lc(name));
  const byName = new Map<string, Page>();
  pages.forEach((p) => p.aliases.forEach((a) => byName.has(lc(a)) || byName.set(lc(a), p)));
  pages.forEach((p) => byName.set(lc(p.title), p));
  const people: FamilyPerson[] = [];
  const at = new Map<string, number>();
  const person = (name: string): number | null => {
    if (!name.trim() || /^category:/i.test(name.trim())) return null;
    const p = byName.get(lc(name));
    const key = p ? `p:${p.id}` : `m:${lc(name)}`;
    if (!at.has(key)) {
      at.set(key, people.length);
      people.push(
        p
          ? { id: p.id, title: p.title, ...(p.aliases.length ? { aliases: p.aliases } : {}), template: p.infobox?.template ?? undefined, birth: life(p.infobox, "birth"), death: life(p.infobox, "death") }
          : { title: name.trim() },
      );
    }
    return at.get(key)!;
  };
  const parents = new Map<string, ParentLink>();
  const addParent = (l: ParentLink) => {
    if (l.child === l.parent) return;
    const k = `${l.child}-${l.parent}`;
    const o = parents.get(k);
    if (!o) return void parents.set(k, l);
    o.spoiler = !!o.spoiler && !!l.spoiler;
    if (l.field < o.field) Object.assign(o, { field: l.field, pos: l.pos });
  };
  const partners: PartnerLink[] = [];
  for (const pg of pages) {
    const counts = new Map<string, number>();
    const next = (f: string) => {
      const n = counts.get(lc(f)) ?? 0;
      counts.set(lc(f), n + 1);
      return n;
    };
    for (const f of pg.infobox?.fields ?? []) {
      const spoiler = !!f.spoiler;
      if (f.type === "linkedfrom") {
        const fields = (f.options?.from ?? []).map((n: string) => index(ft.parents, n)).filter((i: number) => i >= 0);
        if (!fields.length) continue;
        for (const v of strings(f.value)) {
          const me = person(pg.title)!;
          const child = person(entry(v).target);
          if (child !== null) addParent({ child, parent: me, field: Math.min(...fields), pos: next(f.label), spoiler, typed: true });
        }
      } else if (f.type === "links" || f.type === "link") {
        const pi = index(ft.parents, f.label);
        const ri = index(ft.partners, f.label);
        for (const v of strings(f.value)) {
          const { target, words } = entry(v);
          if (!target) continue;
          const me = person(pg.title)!;
          const other = person(target);
          if (other === null) continue;
          if (pi >= 0) addParent({ child: me, parent: other, field: pi, pos: next(f.label), spoiler });
          else if (ri >= 0 && other !== me) partners.push({ a: me, b: other, field: ri, pos: next(f.label), spoiler, words });
        }
      }
    }
  }
  return { settings: ft, people, parents: [...parents.values()], partners };
}

/** Page link field names on pages. */
export function linkFieldNames(pages: Page[]): string[] {
  const out = new Map<string, string>();
  for (const p of pages) for (const f of p.infobox?.fields ?? []) if ((f.type === "links" || f.type === "link") && !out.has(lc(f.label))) out.set(lc(f.label), f.label);
  return [...out.values()];
}
