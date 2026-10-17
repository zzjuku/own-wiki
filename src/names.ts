// Every name a page can be linked by (its title and its aliases): resolving
// links, and finding pages by name for quick-open, the link picker and
// autocomplete.
import type { PageInfo } from "./api";
import { compareNames } from "./tree";
import { norm } from "./wikilinks";

export interface NameEntry {
  /** The title, or an alias. */
  name: string;
  page: PageInfo;
  /** True if `name` is an alias of the page. */
  alias: boolean;
}

/** A link's target page; `via` is the alias the link used, if any. */
export interface LinkTarget {
  page: PageInfo;
  via?: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export class NameIndex {
  readonly entries: NameEntry[];
  private byName = new Map<string, NameEntry>();
  private folded: string[];

  constructor(pages: Iterable<PageInfo>) {
    const entries: NameEntry[] = [];
    for (const page of pages) {
      entries.push({ name: page.title, page, alias: false });
      for (const a of page.aliases ?? []) entries.push({ name: a, page, alias: true });
    }
    entries.sort((a, b) => compareNames(a.name, b.name) || Number(a.alias) - Number(b.alias));
    this.entries = entries;
    // Titles win over aliases if a name is ever used twice (files edited by hand).
    for (const e of entries) {
      const key = norm(e.name);
      const prev = this.byName.get(key);
      if (!prev || (prev.alias && !e.alias)) this.byName.set(key, e);
    }
    this.folded = entries.map((e) => fold(e.name));
  }

  resolve(name: string): LinkTarget | null {
    const e = this.byName.get(norm(name));
    if (!e) return null;
    return e.alias ? { page: e.page, via: e.name } : { page: e.page };
  }

  /**
   * Names matching `query`, best first: exact, starts with, a word starts
   * with, contains, then names containing every typed word. An empty query
   * lists names alphabetically.
   */
  search(query: string, limit = 50): NameEntry[] {
    const q = fold(query.trim());
    if (!q) return this.entries.slice(0, limit);
    const words = q.split(/\s+/);
    const hits: { e: NameEntry; score: number; i: number }[] = [];
    this.entries.forEach((e, i) => {
      const t = this.folded[i];
      let score: number;
      const at = t.indexOf(q);
      if (t === q) score = 0;
      else if (at === 0) score = 1;
      else if (at > 0 && /[\s\-_(.,'"/]/.test(t[at - 1])) score = 2;
      else if (at > 0) score = 3;
      else if (words.length > 1 && words.every((w) => t.includes(w))) score = 4;
      else return;
      hits.push({ e, score: score * 2 + Number(e.alias), i });
    });
    hits.sort((a, b) => a.score - b.score || a.i - b.i);
    return hits.slice(0, limit).map((h) => h.e);
  }
}
