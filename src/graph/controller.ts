// Draws the graph with sigma.js (WebGL) and makes it feel alive, Obsidian-
// style: the physics (physics.ts) runs all the time, so dragging a node pulls
// its neighbours along and it springs back when let go; settled, the graph
// keeps drifting gently. Resting on a node fades the rest of the graph out
// smoothly and brings the node and its neighbours forward; names fade in as
// you zoom in. Where the nodes sit is remembered (saved when the graph comes
// to rest), so opening the graph again shows the same picture.
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram, EdgeDoubleArrowProgram, EdgeRectangleProgram } from "sigma/rendering";
import type { CameraState } from "sigma/types";
import { NodeGlowProgram } from "./glow";
import { edgeLabel, type Model, type ModelEdge, type ModelNode } from "./model";
import { LINK_DISTANCE, Physics } from "./physics";

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

/** Where the view was: the camera and the frame it's measured in. */
export interface ViewState {
  camera: CameraState;
  bbox: { x: [number, number]; y: [number, number] } | null;
}

/** Remembered node positions (graph coordinates). */
export interface SavedLayout {
  positions: Record<string, [number, number]>;
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
  /** Positions worth remembering (the graph came to rest, or the screen closes). */
  save(layout: SavedLayout): void;
}

const HOVER_DELAY_MS = 400;
/** How long the fade in and out around a hovered node takes. */
const FADE_MS = 220;
/** Names fade in while linked pages get from this far apart on screen to the next (bigger pages earlier). */
const LABEL_FROM_PX = 80;
const LABEL_TO_PX = 130;

const nodeSize = (degree: number) => Math.min(3 + 1.4 * Math.sqrt(degree), 14);

type Rgb = [number, number, number];
const parseRgb = (c: string): Rgb => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
};
/** `a` moved `t` of the way to `b`, in a few steps (sigma keeps every colour string it sees). */
function mix(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const q = Math.round(t * 12) / 12;
  const x = parseRgb(a);
  const y = parseRgb(b);
  return `rgba(${x.map((v, i) => Math.round(v + (y[i] - v) * q)).join(",")},1)`;
}

export class GraphController {
  readonly graph = new Graph<NodeAttrs, EdgeAttrs>({ type: "undirected", allowSelfLoops: false });
  readonly sigma: Sigma<NodeAttrs, EdgeAttrs>;
  private physics: Physics;
  /** The node order the physics knows. */
  private order: string[] = [];
  private index = new Map<string, number>();
  private colors: GraphColors;
  private arrows = false;
  private spoilers = false;
  /** Search matches: drawn highlighted. */
  private marked = new Set<string>();
  // Hover: the node, its neighbours, and how far the fade has got (0–1).
  private hovered: string | null = null;
  private focusSet = new Set<string>();
  private fade = 0;
  private fadeFrom = 0;
  private fadeStart = 0;
  private fadeTo = 0;
  private fadeFrame = 0;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private dragged: string | null = null;
  private dragMoved = false;
  /** Labels' fade by zoom: how far apart linked pages are on screen. */
  private spacingPx = 0;
  private everSettled = false;
  /** Show the whole graph once a new layout has settled. */
  private fitWhenSettled = false;
  private onVisibility = () => this.physics.pause(document.hidden);

  constructor(container: HTMLElement, colors: GraphColors, private events: ControllerEvents) {
    this.colors = colors;
    this.physics = new Physics((positions, settled) => this.frame(positions, settled));
    this.sigma = new Sigma<NodeAttrs, EdgeAttrs>(this.graph, container, {
      allowInvalidContainer: true,
      renderEdgeLabels: true,
      labelRenderedSizeThreshold: 0,
      labelDensity: 0.9,
      labelGridCellSize: 110,
      // Nodes grow a little when zooming in, and don't shrink when zooming out.
      zoomToSizeRatioFunction: (r) => (r < 1 ? r ** 0.35 : 1),
      zIndex: true,
      minCameraRatio: 0.03,
      maxCameraRatio: 6,
      stagePadding: 30,
      zoomDuration: 220,
      inertiaDuration: 400,
      defaultNodeType: "glow",
      nodeProgramClasses: { glow: NodeGlowProgram },
      defaultEdgeType: "line",
      edgeProgramClasses: { line: EdgeRectangleProgram, arrow: EdgeArrowProgram, both: EdgeDoubleArrowProgram },
      nodeReducer: (key, attrs) => this.nodeLook(key, attrs),
      edgeReducer: (key, attrs) => this.edgeLook(key, attrs),
      defaultDrawNodeLabel: (ctx, data, settings) => this.drawLabel(ctx, data, settings, false),
      defaultDrawNodeHover: (ctx, data, settings) => this.drawLabel(ctx, data, settings, true),
    });
    this.applyColors();
    this.bindEvents();
    document.addEventListener("visibilitychange", this.onVisibility);
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
    const f = this.fade;
    if (f > 0 && this.hovered) {
      if (key === this.hovered) return { ...base, size: a.size * (1 + 0.3 * f), color: mix(base.color, this.colors.active, f), forceLabel: true, zIndex: 3 };
      if (this.focusSet.has(key)) return { ...base, size: a.size * (1 + 0.1 * f), forceLabel: f > 0.5, zIndex: 2 };
      // The rest steps back: paler and a little smaller, names gone.
      return { ...base, size: a.size * (1 - 0.25 * f), color: mix(base.color, this.colors.faded, f), label: f > 0.3 ? "" : a.label, zIndex: 0 };
    }
    if (this.marked.has(key)) return { ...base, color: this.colors.active, forceLabel: true, zIndex: 2 };
    if (key === this.dragged) return { ...base, forceLabel: true, zIndex: 2 };
    return { ...base, zIndex: 1 };
  }

  private edgeLook(key: string, a: EdgeAttrs) {
    const e = a.edge;
    const type = this.arrows && e.kind === "link" ? (e.forward && e.backward ? "both" : "arrow") : "line";
    const f = this.fade;
    if (f > 0 && this.hovered) {
      const [s, t] = this.graph.extremities(key);
      if (s !== this.hovered && t !== this.hovered) return { size: a.size, color: mix(this.colors.line, this.colors.faded, f), type, zIndex: 0, label: "" };
      return {
        size: a.size * (1 + 0.8 * f),
        color: mix(this.colors.line, this.colors.lineActive, f),
        type,
        zIndex: 2,
        label: f > 0.5 ? edgeLabel(e, this.spoilers) : "",
        forceLabel: true,
      };
    }
    return { size: a.size, color: this.colors.line, type, label: "", zIndex: 1 };
  }

  /** How strongly a node's name shows at this zoom (bigger nodes earlier). */
  private labelAlpha(size: number): number {
    const px = this.spacingPx * (0.55 + size / 14);
    return Math.max(0, Math.min(1, (px - LABEL_FROM_PX) / (LABEL_TO_PX - LABEL_FROM_PX)));
  }

  /** A name beside its node, with a soft outline in the background colour; the hovered one on a small box. */
  private drawLabel(
    ctx: CanvasRenderingContext2D,
    data: { x: number; y: number; size: number; label: string | null; forceLabel?: boolean },
    settings: { labelSize: number; labelFont: string; labelWeight: string },
    hovered: boolean,
  ) {
    if (!data.label) return;
    const alpha = hovered || data.forceLabel ? 1 : this.labelAlpha(data.size);
    if (alpha <= 0.02) return;
    const size = settings.labelSize;
    ctx.font = `${hovered ? "600" : settings.labelWeight} ${size}px ${settings.labelFont}`;
    const x = data.x + data.size + 4;
    const y = data.y + size / 3;
    ctx.globalAlpha = alpha;
    if (hovered) {
      const w = ctx.measureText(data.label).width;
      ctx.fillStyle = this.colors.bg;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.roundRect(x - 4, data.y - size / 2 - 4, w + 8, size + 8, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = this.colors.bg;
      ctx.strokeText(data.label, x, y);
    }
    ctx.fillStyle = this.colors.label;
    ctx.fillText(data.label, x, y);
    ctx.globalAlpha = 1;
  }

  // ---- contents ----

  /**
   * Shows `model`. Nodes already shown keep their place; others take their
   * remembered place from `saved`, else start next to their neighbours (or
   * anywhere, the first time). Then the physics settles them in.
   */
  setModel(model: Model, saved: SavedLayout | null) {
    const g = this.graph;
    const wanted = new Set(model.nodes.map((n) => n.key));
    g.forEachNode((key) => {
      if (!wanted.has(key)) g.dropNode(key);
    });
    const fresh: string[] = [];
    let known = 0;
    for (const n of model.nodes) {
      const size = nodeSize(n.degree);
      if (g.hasNode(n.key)) {
        g.mergeNodeAttributes(n.key, { size, label: n.label, node: n });
        known++;
        continue;
      }
      const p = saved?.positions[n.key];
      g.addNode(n.key, { x: p ? p[0] : 0, y: p ? p[1] : 0, size, label: n.label, node: n });
      if (p) known++;
      else fresh.push(n.key);
    }
    const edges = new Set(model.edges.map((e) => e.key));
    g.forEachEdge((key) => {
      if (!edges.has(key)) g.dropEdge(key);
    });
    for (const e of model.edges) {
      const size = e.kind === "link" ? 0.9 : 0.6;
      if (g.hasEdge(e.key)) g.mergeEdgeAttributes(e.key, { edge: e, size });
      else if (!g.hasEdge(e.source, e.target)) g.addEdgeWithKey(e.key, e.source, e.target, { edge: e, size });
    }
    if (!known) this.scatter(g.nodes());
    else this.placeNear(fresh);
    this.fitWhenSettled = !known;
    // Nothing new: only a little settling. New pages: more. Everything new: a whole layout.
    this.startPhysics(!known ? 1 : fresh.length ? 0.3 : 0.08);
  }

  /** Lays everything out anew. */
  rearrange() {
    this.scatter(this.graph.nodes());
    this.startPhysics(1);
    this.fitWhenSettled = true;
  }

  /** Random spots in a disc: a neutral start. */
  private scatter(keys: string[]) {
    const r = 12 * Math.sqrt(keys.length + 1);
    for (const key of keys) {
      const t = Math.random() * 2 * Math.PI;
      const d = r * Math.sqrt(Math.random());
      this.graph.mergeNodeAttributes(key, { x: d * Math.cos(t), y: d * Math.sin(t) });
    }
  }

  /** New nodes next to their placed neighbours (else at the edge of the graph). */
  private placeNear(fresh: string[]) {
    const g = this.graph;
    const isFresh = new Set(fresh);
    let reach = 50;
    g.forEachNode((key, a) => {
      if (!isFresh.has(key)) reach = Math.max(reach, Math.hypot(a.x, a.y));
    });
    for (const key of fresh) {
      let x = 0, y = 0, k = 0;
      g.forEachNeighbor(key, (nb, a) => {
        if (isFresh.has(nb)) return;
        x += a.x;
        y += a.y;
        k++;
      });
      const t = Math.random() * 2 * Math.PI;
      const near = k ? [x / k + Math.cos(t) * LINK_DISTANCE * 0.5, y / k + Math.sin(t) * LINK_DISTANCE * 0.5] : [Math.cos(t) * reach, Math.sin(t) * reach];
      g.mergeNodeAttributes(key, { x: near[0], y: near[1] });
    }
  }

  private startPhysics(alpha: number) {
    const g = this.graph;
    this.order = g.nodes();
    this.index = new Map(this.order.map((k, i) => [k, i]));
    const positions = new Float32Array(this.order.length * 2);
    const radius = new Float32Array(this.order.length);
    this.order.forEach((k, i) => {
      const a = g.getNodeAttributes(k);
      positions[i * 2] = a.x;
      positions[i * 2 + 1] = a.y;
      radius[i] = a.size * 0.6;
    });
    const edges = new Uint32Array(g.size * 2);
    let j = 0;
    g.forEachEdge((_, __, s, t) => {
      edges[j++] = this.index.get(s)!;
      edges[j++] = this.index.get(t)!;
    });
    this.everSettled = alpha < 0.1;
    this.physics.start(positions, radius, edges, alpha, true);
    this.sigma.refresh();
    this.measure();
  }

  /** One frame of the physics. */
  private frame(positions: Float32Array, settled: boolean) {
    const keys = this.order;
    if (positions.length !== keys.length * 2) return;
    const g = this.graph;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === this.dragged || !g.hasNode(keys[i])) continue;
      const a = g.getNodeAttributes(keys[i]);
      a.x = positions[i * 2];
      a.y = positions[i * 2 + 1];
    }
    // Tell sigma the positions changed (one event for all nodes).
    g.updateEachNodeAttributes((_, a) => a, { attributes: ["x", "y"] });
    if (settled) {
      // A new layout ends with a smooth move to show all of it.
      if (!this.everSettled && this.fitWhenSettled) void this.fitNodes(700);
      this.fitWhenSettled = false;
      this.everSettled = true;
      this.save();
    }
  }

  /** The graph has come to rest at least once (positions saved). */
  get settled(): boolean {
    return this.everSettled;
  }

  private save() {
    const positions: SavedLayout["positions"] = {};
    this.graph.forEachNode((key, a) => {
      positions[key] = [Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10];
    });
    this.events.save({ positions });
  }

  // ---- camera ----

  /**
   * The view frame stays put while nodes move (sigma would otherwise refit the
   * graph every frame): a square around the middle, big enough for the graph.
   */
  private frameBox() {
    // A new layout spreads out as it settles: room for about that much.
    let reach = this.fitWhenSettled ? 18 * Math.sqrt(this.graph.order) + 60 : 60;
    this.graph.forEachNode((_, a) => {
      reach = Math.max(reach, Math.abs(a.x), Math.abs(a.y));
    });
    const r = Math.max(reach * 1.1, 200);
    this.sigma.setCustomBBox({ x: [-r, r], y: [-r, r] });
  }

  /** How far apart linked pages are drawn now; names fade by it. */
  private measure() {
    const a = this.sigma.graphToViewport({ x: 0, y: 0 });
    const b = this.sigma.graphToViewport({ x: LINK_DISTANCE, y: 0 });
    this.spacingPx = Math.hypot(b.x - a.x, b.y - a.y);
  }

  getCamera(): CameraState {
    return this.sigma.getCamera().getState();
  }

  getView(): ViewState {
    return { camera: this.getCamera(), bbox: this.sigma.getCustomBBox() };
  }

  setView(view: ViewState) {
    this.sigma.setCustomBBox(view.bbox);
    this.sigma.getCamera().setState(view.camera);
    this.measure();
  }

  /** The whole graph (a new layout: the space it will need). */
  fitView() {
    this.frameBox();
    this.sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    this.measure();
  }

  /** Moves the view so every node shows. */
  private fitNodes(duration: number) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.graph.forEachNode((key) => {
      const d = this.sigma.getNodeDisplayData(key);
      if (!d) return;
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y);
      maxY = Math.max(maxY, d.y);
    });
    if (!Number.isFinite(minX)) return;
    const ratio = Math.min(Math.max(Math.max(maxX - minX, maxY - minY) * 1.15, 0.15), 1.5);
    return this.sigma.getCamera().animate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio, angle: 0 }, { duration });
  }

  /** Moves the view to a node (search). */
  focus(key: string) {
    const d = this.sigma.getNodeDisplayData(key);
    if (!d) return;
    void this.sigma.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(this.sigma.getCamera().ratio, 0.4) }, { duration: 500 });
  }

  /** Where a node is on screen. */
  nodeRect(key: string): DOMRect | null {
    if (!this.graph.hasNode(key)) return null;
    const a = this.graph.getNodeAttributes(key);
    const p = this.sigma.graphToViewport({ x: a.x, y: a.y });
    const box = this.sigma.getContainer().getBoundingClientRect();
    const r = this.sigma.scaleSize(a.size);
    return new DOMRect(box.left + p.x - r, box.top + p.y - r, r * 2, r * 2);
  }

  // ---- mouse ----

  /** Starts fading towards `key` highlighted (or back, with null). */
  private setHovered(key: string | null) {
    if (key) {
      this.hovered = key;
      this.focusSet = new Set(this.graph.neighbors(key));
    }
    this.fadeFrom = this.fade;
    this.fadeTo = key ? 1 : 0;
    this.fadeStart = performance.now();
    cancelAnimationFrame(this.fadeFrame);
    const step = (now: number) => {
      const t = Math.min(1, (now - this.fadeStart) / FADE_MS);
      const eased = 1 - (1 - t) ** 3;
      this.fade = this.fadeFrom + (this.fadeTo - this.fadeFrom) * eased;
      if (t >= 1 && !this.fadeTo) this.hovered = null;
      this.sigma.refresh({ skipIndexation: true });
      if (t < 1) this.fadeFrame = requestAnimationFrame(step);
    };
    this.fadeFrame = requestAnimationFrame(step);
  }

  private bindEvents() {
    const s = this.sigma;
    const g = this.graph;
    s.on("enterNode", ({ node }) => {
      if (this.dragged) return;
      this.setHovered(node);
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        if (this.hovered === node && this.fadeTo && !this.dragged) this.events.hover(g.getNodeAttribute(node, "node"), this.nodeRect(node));
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
      event.preventSigmaDefault();
    });
    s.on("moveBody", ({ event }) => {
      if (!this.dragged) return;
      const p = s.viewportToGraph(event);
      g.mergeNodeAttributes(this.dragged, { x: p.x, y: p.y });
      this.dragMoved = true;
      const i = this.index.get(this.dragged);
      if (i !== undefined) this.physics.drag(i, p.x, p.y);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    const up = () => {
      const node = this.dragged;
      if (!node) return;
      this.dragged = null;
      const i = this.index.get(node);
      if (i !== undefined) this.physics.release(i);
      if (!this.dragMoved) this.events.open(g.getNodeAttribute(node, "node"));
    };
    s.on("upNode", up);
    s.on("upStage", up);
    // Moving the view hides the hover card; names fade by the zoom.
    s.getCamera().on("updated", () => {
      if (!this.dragged) this.events.hover(null, null);
      this.measure();
    });
  }

  destroy() {
    clearTimeout(this.hoverTimer);
    cancelAnimationFrame(this.fadeFrame);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.graph.order) this.save();
    this.physics.destroy();
    this.sigma.kill();
  }
}
