// Categories in the page view: the project's category list (resolving
// `[[Category:…]]` links, suggestions while adding categories, quick-open),
// and how category pages sort and file their pages.
import type { CategoryInfo } from "./api";
import { compareNames } from "./tree";
import { norm } from "./wikilinks";

export const CATEGORY_PREFIX = "Category:";

/** The category a link target names ("Category:Name" -> "Name"), or null. */
export function categoryOf(target: string): string | null {
  const t = target.trimStart();
  return /^category:/i.test(t) ? t.slice(CATEGORY_PREFIX.length).trim() : null;
}

/** Titles and aliases can't start with "Category:" or "File:" (those links go to categories and images). */
export const isReservedName = (name: string) => /^\s*(category|file)\s*:/i.test(name);

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export class CategoryIndex {
  readonly list: CategoryInfo[];
  private byName = new Map<string, CategoryInfo>();

  constructor(list: CategoryInfo[]) {
    this.list = [...list].sort((a, b) => compareNames(a.name, b.name));
    for (const c of this.list) this.byName.set(norm(c.name), c);
  }

  resolve(name: string): CategoryInfo | null {
    return this.byName.get(norm(name)) ?? null;
  }

  /** Categories matching `query`: starts with first, then contains. */
  search(query: string, limit = 50): CategoryInfo[] {
    const q = fold(query.trim());
    if (!q) return this.list.slice(0, limit);
    const starts: CategoryInfo[] = [];
    const contains: CategoryInfo[] = [];
    for (const c of this.list) {
      const t = fold(c.name);
      if (t.startsWith(q)) starts.push(c);
      else if (t.includes(q)) contains.push(c);
    }
    return [...starts, ...contains].slice(0, limit);
  }
}

/** The heading a page is filed under on a category page: its first letter
 * (accents dropped), "0–9" for digits, "#" for anything else. */
export function letterOf(key: string): string {
  const c = fold(key.trim()).charAt(0).toUpperCase();
  if (/\p{L}/u.test(c)) return c;
  if (/\d/.test(c)) return "0–9";
  return "#";
}

export interface Member {
  id: string;
  title: string;
  group: string;
  sort: string | null;
}

/** Members in category order ("Sort as" if set, else the title), grouped by letter. */
export function fileMembers(members: Member[]): { letter: string; members: Member[] }[] {
  const key = (m: Member) => (m.sort?.trim() ? m.sort : m.title);
  const sorted = [...members].sort((a, b) => compareNames(key(a), key(b)) || compareNames(a.title, b.title));
  const groups: { letter: string; members: Member[] }[] = [];
  for (const m of sorted) {
    const letter = letterOf(key(m));
    if (groups[groups.length - 1]?.letter !== letter) groups.push({ letter, members: [] });
    groups[groups.length - 1].members.push(m);
  }
  return groups;
}
