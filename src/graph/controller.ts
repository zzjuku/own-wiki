// Draws the graph with sigma.js (WebGL) and handles the mouse: zoom, pan,
// dragging nodes, hover highlight (the node and its neighbours; the rest
// fades) and clicks. Node positions come from the remembered layout, and
// otherwise from the force layout in a worker (layout.ts).
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram, EdgeDoubleArrowProgram, EdgeRectangleProgram } from "sigma/rendering";
import type { CameraState } from "sigma/types";
import { Layout } from "./layout";
import { edgeLabel, type Model, type ModelEdge, type ModelNode } from "./model";

export interface GraphColors {
  bg: string;
  node: string;
  active: string;
  faded: string;
  line: string;
  lineActive: string;
  label: string;
  missing: string;
  category: string;
  group: string;
  font: string;
}

/** Remembered node positions (graph coordinates) and the area they span. */
export interface SavedLayout {
  positions: Record<string, [number, number]>;
  bbox?: { x: [number, number]; y: [number, number] };
  /** Left before the layout finished: it goes on from here next time. */
  unsettled?: boolean;
}

interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  node: ModelNode;
}

interface EdgeAttrs {
  edge: ModelEdge;
  size: number;
}

export interface ControllerEvents {
  /** A node was clicked (not dragged). */
  open(node: ModelNode): void;
  /** The mouse rests on a node (null: left it); `rect` is where it is on screen. */
  hover(node: ModelNode | null, rect: DOMRect | null): void;
  /** Positions changed and should be remembered (layout finished, node dragged). */
  save(layout: SavedLayout): void;
}

/** Most rounds a full layout runs, by size (it usually settles sooner). */
const fullRounds = (n: number) => (n > 2000 ? 700 : n > 300 ? 1000 : 1500);
/** Rounds for placing new nodes among fixed old ones. */
const PLACE_ROUNDS = 150;
const HOVER_DELAY_MS = 400;

const nodeSize = (degree: number) => Math.min(4 + 1.8 * Math.sqrt(degree), 18);
/** Names show when linked pages are about this far apart on screen (big pages from half of it). */
const LABEL_SPACING_PX = 90;
/** A newly laid out graph starts zoomed out until linked pages are about this far apart. */
const START_SPACING_PX = 70;

export class GraphController {
  readonly graph = new Graph<NodeAttrs, EdgeAttrs>({ type: "undirected", allowSelfLoops: false });
  readonly sigma: Sigma<NodeAttrs, EdgeAttrs>;
  private layout: Layout;
  /** The node order of the running layout. */
  private layoutKeys: string[] = [];
  private hovered: string | null = null;
  private neighbours = new Set<string>();
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private dragged: string | null = null;
  private dragMoved = false;
  private colors: GraphColors;
  private arrows = false;
  private spoilers = false;
  /** Search matches: drawn highlighted. */
  private marked = new Set<string>();

  constructor(container: HTMLElement, colors: GraphColors, private events: ControllerEvents) {
    this.colors = colors;
    this.layout = new Layout((positions, done) => this.applyLayout(positions, done));
    this.sigma = new Sigma<NodeAttrs, EdgeAttrs>(this.graph, container, {
      allowInvalidContainer: true,
      renderEdgeLabels: true,
      labelRenderedSizeThreshold: Infinity,
      // Nodes grow a little when zooming in, and don't shrink when zooming out.
      zoomToSizeRatioFunction: (r) => (r < 1 ? Math.sqrt(r) : 1),
      labelDensity: 0.8,
      labelGridCellSize: 120,
      zIndex: true,
      minCameraRatio: 0.02,
      maxCameraRatio: 8,
      stagePadding: 40,
      defaultEdgeType: "line",
      edgeProgramClasses: { line: EdgeRectangleProgram, arrow: EdgeArrowProgram, both: EdgeDoubleArrowProgram },
      nodeReducer: (key, attrs) => this.nodeLook(key, attrs),
      edgeReducer: (key, attrs) => this.edgeLook(key, attrs),
      defaultDrawNodeHover: (ctx, data, settings) => this.drawHover(ctx, data, settings),
    });
    this.applyColors();
    this.bindEvents();
  }

  // ---- looks ----

  setColors(colors: GraphColors) {
    this.colors = colors;
    this.applyColors();
    this.sigma.refresh({ skipIndexation: true });
  }

  private applyColors() {
    const c = this.colors;
    this.sigma.getContainer().style.background = c.bg;
    this.sigma.setSettings({
      labelColor: { color: c.label },
      edgeLabelColor: { color: c.label },
      labelFont: c.font,
      edgeLabelFont: c.font,
      labelSize: 12,
      edgeLabelSize: 11,
    });
  }

  setArrows(on: boolean) {
    if (this.arrows === on) return;
    this.arrows = on;
    this.sigma.refresh({ skipIndexation: true });
  }

  setSpoilers(on: boolean) {
    if (this.spoilers === on) return;
    this.spoilers = on;
    this.sigma.refresh({ skipIndexation: true });
  }

  setMarked(keys: Set<string>) {
    this.marked = keys;
    this.sigma.refresh({ skipIndexation: true });
  }

  private kindColor(n: ModelNode): string {
    const c = this.colors;
    return n.kind === "missing" ? c.missing : n.kind === "category" ? c.category : n.kind === "group" ? c.group : c.node;
  }

  private nodeLook(key: string, a: NodeAttrs) {
    const base = { x: a.x, y: a.y, size: a.size, label: a.label, color: this.kindColor(a.node) };
    if (this.hovered) {
      if (key === this.hovered) return { ...base, color: this.colors.active, forceLabel: true, zIndex: 2, highlighted: true };
      if (this.neighbours.has(key)) return { ...base, forceLabel: true, zIndex: 1 };
      return { ...base, color: this.colors.faded, label: "", zIndex: 0 };
    }
    if (this.marked.has(key)) return { ...base, color: this.colors.active, forceLabel: true, zIndex: 2 };
    if (key === this.dragged) return { ...base, forceLabel: true, zIndex: 2 };
    return base;
  }

  private edgeLook(key: string, a: EdgeAttrs) {
    const e = a.edge;
    const type = this.arrows && e.kind === "link" ? (e.forward && e.backward ? "both" : "arrow") : "line";
    if (this.hovered) {
      const [s, t] = this.graph.extremities(key);
      if (s !== this.hovered && t !== this.hovered) return { size: a.size, color: this.colors.faded, type, zIndex: 0, label: "" };
      return { size: a.size * 1.6, color: this.colors.lineActive, type, zIndex: 1, label: edgeLabel(e, this.spoilers), forceLabel: true };
    }
    return { size: a.size, color: this.colors.line, type, label: "" };
  }

  /** The hovered node's label on a small box in the graph's colours. */
  private drawHover(ctx: CanvasRenderingContext2D, data: { x: number; y: number; size: number; label: string | null }, settings: { labelSize: number; labelFont: string; labelWeight: string }) {
    if (!data.label) return;
    const size = settings.labelSize;
    ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
    const w = ctx.measureText(data.label).width;
    const x = data.x + data.size + 3;
    ctx.fillStyle = this.colors.bg;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(x - 3, data.y - size / 2 - 3, w + 6, size + 6, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.colors.label;
    ctx.fillText(data.label, x, data.y + size / 3);
  }

  // ---- contents ----

  /**
   * Shows `model`. Nodes already shown keep their place; others take their
   * remembered place from `saved`, else start next to their neighbours (or
   * anywhere, the first time) and the layout places them.
   */
  setModel(model: Model, saved: SavedLayout | null) {
    const g = this.graph;
    const wanted = new Map(model.nodes.map((n) => [n.key, n]));
    g.forEachNode((key) => {
      if (!wanted.has(key)) g.dropNode(key);
    });
    const fresh: string[] = [];
    for (const n of model.nodes) {
      const size = nodeSize(n.degree);
      if (g.hasNode(n.key)) {
        g.mergeNodeAttributes(n.key, { size, label: n.label, node: n });
        continue;
      }
      const p = saved?.positions[n.key];
      g.addNode(n.key, { x: p ? p[0] : 0, y: p ? p[1] : 0, size, label: n.label, node: n });
      if (!p) fresh.push(n.key);
    }
    const edges = new Set(model.edges.map((e) => e.key));
    g.forEachEdge((key) => {
      if (!edges.has(key)) g.dropEdge(key);
    });
    for (const e of model.edges) {
      const size = e.kind === "link" ? 1 : 0.6;
      if (g.hasEdge(e.key)) g.mergeEdgeAttributes(e.key, { edge: e, size });
      else if (!g.hasEdge(e.source, e.target)) g.addEdgeWithKey(e.key, e.source, e.target, { edge: e, size });
    }
    if (fresh.length === g.order && g.order > 0) this.rearrange();
    else if (saved?.unsettled && fresh.length < g.order) this.runLayout(new Set(), fullRounds(g.order));
    else {
      if (saved?.bbox && !this.sigma.getCustomBBox()) this.sigma.setCustomBBox(saved.bbox);
      if (fresh.length) this.place(fresh);
      else this.sigma.refresh();
      this.measure();
    }
  }

  /** Lays everything out anew. */
  rearrange() {
    const n = this.graph.order;
    const r = 10 * Math.sqrt(n + 1);
    this.graph.updateEachNodeAttributes(
      (_, a) => {
        // Random spot in a disc: a neutral start for the layout.
        const t = Math.random() * 2 * Math.PI;
        const d = r * Math.sqrt(Math.random());
        a.x = d * Math.cos(t);
        a.y = d * Math.sin(t);
        return a;
      },
      { attributes: ["x", "y"] },
    );
    this.sigma.setCustomBBox(null);
    this.runLayout(new Set(), fullRounds(n));
  }

  /** Puts new nodes next to their placed neighbours and lets the layout fit them in. */
  private place(fresh: string[]) {
    const g = this.graph;
    const isFresh = new Set(fresh);
    const spread = this.spread();
    for (const key of fresh) {
      let x = 0, y = 0, k = 0;
      g.forEachNeighbor(key, (nb, a) => {
        if (isFresh.has(nb)) return;
        x += a.x;
        y += a.y;
        k++;
      });
      const jitter = spread * 0.03;
      const a = g.getNodeAttributes(key);
      if (k) {
        a.x = x / k + (Math.random() - 0.5) * jitter;
        a.y = y / k + (Math.random() - 0.5) * jitter;
      } else {
        // No placed neighbour: at the edge of the graph.
        const t = Math.random() * 2 * Math.PI;
        a.x = Math.cos(t) * spread * 0.5;
        a.y = Math.sin(t) * spread * 0.5;
      }
    }
    const fixed = new Set<string>();
    g.forEachNode((key) => {
      if (!isFresh.has(key)) fixed.add(key);
    });
    this.runLayout(fixed, PLACE_ROUNDS);
  }

  private spread(): number {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.graph.forEachNode((_, a) => {
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x);
      minY = Math.min(minY, a.y);
      maxY = Math.max(maxY, a.y);
    });
    return Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY, 10) : 100;
  }

  private runLayout(fixed: Set<string>, rounds: number) {
    const g = this.graph;
    this.layoutKeys = g.nodes();
    const at = new Map(this.layoutKeys.map((k, i) => [k, i]));
    const positions = new Float32Array(this.layoutKeys.length * 2);
    const fixedFlags = new Uint8Array(this.layoutKeys.length);
    this.layoutKeys.forEach((k, i) => {
      const a = g.getNodeAttributes(k);
      positions[i * 2] = a.x;
      positions[i * 2 + 1] = a.y;
      fixedFlags[i] = fixed.has(k) || k === this.dragged ? 1 : 0;
    });
    const edges = new Uint32Array(g.size * 2);
    let j = 0;
    g.forEachEdge((_, __, s, t) => {
      edges[j++] = at.get(s)!;
      edges[j++] = at.get(t)!;
    });
    this.layout.start(positions, fixedFlags, edges, rounds, fixed.size ? 20 : 60);
    this.sigma.refresh();
  }

  private applyLayout(positions: Float32Array, done: boolean) {
    const keys = this.layoutKeys;
    const g = this.graph;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === this.dragged || !g.hasNode(keys[i])) continue;
      const a = g.getNodeAttributes(keys[i]);
      a.x = positions[i * 2];
      a.y = positions[i * 2 + 1];
    }
    // Tell sigma the positions changed (one event for all nodes).
    g.updateEachNodeAttributes((_, a) => a, { attributes: ["x", "y"] });
    if (done) {
      const fresh = !this.sigma.getCustomBBox();
      if (fresh) this.sigma.setCustomBBox(this.sigma.getBBox());
      this.measure();
      if (fresh) void this.sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: this.startRatio(), angle: 0 }, { duration: 300 });
      this.save();
    }
  }

  get layoutRunning(): boolean {
    return this.layout.running;
  }

  private save(unsettled = false) {
    const positions: SavedLayout["positions"] = {};
    this.graph.forEachNode((key, a) => {
      positions[key] = [Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100];
    });
    const bbox = this.sigma.getCustomBBox() ?? this.sigma.getBBox();
    this.events.save(unsettled ? { positions, bbox, unsettled } : { positions, bbox });
  }

  // ---- camera ----

  /** Median length of a line on screen at the full view (ratio 1), names show by it; -1: not measured yet. */
  private spacing = -1;

  /** Measures how far apart linked nodes are drawn (after the layout or loading positions). */
  private measure() {
    const g = this.graph;
    const full = { x: 0.5, y: 0.5, ratio: 1, angle: 0 };
    const lengths: number[] = [];
    const step = Math.max(1, Math.floor(g.size / 2000));
    let i = 0;
    g.forEachEdge((_, __, s, t) => {
      if (i++ % step) return;
      const a = this.sigma.getNodeDisplayData(s);
      const b = this.sigma.getNodeDisplayData(t);
      if (!a || !b) return;
      const pa = this.sigma.framedGraphToViewport(a, { cameraState: full });
      const pb = this.sigma.framedGraphToViewport(b, { cameraState: full });
      lengths.push(Math.hypot(pa.x - pb.x, pa.y - pb.y));
    });
    lengths.sort((x, y) => x - y);
    this.spacing = lengths.length ? lengths[lengths.length >> 1] : 0;
    this.updateLabels();
  }

  /** The zoom a new layout starts at: the whole graph, but not spread out more than needed. */
  private startRatio(): number {
    return this.spacing > 0 ? Math.min(Math.max(1, this.spacing / START_SPACING_PX), 6) : 1;
  }

  /** Names show once zoomed in far enough (bigger nodes earlier). */
  private updateLabels() {
    const onScreen = this.spacing / this.sigma.getCamera().ratio;
    const threshold = this.spacing < 0 ? Infinity : !this.spacing ? 0 : onScreen >= LABEL_SPACING_PX ? 0 : onScreen >= LABEL_SPACING_PX / 2 ? 10 : Infinity;
    if (this.sigma.getSetting("labelRenderedSizeThreshold") !== threshold) this.sigma.setSetting("labelRenderedSizeThreshold", threshold);
  }

  getCamera(): CameraState {
    return this.sigma.getCamera().getState();
  }

  setCamera(state: CameraState) {
    this.sigma.getCamera().setState(state);
  }

  /** The whole graph, as a new layout starts. */
  fitView() {
    this.sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: this.startRatio(), angle: 0 });
  }

  /** Moves the view to a node (search). */
  focus(key: string) {
    const d = this.sigma.getNodeDisplayData(key);
    if (!d) return;
    void this.sigma.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(this.sigma.getCamera().ratio, 0.4) }, { duration: 400 });
  }

  /** Where a node is on screen. */
  nodeRect(key: string): DOMRect | null {
    if (!this.graph.hasNode(key)) return null;
    const a = this.graph.getNodeAttributes(key);
    const p = this.sigma.graphToViewport({ x: a.x, y: a.y });
    const box = this.sigma.getContainer().getBoundingClientRect();
    const r = this.sigma.scaleSize(this.sigma.getNodeDisplayData(key)?.size ?? a.size);
    return new DOMRect(box.left + p.x - r, box.top + p.y - r, r * 2, r * 2);
  }

  // ---- mouse ----

  private setHovered(key: string | null) {
    this.hovered = key;
    this.neighbours = new Set(key ? this.graph.neighbors(key) : []);
    this.sigma.refresh({ skipIndexation: true });
  }

  private bindEvents() {
    const s = this.sigma;
    const g = this.graph;
    s.on("enterNode", ({ node }) => {
      if (this.dragged) return;
      this.setHovered(node);
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        if (this.hovered === node && !this.dragged) this.events.hover(g.getNodeAttribute(node, "node"), this.nodeRect(node));
      }, HOVER_DELAY_MS);
    });
    s.on("leaveNode", () => {
      if (this.dragged) return;
      clearTimeout(this.hoverTimer);
      this.setHovered(null);
      this.events.hover(null, null);
    });
    s.on("downNode", ({ node, event }) => {
      this.dragged = node;
      this.dragMoved = false;
      clearTimeout(this.hoverTimer);
      this.events.hover(null, null);
      if (!s.getCustomBBox()) s.setCustomBBox(s.getBBox());
      event.preventSigmaDefault();
    });
    s.on("moveBody", ({ event }) => {
      if (!this.dragged) return;
      const p = s.viewportToGraph(event);
      g.mergeNodeAttributes(this.dragged, { x: p.x, y: p.y });
      this.dragMoved = true;
      const i = this.layout.running ? this.layoutKeys.indexOf(this.dragged) : -1;
      if (i >= 0) this.layout.move(i, p.x, p.y, true);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    const up = () => {
      const node = this.dragged;
      if (!node) return;
      this.dragged = null;
      if (this.dragMoved) {
        const a = g.getNodeAttributes(node);
        const i = this.layout.running ? this.layoutKeys.indexOf(node) : -1;
        if (i >= 0) this.layout.move(i, a.x, a.y, false);
        if (!this.layout.running) this.save();
      } else {
        this.events.open(g.getNodeAttribute(node, "node"));
      }
      s.refresh({ skipIndexation: true });
    };
    s.on("upNode", up);
    s.on("upStage", up);
    // Moving the view hides the hover card.
    s.getCamera().on("updated", () => {
      if (!this.dragged) this.events.hover(null, null);
      this.updateLabels();
    });
  }

  destroy() {
    clearTimeout(this.hoverTimer);
    // Positions found by a layout that didn't finish are kept too, so it doesn't start over next time.
    if (this.layout.running && this.graph.order) {
      this.layout.stop();
      this.save(true);
    }
    this.layout.destroy();
    this.sigma.kill();
  }
}
