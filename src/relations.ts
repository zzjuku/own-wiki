// Relations through infobox fields (M9). A relation is stored once, on the
// specific side (John's *Father* links Alex); Alex's Linked from field
// *Children* ("pages whose Father or Mother points here") shows John from
// the link index. Two-way Page link fields (*Spouse*) show on both pages.
// Entries can also be typed in by hand on the reverse side. The backend side
// (incoming links, writing back into the other page) is src-tauri/src/relations.rs.
import type { Field, Infobox, IncomingField, Relations, Template } from "./api";
import type { LinkTarget } from "./names";
import { compareNames } from "./tree";
import { norm } from "./wikilinks";

export const NO_RELATIONS: Relations = { incoming: [], values: {} };

/** One page a Linked from field (or a two-way field) shows. */
export interface RelationEntry {
  /** The name shown and linked: the linking page's title, or the name typed in. */
  name: string;
  /** The page's id; null for a page that doesn't exist (red link). */
  id: string | null;
  /** Hidden until clicked: it only comes from spoiler fields. */
  spoiler: boolean;
  /** Typed in by hand on this page. */
  typed: boolean;
  /** The other pages' fields it comes from. */
  sources: IncomingField[];
}

const isLinkKind = (k: string) => k === "link" || k === "links";

/** A Page link value's page part ("Page" of "Page#Section"). */
const pagePart = (s: string) => s.split("#")[0].trim();

function stringList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

/** Incoming links a Linked from field shows: from the fields named in its
 * `from`, and (with a template filter) only from pages using those templates. */
export function computedFor(f: Field, rel: Relations | undefined): IncomingField[] {
  if (!rel?.incoming.length) return [];
  const from = (f.options?.from ?? []).map(norm);
  const templates = f.options?.templates ?? [];
  return rel.incoming.filter((i) => from.includes(norm(i.field)) && (!templates.length || (!!i.template && templates.includes(i.template))));
}

/** Two-way links from other pages to a Page link field with the same name. */
export function twoWayFor(f: Field, rel: Relations | undefined): IncomingField[] {
  if (!rel?.incoming.length || !isLinkKind(f.type)) return [];
  return rel.incoming.filter((i) => i.twoWay && norm(i.field) === norm(f.label));
}

/** Compares sort keys (a number, or year, month, day). */
function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Sorts by title (natural order), or by a number or date field of the
 * listed pages; pages without that value come last, by title. */
export function sortEntries<T extends { name: string; id: string | null }>(entries: T[], sortBy: string | undefined, values: Relations["values"]): T[] {
  const key = sortBy?.trim() ? norm(sortBy) : null;
  const value = (e: T) => (key && e.id ? values[e.id]?.[key] : undefined);
  return [...entries].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va && vb) return compareKeys(va, vb) || compareNames(a.name, b.name);
    if (va || vb) return va ? -1 : 1;
    return compareNames(a.name, b.name);
  });
}

/** Merges computed and typed-in entries: each page once (typed-in names of
 * the same missing page once too). A page is a spoiler only if every link
 * bringing it here is one. */
function merge(typed: string[], computed: IncomingField[], resolve: (name: string) => LinkTarget | null): RelationEntry[] {
  const byKey = new Map<string, RelationEntry>();
  for (const name of typed) {
    if (!pagePart(name)) continue;
    const id = resolve(pagePart(name))?.page.id ?? null;
    const key = id ?? `missing:${norm(pagePart(name))}`;
    if (!byKey.has(key)) byKey.set(key, { name: pagePart(name), id, spoiler: false, typed: true, sources: [] });
  }
  for (const i of computed) {
    const e = byKey.get(i.id);
    if (e) {
      e.sources.push(i);
      e.spoiler &&= i.spoiler;
    } else {
      byKey.set(i.id, { name: i.title, id: i.id, spoiler: i.spoiler, typed: false, sources: [i] });
    }
  }
  return [...byKey.values()];
}

/** What a Linked from field shows: computed and typed-in entries, sorted. */
export function reverseEntries(f: Field, rel: Relations | undefined, resolve: (name: string) => LinkTarget | null): RelationEntry[] {
  const entries = merge(stringList(f.value), computedFor(f, rel), resolve);
  return sortEntries(entries, f.options?.sortBy, rel?.values ?? {});
}

/** Two-way entries from other pages that a Page link field doesn't hold itself. */
export function twoWayExtras(f: Field, rel: Relations | undefined, resolve: (name: string) => LinkTarget | null): RelationEntry[] {
  const own = new Set(stringList(f.value).map((v) => resolve(pagePart(v))?.page.id ?? `missing:${norm(pagePart(v))}`));
  return merge([], twoWayFor(f, rel), resolve).filter((e) => !own.has(e.id!));
}

/** Names typed into an infobox's Linked from fields (the backend sends their sort values). */
export function typedNames(ib: Infobox | null | undefined): string[] {
  return (ib?.fields ?? []).filter((f) => f.type === "linkedfrom").flatMap((f) => stringList(f.value).map(pagePart).filter(Boolean));
}

/**
 * A template field was renamed from `old` to `next`: Linked from fields of
 * every template that read it (`from`, `sortBy`) follow. While another
 * template still has a field named `old`, the new name is added next to the
 * old one instead, so pages of that template keep showing up.
 */
export function renameFieldInTemplates(templates: Template[], old: string, next: string): Template[] {
  if (!old.trim() || !next.trim() || norm(old) === norm(next)) return templates;
  const stillUsed = templates.some((t) => t.fields.some((f) => f.type !== "heading" && f.type !== "divider" && norm(f.label) === norm(old)));
  let changed = false;
  const out = templates.map((t) => {
    let touched = false;
    const fields = t.fields.map((f) => {
      if (f.type !== "linkedfrom" || !f.options) return f;
      const from = f.options.from ?? [];
      const reads = from.some((x) => norm(x) === norm(old));
      const sorts = !stillUsed && !!f.options.sortBy && norm(f.options.sortBy) === norm(old);
      if (!reads && !sorts) return f;
      touched = true;
      let nextFrom = from;
      if (reads) {
        const replaced = stillUsed ? [...from, next] : from.map((x) => (norm(x) === norm(old) ? next : x));
        nextFrom = replaced.filter((x, i) => replaced.findIndex((y) => norm(y) === norm(x)) === i);
      }
      return { ...f, options: { ...f.options, from: nextFrom, ...(sorts ? { sortBy: next } : {}) } };
    });
    if (!touched) return t;
    changed = true;
    return { ...t, fields };
  });
  return changed ? out : templates;
}

/**
 * Names in a Linked from field's `from` that can't bring any page: no
 * template has a field with that name ("missing"), or every such field is a
 * Linked from field itself ("reverse"), which fills itself and stores nothing.
 */
export function fromProblems(templates: Template[], from: string[]): { name: string; problem: "missing" | "reverse" }[] {
  const out: { name: string; problem: "missing" | "reverse" }[] = [];
  for (const name of from) {
    const kinds = templates.flatMap((t) => t.fields.filter((f) => norm(f.label) === norm(name) && f.type !== "heading" && f.type !== "divider").map((f) => f.type));
    if (!kinds.length) out.push({ name, problem: "missing" });
    else if (kinds.every((k) => k === "linkedfrom")) out.push({ name, problem: "reverse" });
  }
  return out;
}
