// Which people a family tree shows and how they hang together (M12), before
// anything is placed (layout.ts places it).
//
// Starting from the centre person, the tree walks outwards, nearest first:
// up through the centre's parents to `up` generations (the "line"), and down
// from every blood relative to `down` generations below the centre, with each
// blood relative's partners beside them. Partners who married in bring
// nothing else (only their parents, with "Partners' parents" on). Everyone's
// full box appears once, at the first place reached (nearest the centre);
// every other place they belong gets a small stub. A relation from a spoiler
// field shows its person as a "▒▒▒" box, and nothing is reached through it
// until it is revealed.
import { type CoupleLabel, type Family, type LineStyle, type ParentLink, coupleKey, parentKey, weaker } from "./data";

export type BoxKind = "person" | "placeholder" | "hidden" | "stub" | "unknown";

export interface TBox {
  key: string;
  kind: BoxKind;
  /** Generation: 0 = the centre's, negative above. */
  gen: number;
  person?: number;
  /** Hidden boxes: the relations a click reveals. */
  reveal?: string[];
  /** Stubs: the key of the full box. */
  target?: string;
}

/** A child under a couple (or a single parent). */
export interface Kid {
  /** The line from the couple down to this child. */
  drop: LineStyle;
  unit?: Unit;
  box?: TBox;
  /** The person the lineage above leads to (placed by the layout). */
  line?: true;
}

/** A person's partner beside them, and their children together. */
export interface Partnership {
  key: string;
  partner: TBox;
  /** Preferred side (the layout puts every partner on the outer side of a parent in the line). */
  side: "left" | "right";
  style: LineStyle;
  labels: CoupleLabel[];
  kids: Kid[];
  /** The partner's own parents ("Partners' parents"). */
  above?: Above;
}

export interface Above {
  key: string;
  parents: TBox[];
  style: LineStyle;
  labels: CoupleLabel[];
  drop: LineStyle;
}

/** A person with their partners and children (and theirs, all the way down). */
export interface Unit {
  box: TBox;
  /** More parents of the child below (an adoptive father, …), placed next to this parent. */
  extras: TBox[];
  partnerships: Partnership[];
  /** Children with only this parent. */
  alone: Kid[];
  aloneKey: string;
}

/** One parent of a couple in the line, with their own parents above them. */
export interface Side {
  unit: Unit;
  up: Lineage | null;
}

/** Parents of someone in the line (the centre, a parent, a grandparent, …). */
export interface Lineage {
  key: string;
  left: Side;
  right: Side | null;
  style: LineStyle;
  labels: CoupleLabel[];
  kids: Kid[];
}

/** A line from a further parent (beyond the first two) to their child. */
export interface Connector {
  from: string;
  to: string;
  style: LineStyle;
}

export interface TreeSpec {
  /** The centre's unit, and the lineage above it (if any parents are shown). */
  centre: Unit;
  lineage: Lineage | null;
  boxes: TBox[];
  connectors: Connector[];
  /** People with a full box. */
  shown: Set<number>;
}

export interface TreeOptions {
  up: number;
  down: number;
  partnersParents: boolean;
  /** The eye switch: every spoiler shown. */
  revealAll: boolean;
  /** Relations revealed by clicking their "▒▒▒" box. */
  revealed: ReadonlySet<string>;
  /** People with a full box in another tree on the same screen ("All families"): stubs here. */
  elsewhere?: ReadonlySet<number>;
  /** Only these people are drawn (a house's tree). */
  only?: ReadonlySet<number>;
}

type Role = "line" | "blood" | "inlaw" | "inlawParent" | "extra";

/** Another parent in a union: a person, a hidden person, "?" or nobody. */
type Other = { kind: "person"; i: number } | { kind: "hidden"; i: number; edges: string[] } | { kind: "unknown" } | { kind: "none" };

interface UKid {
  child: number;
  drop: LineStyle;
  /** Reached through a hidden link: shown as "▒▒▒". */
  hidden?: string;
}

interface Union {
  key: string;
  other: Other;
  style: LineStyle;
  labels: CoupleLabel[];
  /** Has a partner link (else they're only parents of the same children). */
  couple: boolean;
  order: number[];
  kids: UKid[];
  /** Field place of the other parent for the first child (decides the side). */
  otherField?: number;
  myField?: number;
}

const unionKey = (a: number, b: number) => `u${Math.min(a, b)}-${Math.max(a, b)}`;

export function buildTree(fam: Family, centre: number, opts: TreeOptions): TreeSpec {
  const shownLink = (l: ParentLink) => !l.spoiler || opts.revealAll || opts.revealed.has(parentKey(l));
  const shownCouple = (key: string, spoiler: boolean) => !spoiler || opts.revealAll || opts.revealed.has(key);

  /** A child's first two parents (the couple they hang from) and any further ones. */
  const parentsCache = new Map<number, { main: ParentLink[]; extra: ParentLink[] }>();
  function parentsOf(i: number) {
    let r = parentsCache.get(i);
    if (!r) {
      const main: ParentLink[] = [];
      const extra: ParentLink[] = [];
      for (const l of fam.parentsOf[i]) (main.length < 2 && !main.some((m) => m.parent === l.parent) ? main : extra).push(l);
      r = { main, extra };
      parentsCache.set(i, r);
    }
    return r;
  }

  /** Person `p`'s couples and children grouped by the other parent. */
  const unionsCache = new Map<number, { unions: Union[]; alone: Union; extraKids: ParentLink[] }>();
  function unionsOf(p: number) {
    const cached = unionsCache.get(p);
    if (cached) return cached;
    const map = new Map<string, Union>();
    const get = (key: string, other: Other, order: number[]) => {
      let u = map.get(key);
      if (!u) {
        u = { key, other, style: "solid", labels: [], couple: false, order, kids: [] };
        map.set(key, u);
      }
      return u;
    };
    const alone: Union = { key: `a${p}`, other: { kind: "none" }, style: "solid", labels: [], couple: false, order: [], kids: [] };
    const singles: UKid[] = [];
    const extraKids: ParentLink[] = [];
    for (const l of fam.childrenOf[p]) {
      const k = l.child;
      if (!shownLink(l)) {
        alone.kids.push({ child: k, drop: "solid", hidden: parentKey(l) });
        continue;
      }
      const { main } = parentsOf(k);
      if (!main.includes(l)) {
        extraKids.push(l);
        continue;
      }
      const o = main.find((m) => m !== l);
      if (!o) {
        singles.push({ child: k, drop: fam.style(l) });
        continue;
      }
      const drop = weaker(fam.style(l), fam.style(o));
      const order = [2, l.child];
      if (!shownLink(o)) {
        const u = get(`h${p}-${o.parent}`, { kind: "hidden", i: o.parent, edges: [] }, [3, l.child]);
        if (u.other.kind === "hidden") u.other.edges.push(parentKey(o));
        u.kids.push({ child: k, drop });
      } else {
        const u = get(unionKey(p, o.parent), { kind: "person", i: o.parent }, order);
        if (u.otherField === undefined) [u.otherField, u.myField] = [o.field, l.field];
        u.kids.push({ child: k, drop });
      }
    }
    fam.couplesOf[p].forEach((c, n) => {
      const order = [0, n];
      if (!shownCouple(c.key, c.spoiler)) {
        const u = map.get(unionKey(p, c.other)) ?? get(`hr${p}-${c.other}`, { kind: "hidden", i: c.other, edges: [] }, [1, n]);
        if (u.other.kind === "hidden") u.other.edges.push(c.key);
        return;
      }
      const u = get(unionKey(p, c.other), { kind: "person", i: c.other }, order);
      Object.assign(u, { couple: true, style: c.style, order, labels: c.labels.filter((x) => !x.spoiler || opts.revealAll || opts.revealed.has(c.key)) });
    });
    const unions = [...map.values()].sort((a, b) => {
      for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) if ((a.order[i] ?? 0) !== (b.order[i] ?? 0)) return (a.order[i] ?? 0) - (b.order[i] ?? 0);
      return 0;
    });
    // Children with one known parent: under a "?" partner when that parent also has children with a partner.
    if (singles.length) {
      if (unions.some((u) => u.kids.length)) unions.push({ key: `q${p}`, other: { kind: "unknown" }, style: "solid", labels: [], couple: false, order: [9], kids: singles });
      else alone.kids.unshift(...singles);
    }
    const r = { unions, alone, extraKids };
    unionsCache.set(p, r);
    return r;
  }

  /** The union someone hangs from in the line (null: no parents shown). */
  function lineUnion(i: number): Union | null {
    const { main } = parentsOf(i);
    const open = main.find(shownLink);
    if (!open) return null;
    const { unions, alone } = unionsOf(open.parent);
    return [...unions, alone].find((u) => u.kids.some((k) => k.child === i && !k.hidden)) ?? null;
  }

  // ---- walk outwards, nearest first ----
  const home = new Map<number, string>();
  const elsewhere = opts.elsewhere ?? new Set<number>();
  /** Has a full box somewhere (this tree or another). */
  const homed = (i: number) => home.has(i) || elsewhere.has(i);
  const genOf = new Map<number, number>();
  /** Union key -> who draws it (a person's number, or "line"). */
  const claimed = new Map<string, number | "line">();
  /** Line people -> their parents' union. */
  const lineOf = new Map<number, Union | null>();
  const queue: { i: number; role: Role }[] = [];
  const place = (i: number, where: string, gen: number, role: Role) => {
    if (homed(i) || (opts.only && !opts.only.has(i))) return;
    home.set(i, where);
    genOf.set(i, gen);
    queue.push({ i, role });
  };
  place(centre, "root", 0, "line");
  const deferred: { i: number; where: string; gen: number; role: Role }[] = [];
  for (let q = 0; q < queue.length || deferred.length; q++) {
    if (q >= queue.length) {
      for (const d of deferred.splice(0)) place(d.i, d.where, d.gen, d.role);
      q--;
      continue;
    }
    const { i, role } = queue[q];
    const gen = genOf.get(i)!;
    const { main, extra } = parentsOf(i);
    if (role === "line" && gen - 1 >= -opts.up && main.length) {
      const u = lineUnion(i);
      const hiddenOnly = !u && main.length > 0;
      if (u || hiddenOnly) {
        if (u) claimed.set(u.key, "line");
        lineOf.set(i, u);
        for (const l of main) if (shownLink(l)) place(l.parent, `parent:${i}`, gen - 1, "line");
        for (const k of u?.kids ?? []) if (!k.hidden) place(k.child, `child:${u!.key}`, gen, "blood");
        for (const l of extra) if (shownLink(l)) deferred.push({ i: l.parent, where: `extra:${i}`, gen: gen - 1, role: "extra" });
      }
    }
    if (role === "line" || role === "blood") {
      const { unions, alone, extraKids } = unionsOf(i);
      for (const u of [...unions, alone]) {
        if (claimed.has(u.key)) continue;
        claimed.set(u.key, i);
        if (u.other.kind === "person") place(u.other.i, `partner:${u.key}`, gen, "inlaw");
        if (gen + 1 <= opts.down) for (const k of u.kids) if (!k.hidden) place(k.child, `child:${u.key}`, gen + 1, "blood");
      }
      if (gen + 1 <= opts.down)
        for (const l of extraKids) deferred.push({ i: l.child, where: `alone:${i}:${fam.style(l)}`, gen: gen + 1, role: "blood" });
    }
    if (role === "inlaw" && opts.partnersParents && gen - 1 >= -opts.up)
      for (const l of main) if (shownLink(l)) place(l.parent, `above:${i}`, gen - 1, "inlawParent");
  }

  // ---- build the structure ----
  const boxes: TBox[] = [];
  let counter = 0;
  const box = (b: Omit<TBox, "key"> & { key?: string }): TBox => {
    const full = { ...b, key: b.key ?? `x${counter++}` } as TBox;
    boxes.push(full);
    return full;
  };
  // (Bad data can lead to the same person twice: then the second is a stub.)
  const made = new Set<number>();
  const personBox = (i: number) => {
    if (made.has(i)) return stub(i, genOf.get(i)!);
    made.add(i);
    return box({ key: `n${i}`, kind: fam.people[i].id ? "person" : "placeholder", gen: genOf.get(i)!, person: i });
  };
  const stub = (i: number, gen: number) => box({ kind: "stub", gen, person: i, target: `n${i}` });
  const hiddenBox = (edges: string[], gen: number) => box({ kind: "hidden", gen, reveal: edges });

  const kidsOf = (u: Union, gen: number, line?: number): Kid[] => {
    const out: Kid[] = [];
    for (const k of u.kids) {
      if (k.child === line && !k.hidden) out.push({ drop: k.drop, line: true });
      else if (k.hidden) {
        if (!opts.only || opts.only.has(k.child)) out.push({ drop: k.drop, box: hiddenBox([k.hidden], gen + 1) });
      }
      else if (home.get(k.child) === `child:${u.key}`) out.push({ drop: k.drop, unit: unitOf(k.child) });
      else if (homed(k.child)) out.push({ drop: k.drop, box: stub(k.child, gen + 1) });
    }
    return out;
  };

  const otherBox = (o: Other, where: string, gen: number): TBox | null => {
    if (o.kind === "person") return home.get(o.i) === where ? personBox(o.i) : homed(o.i) ? stub(o.i, gen) : null;
    if (o.kind === "hidden") return !opts.only || opts.only.has(o.i) ? hiddenBox(o.edges, gen) : null;
    if (o.kind === "unknown") return box({ kind: "unknown", gen });
    return null;
  };

  function aboveOf(i: number): Above | undefined {
    const parents = parentsOf(i).main.filter((l) => home.get(l.parent) === `above:${i}`);
    if (!parents.length) return undefined;
    const c = parents.length === 2 ? fam.couplesOf[parents[0].parent].find((x) => x.other === parents[1].parent) : undefined;
    const coupleShown = c && shownCouple(c.key, c.spoiler);
    return {
      key: `above${i}`,
      parents: parents.map((l) => personBox(l.parent)),
      style: coupleShown ? c.style : "solid",
      labels: coupleShown ? c.labels.filter((x) => !x.spoiler || opts.revealAll || opts.revealed.has(c.key)) : [],
      drop: parents.map((l) => fam.style(l)).reduce(weaker, "solid" as LineStyle),
    };
  }

  function unitOf(i: number): Unit {
    const gen = genOf.get(i)!;
    if (made.has(i)) return { box: stub(i, gen), extras: [], partnerships: [], alone: [], aloneKey: `a-${i}` };
    const me = personBox(i);
    const { unions, alone } = unionsOf(i);
    const partnerships: Partnership[] = [];
    let n = 0;
    let first: "left" | "right" = "right";
    for (const u of unions) {
      const host = claimed.get(u.key);
      if (host === "line") continue;
      if (host !== i) {
        // Drawn at the other partner's place: a stub of them here.
        const other = u.other.kind === "person" && typeof host === "number" ? stub(host, gen) : null;
        if (other) partnerships.push({ key: `${u.key}@${i}`, partner: other, side: n++ % 2 ? (first === "left" ? "right" : "left") : first, style: u.style, labels: [], kids: [] });
        continue;
      }
      const partner = otherBox(u.other, `partner:${u.key}`, gen);
      if (!partner) continue;
      // The first partner on the right (on the left if they're the earlier parent field, e.g. the father),
      // then the sides take turns.
      if (n === 0) first = u.otherField !== undefined && u.myField !== undefined && u.otherField < u.myField ? "left" : "right";
      const side = n % 2 ? (first === "left" ? "right" : "left") : first;
      n++;
      partnerships.push({
        key: u.key,
        partner,
        side,
        style: u.style,
        labels: u.labels,
        kids: gen + 1 <= opts.down ? kidsOf(u, gen) : [],
        above: partner.kind === "person" || partner.kind === "placeholder" ? aboveOf(partner.person!) : undefined,
      });
    }
    // Children with only this parent, and children of a further parent (adoptive, …) placed here.
    const aloneKids = claimed.get(alone.key) === i && gen + 1 <= opts.down ? kidsOf(alone, gen) : [];
    for (const [k, where] of home)
      if (where.startsWith(`alone:${i}:`)) aloneKids.push({ drop: where.slice(where.lastIndexOf(":") + 1) as LineStyle, unit: unitOf(k) });
    const extras: TBox[] = [];
    return { box: me, extras, partnerships, alone: aloneKids, aloneKey: alone.key };
  }

  function sideOf(l: ParentLink, child: number, gen: number): Side {
    const empty = (b: TBox): Side => ({ unit: { box: b, extras: [], partnerships: [], alone: [], aloneKey: `a${b.key}` }, up: null });
    if (!shownLink(l)) return empty(hiddenBox([parentKey(l)], gen));
    if (home.get(l.parent) !== `parent:${child}`) return empty(stub(l.parent, gen));
    return { unit: unitOf(l.parent), up: lineOf.has(l.parent) ? lineageOf(l.parent) : null };
  }

  function lineageOf(i: number): Lineage {
    const gen = genOf.get(i)! - 1;
    const u = lineOf.get(i) ?? null;
    const { main, extra } = parentsOf(i);
    const left = sideOf(main[0], i, gen);
    let right = main[1] ? sideOf(main[1], i, gen) : null;
    if (!right && u?.other.kind === "unknown") right = { unit: { box: box({ kind: "unknown", gen }), extras: [], partnerships: [], alone: [], aloneKey: "" }, up: null };
    const last = right ?? left;
    for (const l of extra) if (home.get(l.parent) === `extra:${i}`) last.unit.extras.push(personBox(l.parent));
    const kids = u ? kidsOf(u, gen, i) : [{ drop: "solid" as LineStyle, line: true as const }];
    return { key: u?.key ?? `l${i}`, left, right, style: u?.style ?? "solid", labels: u?.labels ?? [], kids };
  }

  const lineage = lineOf.has(centre) ? lineageOf(centre) : null;
  const centreUnit = unitOf(centre);

  // Further parents (adoptive, …) of children in view: a line to the child.
  const connectors: Connector[] = [];
  for (const [k, where] of home) {
    for (const l of parentsOf(k).extra) {
      if (!shownLink(l) || !home.has(l.parent) || where === `alone:${l.parent}:${fam.style(l)}`) continue;
      connectors.push({ from: `n${l.parent}`, to: `n${k}`, style: fam.style(l) });
    }
  }
  const shown = new Set(boxes.filter((b) => b.key.startsWith("n")).map((b) => b.person!));
  return { centre: centreUnit, lineage, boxes, connectors, shown };
}

/** Keys of the relations a hidden box stands for, as one string (for tests and lookups). */
export const revealKeys = (b: TBox) => (b.reveal ?? []).join(" ");
export { coupleKey, parentKey };

/** How many people descend from `i` (for choosing where trees start). */
function descendants(fam: Family, i: number): number {
  const seen = new Set([i]);
  const queue = [i];
  for (let q = 0; q < queue.length; q++)
    for (const l of fam.childrenOf[queue[q]])
      if (!seen.has(l.child)) {
        seen.add(l.child);
        queue.push(l.child);
      }
  return seen.size - 1;
}

/**
 * "All families" (or one house's): one tree after another until everyone has a
 * full box once. Each tree starts at the person without parents who has the
 * most descendants left (biggest families first); people already drawn in an
 * earlier tree are stubs in later ones.
 */
export function buildAllTrees(fam: Family, opts: TreeOptions, house?: number): TreeSpec[] {
  const everyone = fam.people.map((_, i) => i).filter((i) => fam.inFamily(i) && (house === undefined || fam.people[i].houses?.includes(house)));
  // A house: its members, their partners and their children (nobody beyond).
  let only: Set<number> | undefined;
  if (house !== undefined) {
    only = new Set(everyone);
    for (const i of everyone) {
      fam.couplesOf[i].forEach((c) => only!.add(c.other));
      fam.childrenOf[i].forEach((l) => {
        only!.add(l.child);
        fam.parentsOf[l.child].forEach((p) => only!.add(p.parent));
      });
    }
  }
  const size = new Map(everyone.map((i) => [i, descendants(fam, i)]));
  const order = [...everyone].sort((a, b) => Number(fam.parentsOf[a].length > 0) - Number(fam.parentsOf[b].length > 0) || size.get(b)! - size.get(a)! || a - b);
  const shown = new Set<number>();
  const trees: TreeSpec[] = [];
  for (const root of order) {
    if (shown.has(root)) continue;
    const spec = buildTree(fam, root, { ...opts, up: 0, down: Infinity, elsewhere: shown, only });
    // Someone whose relations are all hidden spoilers would stand alone: left out.
    if (spec.boxes.length === 1) continue;
    spec.shown.forEach((i) => shown.add(i));
    trees.push(spec);
  }
  return trees;
}

/** Typical years between a parent's birth and a child's (from the dates there are; else 25). */
export function generationYears(fam: Family, spoilers: boolean): number {
  const year = (i: number) => {
    const b = fam.people[i].birth;
    return b && (!b.spoiler || spoilers) ? b.year : null;
  };
  const gaps: number[] = [];
  fam.parentsOf.forEach((links, child) =>
    links.forEach((l) => {
      const c = year(child);
      const p = year(l.parent);
      if (c !== null && p !== null && c - p >= 12 && c - p <= 70) gaps.push(c - p);
    }),
  );
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 25;
}

/**
 * How many generations to move each tree of All families down, so they line
 * up side by side: a tree with a stub of someone drawn in an earlier tree
 * lines up with them (in-laws' families); else, with birth dates, by when its
 * generations were born; else its newest generation is level with the newest.
 */
export function alignTrees(fam: Family, trees: TreeSpec[], spoilers: boolean): number[] {
  const g = generationYears(fam, spoilers);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const full = (t: TreeSpec) => t.boxes.filter((b) => (b.kind === "person" || b.kind === "placeholder") && b.key === `n${b.person}`);
  // Year the tree's top generation (gen 0) was born, estimated from everyone with a date.
  const start = trees.map((t) => {
    const est = full(t).flatMap((b) => {
      const birth = fam.people[b.person!].birth;
      return birth && (!birth.spoiler || spoilers) ? [birth.year - b.gen * g] : [];
    });
    return est.length ? median(est) : null;
  });
  const newest = trees.map((t) => Math.max(0, ...full(t).map((b) => b.gen)));
  // Where each person's full box is: tree and generation.
  const placed = new Map<number, { tree: number; gen: number }>();
  trees.forEach((t, i) => full(t).forEach((b) => placed.set(b.person!, { tree: i, gen: b.gen })));
  const shifts: (number | null)[] = [];
  trees.forEach((t, i) => {
    const anchor = t.boxes.find((b) => b.kind === "stub" && (placed.get(b.person!)?.tree ?? i) < i && shifts[placed.get(b.person!)!.tree] !== null);
    if (anchor) {
      const p = placed.get(anchor.person!)!;
      return shifts.push(p.gen + shifts[p.tree]! - anchor.gen);
    }
    const ref = start.findIndex((y, r) => r < i && y !== null && shifts[r] !== null);
    if (start[i] !== null && ref >= 0) return shifts.push(shifts[ref]! + Math.round((start[i]! - start[ref]!) / g));
    shifts.push(i === 0 || start[i] !== null ? 0 : null);
  });
  // The rest: their newest generation level with the newest one.
  const known = shifts.flatMap((s, i) => (s === null ? [] : [newest[i] + s]));
  const bottom = known.length ? Math.max(...known) : 0;
  const out = shifts.map((s, i) => s ?? bottom - newest[i]);
  const top = Math.min(...out);
  return out.map((s) => s - top);
}
