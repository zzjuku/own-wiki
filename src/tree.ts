// Pure helpers for the sidebar tree: building it from the flat lists the
// backend sends, ordering, flattening into visible rows, and quick-open search.
import type { GroupInfo, PageInfo, Tree } from "./api";

export const ROOT = "";

export interface GroupNode {
  id: string;
  name: string;
  /** Child group ids, sorted. */
  groups: string[];
  /** Child pages, sorted. */
  pages: PageInfo[];
}

export interface TreeIndex {
  groups: Map<string, GroupNode>;
  pages: Map<string, PageInfo>;
}

export interface Row {
  kind: "group" | "page";
  id: string;
  label: string;
  depth: number;
  /** Groups only. */
  expanded?: boolean;
  empty?: boolean;
}

/** Alphabetical, ignoring case and accents, with numbers in natural order (2 before 10). */
export const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  .compare;

export function parentOf(id: string): string {
  const i = id.lastIndexOf("/");
  return i < 0 ? ROOT : id.slice(0, i);
}

/** "Group A/Sub" -> ["Group A", "Group A/Sub"] (ancestor chain, including itself). */
export function groupChain(group: string): string[] {
  if (!group) return [];
  const parts = group.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function displayGroup(group: string): string {
  return group.split("/").join(" › ");
}

export function buildIndex(tree: Tree): TreeIndex {
  const groups = new Map<string, GroupNode>();
  const node = (g: GroupInfo): GroupNode => ({ id: g.id, name: g.name, groups: [], pages: [] });
  groups.set(ROOT, node({ id: ROOT, name: "" }));
  for (const g of tree.groups) groups.set(g.id, node(g));
  for (const g of tree.groups) groups.get(parentOf(g.id))?.groups.push(g.id);
  const pages = new Map<string, PageInfo>();
  for (const p of tree.pages) {
    pages.set(p.id, p);
    groups.get(p.group)?.pages.push(p);
  }
  for (const n of groups.values()) {
    n.groups.sort((a, b) => compareNames(groups.get(a)!.name, groups.get(b)!.name));
    n.pages.sort((a, b) => compareNames(a.title, b.title));
  }
  return { groups, pages };
}

/** The rows the sidebar shows: groups before pages, children of expanded groups only. */
export function visibleRows(index: TreeIndex, expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (id: string, depth: number) => {
    const n = index.groups.get(id);
    if (!n) return;
    for (const gid of n.groups) {
      const g = index.groups.get(gid)!;
      const open = expanded.has(gid);
      rows.push({
        kind: "group",
        id: gid,
        label: g.name,
        depth,
        expanded: open,
        empty: g.groups.length === 0 && g.pages.length === 0,
      });
      if (open) walk(gid, depth + 1);
    }
    for (const p of n.pages) rows.push({ kind: "page", id: p.id, label: p.title, depth });
  };
  walk(ROOT, 0);
  return rows;
}

/** How many pages and groups are inside a group, at any depth. */
export function countInside(index: TreeIndex, id: string): { pages: number; groups: number } {
  let pages = 0;
  let groups = 0;
  const stack = [id];
  while (stack.length) {
    const n = index.groups.get(stack.pop()!);
    if (!n) continue;
    pages += n.pages.length;
    groups += n.groups.length;
    stack.push(...n.groups);
  }
  return { pages, groups };
}

/** True if `id` is the group `group` or anything inside it. */
export function isWithin(id: string, group: string): boolean {
  return id === group || id.startsWith(group + "/");
}

/** Rewrites `id` if it is `from` or inside it, after `from` was renamed/moved to `to`. */
export function remapId(id: string, from: string, to: string): string {
  return isWithin(id, from) ? to + id.slice(from.length) : id;
}

/** True if a group may be dropped into `target` (not itself or its own subgroup). */
export function canMoveGroupInto(id: string, target: string): boolean {
  return !isWithin(target, id);
}

/** Every group in tree order with its depth, for the "Move to…" picker. */
export function allGroupsInOrder(index: TreeIndex): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    for (const gid of index.groups.get(id)?.groups ?? []) {
      out.push({ id: gid, name: index.groups.get(gid)!.name, depth });
      walk(gid, depth + 1);
    }
  };
  walk(ROOT, 0);
  return out;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/**
 * Pages whose title matches `query`, best first: exact, starts with, a word
 * starts with, contains, then titles containing every typed word.
 */
export function searchTitles(pages: Iterable<PageInfo>, query: string, limit = 50): PageInfo[] {
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits: { page: PageInfo; score: number }[] = [];
  for (const page of pages) {
    const t = fold(page.title);
    let score: number;
    const at = t.indexOf(q);
    if (t === q) score = 0;
    else if (at === 0) score = 1;
    else if (at > 0 && /[\s\-_(.,'"/]/.test(t[at - 1])) score = 2;
    else if (at > 0) score = 3;
    else if (words.length > 1 && words.every((w) => t.includes(w))) score = 4;
    else continue;
    hits.push({ page, score });
  }
  hits.sort((a, b) => a.score - b.score || compareNames(a.page.title, b.page.title));
  return hits.slice(0, limit).map((h) => h.page);
}
