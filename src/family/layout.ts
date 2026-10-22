// Where a family tree's boxes and lines go (M12). Generations are rows,
// parents above children. A person sits with their partners side by side
// (couple lines between them) and each couple's children hang below the
// middle of their line. Blocks are built bottom-up and packed side by side
// by their outlines per row (so a wide family below never overlaps its
// neighbours). In the centre's line, each couple is joined across the two
// partners' own families: the father's side ends at his box, the mother's
// starts at hers, and their children hang between.
import type { CoupleLabel, LineStyle } from "./data";
import type { Kid, Lineage, Partnership, Side, TBox, TreeSpec, Unit } from "./model";

export interface Metrics {
  boxW: number;
  /** Height of a box without a picture. */
  boxH: number;
  /** Height of a box with a picture (picture on top, name below). */
  cardH: number;
  /** The box shows a picture. */
  tall: (b: TBox) => boolean;
  /** Width of the "?" box. */
  unknownW: number;
  stubH: number;
  /** Between siblings and anything unrelated. */
  gap: number;
  /** Least space between partners. */
  coupleGap: number;
  /** Space between generations (for the lines and bars). */
  rowGap: number;
  /** Width of a text: couple labels and stub names. */
  measure: (text: string, kind: "label" | "stub") => number;
  stubText: (b: TBox) => string;
}

export interface Placed {
  key: string;
  box: TBox;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreeLine {
  d: string;
  style: LineStyle;
  kind: "couple" | "descent" | "connector";
  /** Box keys the line belongs to (highlighted with them). */
  people: string[];
}

export interface TreeLabel {
  x: number;
  y: number;
  text: string;
  spoiler?: boolean;
}

export interface TreeLayout {
  boxes: Placed[];
  lines: TreeLine[];
  labels: TreeLabel[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Something placed in a block: a box, or the point a couple's children hang from. */
interface Item {
  key: string;
  x: number;
  row: number;
  w: number;
  h: number;
  box?: TBox;
  /** Junction points: their height (middle of the box row, under the boxes, or the box's bottom). */
  jy?: "mid" | "bottom" | number;
  /** "bottom" junctions: the box whose bottom the line starts from. */
  of?: string;
}

class Block {
  items: Item[] = [];
  rows = new Map<number, [number, number]>();
  byKey = new Map<string, Item>();

  add(it: Item) {
    this.items.push(it);
    this.byKey.set(it.key, it);
    if (!it.box) return;
    const r = this.rows.get(it.row);
    if (r) {
      r[0] = Math.min(r[0], it.x);
      r[1] = Math.max(r[1], it.x + it.w);
    } else this.rows.set(it.row, [it.x, it.x + it.w]);
  }

  shift(dx: number) {
    if (!dx) return;
    for (const it of this.items) it.x += dx;
    for (const r of this.rows.values()) {
      r[0] += dx;
      r[1] += dx;
    }
  }

  merge(b: Block, dx: number) {
    b.shift(dx);
    for (const it of b.items) this.add(it);
  }

  get minX() {
    return Math.min(...[...this.rows.values()].map((r) => r[0]));
  }

  get maxX() {
    return Math.max(...[...this.rows.values()].map((r) => r[1]));
  }
}

/** How far `b` must move right to sit right of `a` (by `gap`) on every row both use; -Infinity if none. */
function sep(a: Block, b: Block, gap: number): number {
  let need = -Infinity;
  for (const [row, [min]] of b.rows) {
    const r = a.rows.get(row);
    if (r) need = Math.max(need, r[1] + gap - min);
  }
  return need;
}

/** Blocks side by side, each as far left as its outline allows. */
function hcat(blocks: Block[], gap: number): { block: Block; offsets: number[] } {
  const out = new Block();
  const offsets: number[] = [];
  for (const b of blocks) {
    let dx = 0;
    if (out.items.length && b.rows.size) {
      const s = sep(out, b, gap);
      dx = Number.isFinite(s) ? s : out.maxX + gap - b.minX;
    }
    offsets.push(dx);
    out.merge(b, dx);
  }
  return { block: out, offsets };
}

type Spec =
  | { t: "couple"; a: string; b: string; style: LineStyle; labels: CoupleLabel[]; level: number; junction: string }
  | { t: "descent"; from: string; kids: { key: string; drop: LineStyle }[]; people: string[] }
  | { t: "connector"; from: string; to: string; style: LineStyle };

export function layoutTree(spec: TreeSpec, m: Metrics): TreeLayout {
  const specs: Spec[] = [];
  const size = (b: TBox) =>
    b.kind === "stub"
      ? { w: Math.ceil(m.measure(m.stubText(b), "stub")) + 18, h: m.stubH }
      : { w: b.kind === "unknown" ? m.unknownW : m.boxW, h: m.tall(b) ? m.cardH : m.boxH };
  const labelGap = (labels: CoupleLabel[]) => Math.max(m.coupleGap, ...labels.map((l) => Math.ceil(m.measure(l.text, "label")) + 12));
  const single = (b: TBox) => {
    const blk = new Block();
    blk.add({ key: b.key, x: 0, row: b.gen, ...size(b), box: b });
    return blk;
  };
  const kidKey = (k: Kid, lineKey?: string) => (k.line ? lineKey! : k.unit ? k.unit.box.key : k.box!.key);
  const centreOf = (it: Item) => it.x + it.w / 2;

  /** Children side by side; their middle (between the first and last child's box). */
  function kidsBlock(kids: Kid[], lineBlock?: Block, lineKey?: string) {
    const blocks = kids.map((k) => (k.line ? lineBlock! : k.unit ? unitBlock(k.unit, "both") : single(k.box!)));
    const { block } = hcat(blocks, m.gap);
    const first = block.byKey.get(kidKey(kids[0], lineKey))!;
    const last = block.byKey.get(kidKey(kids[kids.length - 1], lineKey))!;
    return { block, mid: (centreOf(first) + centreOf(last)) / 2 };
  }

  /**
   * A person with partners and children. `mode`: where partners go ("both":
   * their own side; "left"/"right": all on that side, for a parent in the line).
   */
  function unitBlock(u: Unit, mode: "both" | "left" | "right"): Block {
    const g = u.box.gen;
    const lefts: Partnership[] = [];
    const rights: Partnership[] = [];
    for (const p of u.partnerships) ((mode === "both" ? p.side : mode) === "left" ? lefts : rights).push(p);
    // The row, left to right: far-left partners first, the person, right partners, further parents.
    const row: { box: TBox; p?: Partnership }[] = [
      ...[...lefts].reverse().map((p) => ({ box: p.partner, p })),
      { box: u.box },
      ...rights.map((p) => ({ box: p.partner, p })),
      ...u.extras.map((box) => ({ box })),
    ];
    const host = lefts.length;
    const sizes = row.map((r) => size(r.box));
    const gaps = row.slice(0, -1).map((r, k) => {
      const p = k < host ? r.p : row[k + 1].p;
      return p ? labelGap(p.labels) : m.gap;
    });

    // Children groups in the order of their couples.
    type Group = { key: string; kids: Kid[]; at: number; side: "left" | "right" | "alone"; people: string[] };
    const groups: Group[] = [];
    row.forEach((r, k) => {
      if (k === host && u.alone.length) groups.push({ key: u.aloneKey, kids: u.alone, at: k, side: "alone", people: [u.box.key] });
      if (r.p?.kids.length) groups.push({ key: r.p.key, kids: r.p.kids, at: k, side: k < host ? "left" : "right", people: [u.box.key, r.box.key] });
    });
    // (The alone group sits under the person: before the right partners' groups.)
    groups.sort((a, b) => a.at - b.at || (a.side === "alone" ? -1 : 1));
    const kb = groups.map((gr) => kidsBlock(gr.kids));
    const packed = hcat(kb.map((k) => k.block), m.gap * 1.5);

    // Junction of a group, measured from its box's left edge.
    const junctionFrom = (gr: Group) =>
      gr.side === "alone" ? sizes[gr.at].w / 2 : gr.side === "right" ? -gaps[gr.at - 1] / 2 : sizes[gr.at].w + gaps[gr.at] / 2;
    // Place the row so each junction sits over its children's middle, keeping the gaps
    // (isotonic regression on x minus the gaps before it).
    const before: number[] = [];
    row.forEach((_, k) => before.push(k ? before[k - 1] + sizes[k - 1].w + gaps[k - 1] : 0));
    const want = new Map<number, number>();
    groups.forEach((gr, i) => want.set(gr.at, packed.offsets[i] + kb[i].mid - junctionFrom(gr) - before[gr.at]));
    const xs = isotonic(row.length, want).map((v, k) => v + before[k]);

    const blk = new Block();
    row.forEach((r, k) => blk.add({ key: r.box.key, x: xs[k], row: g, ...sizes[k], box: r.box }));
    // Children under their junctions (moved only as far as their neighbours allow).
    const kids = new Block();
    groups.forEach((gr, i) => {
      const j = xs[gr.at] + junctionFrom(gr);
      // (hcat left each group at its packed offset.)
      const desired = j - kb[i].mid - packed.offsets[i];
      const dx = kids.items.length ? Math.max(desired, sep(kids, kb[i].block, m.gap * 1.5)) : desired;
      kids.merge(kb[i].block, dx);
      const level = gr.side === "alone" ? 0 : Math.abs(gr.at - host) - 1;
      blk.add({ key: `j:${gr.key}`, x: j, row: g, w: 0, h: 0, jy: gr.side === "alone" ? "bottom" : level ? level : "mid", of: u.box.key });
      specs.push({ t: "descent", from: `j:${gr.key}`, kids: gr.kids.map((k) => ({ key: kidKey(k), drop: k.drop })), people: gr.people });
    });
    // Couple lines (and junctions for couples without children).
    row.forEach((r, k) => {
      if (!r.p) return;
      const level = Math.abs(k - host) - 1;
      const jkey = `j:${r.p.key}`;
      if (!blk.byKey.has(jkey)) {
        const j = k > host ? xs[k] - gaps[k - 1] / 2 : xs[k] + sizes[k].w + gaps[k] / 2;
        blk.add({ key: jkey, x: j, row: g, w: 0, h: 0, jy: level ? level : "mid" });
      }
      specs.push({ t: "couple", a: u.box.key, b: r.box.key, style: r.p.style, labels: r.p.labels, level, junction: jkey });
    });
    // A row of children that reaches up into this row (a partner's parents) pushes it aside.
    const clash = kids.rows.get(g);
    const mine = blk.rows.get(g)!;
    if (clash && clash[0] < mine[1] + m.gap && clash[1] + m.gap > mine[0]) kids.shift(mine[1] + m.gap - clash[0]);
    blk.merge(kids, 0);
    addAbove(blk, row.map((r) => r.p), g);
    return blk;
  }

  /** Partners' parents, centred above them where there's room. */
  function addAbove(blk: Block, ps: (Partnership | undefined)[], g: number) {
    let right = -Infinity;
    for (const p of ps) {
      if (!p?.above) continue;
      const a = p.above;
      const child = blk.byKey.get(p.partner.key)!;
      const sz = a.parents.map(size);
      const gap = labelGap(a.labels);
      const width = sz.reduce((s, x) => s + x.w, 0) + (sz.length - 1) * gap;
      let x = Math.max(centreOf(child) - width / 2, right + m.gap);
      const keys: string[] = [];
      a.parents.forEach((b, i) => {
        blk.add({ key: b.key, x, row: g - 1, ...sz[i], box: b });
        keys.push(b.key);
        x += sz[i].w + gap;
      });
      right = x - gap;
      const first = blk.byKey.get(keys[0])!;
      const j = keys.length === 2 ? first.x + first.w + gap / 2 : centreOf(first);
      blk.add({ key: `j:${a.key}`, x: j, row: g - 1, w: 0, h: 0, jy: keys.length === 2 ? "mid" : "bottom", of: keys[0] });
      if (keys.length === 2) specs.push({ t: "couple", a: keys[0], b: keys[1], style: a.style, labels: a.labels, level: 0, junction: `j:${a.key}` });
      specs.push({ t: "descent", from: `j:${a.key}`, kids: [{ key: p.partner.key, drop: a.drop }], people: keys });
    }
  }

  /** A parent in the line: their partners on the outer side, their own parents above. */
  function sideBlock(s: Side, outer: "left" | "right"): Block {
    const own = unitBlock(s.unit, outer);
    return s.up ? lineageBlock(s.up, own, s.unit.box.key, outer === "left" ? "right" : "left") : own;
  }

  /** A couple in the line with their families on either side and their children between. */
  function lineageBlock(l: Lineage, lineBlock: Block, lineKey: string, lineEdge: "left" | "right" | null): Block {
    const kids = [...l.kids];
    if (lineEdge) {
      const at = kids.findIndex((k) => k.line);
      const [line] = kids.splice(at, 1);
      lineEdge === "left" ? kids.unshift(line) : kids.push(line);
    }
    const k = kidsBlock(kids, lineBlock, lineKey);
    const left = sideBlock(l.left, "left");
    const a1 = left.byKey.get(l.left.unit.box.key)!;
    const g = a1.row;
    const out = new Block();
    let j: number;
    let kx: number;
    if (l.right) {
      const right = sideBlock(l.right, "right");
      const a2 = right.byKey.get(l.right.unit.box.key)!;
      const gap = labelGap(l.labels);
      const a2x = a2.x;
      let r = Math.max(sep(left, right, m.gap), a1.x + a1.w + gap - a2x);
      const kMin = sep(left, k.block, m.gap);
      for (let i = 0; ; i++) {
        j = (a1.x + a1.w + a2x + r) / 2;
        kx = Math.max(j - k.mid, kMin);
        k.block.shift(kx);
        const need = sep(k.block, right, m.gap);
        k.block.shift(-kx);
        if (r >= need || i > 20) break;
        r = need;
      }
      out.merge(left, 0);
      out.merge(right, r);
      specs.push({ t: "couple", a: l.left.unit.box.key, b: l.right.unit.box.key, style: l.style, labels: l.labels, level: 0, junction: `j:${l.key}` });
    } else {
      j = centreOf(a1);
      kx = Math.max(j - k.mid, sep(left, k.block, m.gap));
      out.merge(left, 0);
    }
    out.merge(k.block, kx);
    out.add({ key: `j:${l.key}`, x: j, row: g, w: 0, h: 0, jy: l.right ? "mid" : "bottom", of: l.left.unit.box.key });
    specs.push({
      t: "descent",
      from: `j:${l.key}`,
      kids: kids.map((x) => ({ key: kidKey(x, lineKey), drop: x.drop })),
      people: [l.left.unit.box.key, ...(l.right ? [l.right.unit.box.key] : [])],
    });
    return out;
  }

  const centreBlock = unitBlock(spec.centre, "both");
  const root = spec.lineage ? lineageBlock(spec.lineage, centreBlock, spec.centre.box.key, null) : centreBlock;
  for (const c of spec.connectors) specs.push({ t: "connector", ...c });
  // Every row is as tall as the tallest box (boxes sit in the middle of their row).
  return resolve(root, specs, m, spec.boxes.some(m.tall) ? m.cardH : m.boxH);
}

/**
 * Positions closest to `want` (by index; others free) that never decrease
 * (pool-adjacent-violators); indexes without a wish follow their neighbours.
 */
function isotonic(n: number, want: Map<number, number>): number[] {
  const idx = [...want.keys()].sort((a, b) => a - b);
  const pools: { sum: number; count: number; members: number[] }[] = [];
  for (const i of idx) {
    pools.push({ sum: want.get(i)!, count: 1, members: [i] });
    while (pools.length > 1 && pools[pools.length - 2].sum / pools[pools.length - 2].count > pools[pools.length - 1].sum / pools[pools.length - 1].count) {
      const last = pools.pop()!;
      const prev = pools[pools.length - 1];
      prev.sum += last.sum;
      prev.count += last.count;
      prev.members.push(...last.members);
    }
  }
  const at = new Map<number, number>();
  for (const p of pools) for (const i of p.members) at.set(i, p.sum / p.count);
  const out: number[] = [];
  let prev: number | undefined;
  for (let i = 0; i < n; i++) {
    if (at.has(i)) prev = at.get(i);
    out.push(prev ?? NaN);
  }
  // Before the first wish: like the first.
  const first = out.find((v) => !Number.isNaN(v)) ?? 0;
  return out.map((v) => (Number.isNaN(v) ? first : v));
}

/** Pixel positions, then the lines and labels between them. */
function resolve(root: Block, specs: Spec[], m: Metrics, rowH: number): TreeLayout {
  const rowTop = (row: number) => row * (rowH + m.rowGap);
  const pos = new Map<string, Item & { y: number }>();
  for (const it of root.items) pos.set(it.key, { ...it, y: rowTop(it.row) + (rowH - it.h) / 2 });
  const boxes: Placed[] = [];
  for (const it of pos.values()) if (it.box) boxes.push({ key: it.key, box: it.box, x: it.x, y: it.y, w: it.w, h: it.h });
  const mid = (row: number) => rowTop(row) + rowH / 2;
  const bottom = (row: number) => rowTop(row) + rowH;
  const below = (row: number, level: number) => bottom(row) + 6 + 6 * level;
  const boxBottom = (key: string | undefined, row: number) => {
    const b = key ? pos.get(key) : undefined;
    return b ? b.y + b.h : bottom(row);
  };
  const jy = (it: Item) => (it.jy === "mid" ? mid(it.row) : it.jy === "bottom" ? boxBottom(it.of, it.row) : below(it.row, it.jy ?? 0));
  const cx = (it: Item) => it.x + it.w / 2;
  const lines: TreeLine[] = [];
  const labels: TreeLabel[] = [];
  const r = (n: number) => Math.round(n * 10) / 10;
  for (const s of specs) {
    if (s.t === "couple") {
      const a = pos.get(s.a);
      const b = pos.get(s.b);
      const j = pos.get(s.junction);
      if (!a || !b || !j) continue;
      const [l, rt] = a.x < b.x ? [a, b] : [b, a];
      let y: number;
      if (s.level === 0) {
        y = mid(a.row);
        lines.push({ d: `M${r(l.x + l.w)},${r(y)}H${r(rt.x)}`, style: s.style, kind: "couple", people: [s.a, s.b] });
      } else {
        // Not side by side: the line runs under the boxes between them.
        y = below(a.row, s.level);
        const from = a.x < b.x ? a.x + a.w * 0.75 : a.x + a.w * 0.25;
        lines.push({ d: `M${r(from)},${r(a.y + a.h)}V${r(y)}H${r(cx(b))}V${r(b.y + b.h)}`, style: s.style, kind: "couple", people: [s.a, s.b] });
      }
      s.labels.forEach((lab, i) => labels.push({ x: j.x, y: i === 0 ? y - 4 : y + 12, text: lab.text, spoiler: lab.spoiler }));
    } else if (s.t === "descent") {
      const j = pos.get(s.from);
      const kids = s.kids.map((k) => ({ it: pos.get(k.key), drop: k.drop })).filter((k) => k.it);
      if (!j || !kids.length) continue;
      const bar = bottom(j.row) + m.rowGap / 2;
      const xs = kids.map((k) => cx(k.it!));
      const style = kids.every((k) => k.drop === kids[0].drop) ? kids[0].drop : "solid";
      const lo = Math.min(j.x, ...xs);
      const hi = Math.max(j.x, ...xs);
      const people = [...s.people, ...s.kids.map((k) => k.key)];
      lines.push({ d: `M${r(j.x)},${r(jy(j))}V${r(bar)}${hi - lo > 0.5 ? `M${r(lo)},${r(bar)}H${r(hi)}` : ""}`, style, kind: "descent", people });
      kids.forEach((k, i) => lines.push({ d: `M${r(xs[i])},${r(bar)}V${r(k.it!.y)}`, style: k.drop, kind: "descent", people: [...s.people, s.kids[i].key] }));
    } else {
      const a = pos.get(s.from);
      const b = pos.get(s.to);
      if (!a || !b) continue;
      const turn = b.y - m.rowGap / 3;
      lines.push({ d: `M${r(cx(a))},${r(a.y + a.h)}V${r(turn)}H${r(cx(b))}V${r(b.y)}`, style: s.style, kind: "connector", people: [s.from, s.to] });
    }
  }
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of boxes) {
    bounds.minX = Math.min(bounds.minX, b.x);
    bounds.minY = Math.min(bounds.minY, b.y);
    bounds.maxX = Math.max(bounds.maxX, b.x + b.w);
    bounds.maxY = Math.max(bounds.maxY, b.y + b.h);
  }
  return { boxes, lines, labels, bounds };
}

/** Trees one below another, left-aligned, `gap` apart ("All families"). */
export function stackLayouts(layouts: TreeLayout[], gap: number): TreeLayout {
  const out: TreeLayout = { boxes: [], lines: [], labels: [], bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
  let top = 0;
  for (const l of layouts) {
    if (!l.boxes.length) continue;
    const dx = -l.bounds.minX;
    const dy = top - l.bounds.minY;
    // Paths are written as M x,y / H x / V y only.
    const move = (d: string) =>
      d.replace(/([MHV])(-?[\d.]+)(?:,(-?[\d.]+))?/g, (_, c: string, a: string, b?: string) =>
        c === "M" ? `M${+a + dx},${+b! + dy}` : c === "H" ? `H${+a + dx}` : `V${+a + dy}`,
      );
    out.boxes.push(...l.boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })));
    out.lines.push(...l.lines.map((x) => ({ ...x, d: move(x.d) })));
    out.labels.push(...l.labels.map((x) => ({ ...x, x: x.x + dx, y: x.y + dy })));
    out.bounds.minX = Math.min(out.bounds.minX, 0);
    out.bounds.minY = Math.min(out.bounds.minY, top);
    out.bounds.maxX = Math.max(out.bounds.maxX, l.bounds.maxX + dx);
    out.bounds.maxY = top + l.bounds.maxY - l.bounds.minY;
    top = out.bounds.maxY + gap;
  }
  return out;
}
