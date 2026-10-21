// What the graph shows (M11), worked out from the graph data the link index
// gives (src-tauri/src/graph.rs): which pages pass the filters, which lines
// are drawn, and the extra nodes (red links, categories, groups) when their
// switches are on. Pure functions, so they're unit-tested.
import { norm } from "../wikilinks";
import { parentOf, ROOT } from "../tree";

export interface GraphPage {
  id: string;
  title: string;
  aliases?: string[];
  template?: string;
  categories?: string[];
}

/** An infobox field behind a line; `spoiler`: its name shows only with the eye switch on. */
export interface GraphField {
  name: string;
  spoiler?: boolean;
}

/** A line between node numbers a < b (pages first, then red links). */
export interface GraphLink {
  a: number;
  b: number;
  ab?: boolean;
  ba?: boolean;
  text?: boolean;
  fields?: GraphField[];
}

export interface GraphData {
  pages: GraphPage[];
  missing: string[];
  links: GraphLink[];
}

export interface GraphFilters {
  /** "" = all; a group id includes its subgroups. */
  group: string;
  /** "" = all; pages directly in the category (as the Search filter). */
  category: string;
  /** "" = all; template id. */
  template: string;
  hideOrphans: boolean;
  textLinks: boolean;
  fieldLinks: boolean;
  /** Extra nodes. */
  redLinks: boolean;
  categories: boolean;
  groups: boolean;
  arrows: boolean;
}

export const DEFAULT_FILTERS: GraphFilters = {
  group: "",
  category: "",
  template: "",
  hideOrphans: false,
  textLinks: true,
  fieldLinks: true,
  redLinks: false,
  categories: false,
  groups: false,
  arrows: false,
};

export type NodeKind = "page" | "missing" | "category" | "group";

export interface ModelNode {
  /** "p:<page id>", "r:<name>", "c:<name>", "g:<group id>" (names as compared). */
  key: string;
  kind: NodeKind;
  label: string;
  /** Pages: the page id. Red links: the name as written. Categories: the name. Groups: the group id. */
  ref: string;
  /** Lines at this node. */
  degree: number;
}

export interface ModelEdge {
  key: string;
  source: string;
  target: string;
  /** Page links; "member": page in a category or group; "parent": category in a category, group in a group. */
  kind: "link" | "member" | "parent";
  /** Page links: source links to target / target links to source. */
  forward: boolean;
  backward: boolean;
  /** Infobox fields behind a page link. */
  fields: GraphField[];
}

export interface Model {
  nodes: ModelNode[];
  edges: ModelEdge[];
}

export interface Extras {
  /** Every category with its parent categories. */
  categories: { name: string; parents: string[] }[];
}

export const pageKey = (id: string) => `p:${id}`;
const missingKey = (name: string) => `r:${norm(name)}`;
const categoryKey = (name: string) => `c:${norm(name)}`;
const groupKey = (id: string) => `g:${id}`;

export function inGroup(pageId: string, group: string): boolean {
  if (!group) return true;
  const g = parentOf(pageId);
  return g === group || g.startsWith(`${group}/`);
}

/** The pages passing the group, category and template filters. */
function pageFilter(f: GraphFilters): (p: GraphPage) => boolean {
  const cat = f.category ? norm(f.category) : null;
  return (p) =>
    inGroup(p.id, f.group) &&
    (!cat || (p.categories ?? []).some((c) => norm(c) === cat)) &&
    (!f.template || p.template === f.template);
}

export function buildModel(data: GraphData, extras: Extras, f: GraphFilters): Model {
  const n = data.pages.length;
  const passes = pageFilter(f);
  const shown = data.pages.map(passes);
  const nodeKey = (i: number) => (i < n ? pageKey(data.pages[i].id) : missingKey(data.missing[i - n]));

  // Page links (and red links) that survive the switches.
  const edges: ModelEdge[] = [];
  const linked = new Uint8Array(n + data.missing.length);
  for (const l of data.links) {
    if (!shown[l.a] || (l.b < n ? !shown[l.b] : !f.redLinks)) continue;
    const fields = f.fieldLinks ? (l.fields ?? []) : [];
    if (!(f.textLinks && l.text) && !fields.length) continue;
    linked[l.a] = linked[l.b] = 1;
    // One-way lines point from the linking page (for arrows).
    const flip = !l.ab && !!l.ba;
    const [s, t] = flip ? [l.b, l.a] : [l.a, l.b];
    edges.push({
      key: `l:${l.a}:${l.b}`,
      source: nodeKey(s),
      target: nodeKey(t),
      kind: "link",
      forward: flip ? !!l.ba : !!l.ab,
      backward: flip ? !!l.ab : !!l.ba,
      fields,
    });
  }

  const nodes: ModelNode[] = [];
  const visible: GraphPage[] = [];
  data.pages.forEach((p, i) => {
    if (!shown[i] || (f.hideOrphans && !linked[i])) return;
    visible.push(p);
    nodes.push({ key: pageKey(p.id), kind: "page", label: p.title, ref: p.id, degree: 0 });
  });
  data.missing.forEach((name, j) => {
    if (linked[n + j]) nodes.push({ key: missingKey(name), kind: "missing", label: name, ref: name, degree: 0 });
  });
  const has = new Set(nodes.map((x) => x.key));
  const kept = edges.filter((e) => has.has(e.source) && has.has(e.target));

  if (f.categories) addCategories(visible, extras.categories, nodes, kept);
  if (f.groups) addGroups(visible, nodes, kept);

  const degree = new Map<string, number>();
  for (const e of kept) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  for (const x of nodes) x.degree = degree.get(x.key) ?? 0;
  return { nodes, edges: kept };
}

/** A node per category with shown pages (and the categories above them), lined to its pages and parents. */
function addCategories(pages: GraphPage[], all: Extras["categories"], nodes: ModelNode[], edges: ModelEdge[]) {
  const byName = new Map(all.map((c) => [norm(c.name), c]));
  const added = new Set<string>();
  const add = (name: string) => {
    const k = norm(name);
    if (added.has(k)) return;
    added.add(k);
    const c = byName.get(k);
    nodes.push({ key: categoryKey(name), kind: "category", label: c?.name ?? name, ref: c?.name ?? name, degree: 0 });
    for (const p of c?.parents ?? []) {
      add(p);
      if (norm(p) !== k) edges.push({ key: `cp:${k}:${norm(p)}`, source: categoryKey(name), target: categoryKey(p), kind: "parent", forward: true, backward: false, fields: [] });
    }
  };
  for (const p of pages) {
    const seen = new Set<string>();
    for (const c of p.categories ?? []) {
      const k = norm(c);
      if (seen.has(k)) continue;
      seen.add(k);
      add(c);
      edges.push({ key: `cm:${p.id}:${k}`, source: pageKey(p.id), target: categoryKey(c), kind: "member", forward: true, backward: false, fields: [] });
    }
  }
}

/** A node per group with shown pages directly inside (and the groups above them). */
function addGroups(pages: GraphPage[], nodes: ModelNode[], edges: ModelEdge[]) {
  const added = new Set<string>();
  const add = (id: string) => {
    if (added.has(id)) return;
    added.add(id);
    nodes.push({ key: groupKey(id), kind: "group", label: id.slice(id.lastIndexOf("/") + 1), ref: id, degree: 0 });
    const up = parentOf(id);
    if (up !== ROOT) {
      add(up);
      edges.push({ key: `gp:${id}`, source: groupKey(id), target: groupKey(up), kind: "parent", forward: true, backward: false, fields: [] });
    }
  };
  for (const p of pages) {
    const g = parentOf(p.id);
    if (g === ROOT) continue;
    add(g);
    edges.push({ key: `gm:${p.id}`, source: pageKey(p.id), target: groupKey(g), kind: "member", forward: true, backward: false, fields: [] });
  }
}

/** The label on a page link: its field names, spoiler fields only while spoilers are shown. Text links have none. */
export function edgeLabel(e: ModelEdge, spoilers: boolean): string {
  return e.fields
    .filter((x) => spoilers || !x.spoiler)
    .map((x) => x.name)
    .join(", ");
}
