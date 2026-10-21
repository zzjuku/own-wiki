// The graph's force layout (ForceAtlas2), run in a web worker so thousands
// of nodes don't freeze the window. Positions go back to the window every
// few dozen milliseconds while it runs, so the graph settles visibly.
// (graphology's own worker is created from a blob, which the app's content
// policy doesn't allow; this one is a normal file.)
import iterate from "graphology-layout-forceatlas2/iterate.js";
import type { LayoutRequest, LayoutUpdate } from "./layout";

/** Fields per node and per edge in ForceAtlas2's matrices. */
const PPN = 10;
const PPE = 3;
/** Work this long between updates to the window. */
const SLICE_MS = 40;

let run = 0;
let nodes = new Float32Array(0);

function settingsFor(order: number) {
  // As graphology's inferSettings, plus a pull towards the middle that keeps
  // pages without links close by.
  return {
    linLogMode: false,
    outboundAttractionDistribution: false,
    adjustSizes: false,
    edgeWeightInfluence: 1,
    scalingRatio: order > 2000 ? 10 : order > 100 ? 4 : 2,
    strongGravityMode: true,
    gravity: order > 2000 ? 0.05 : 0.08,
    slowDown: 1 + Math.log(Math.max(order, 1)),
    barnesHutOptimize: order > 500,
    barnesHutTheta: 0.6,
  };
}

function start(req: LayoutRequest) {
  const id = ++run;
  const order = req.positions.length / 2;
  nodes = new Float32Array(order * PPN);
  const degree = new Float32Array(order);
  for (let e = 0; e < req.edges.length; e += 2) {
    degree[req.edges[e]] += 1;
    degree[req.edges[e + 1]] += 1;
  }
  for (let i = 0; i < order; i++) {
    const j = i * PPN;
    nodes[j] = req.positions[i * 2];
    nodes[j + 1] = req.positions[i * 2 + 1];
    nodes[j + 6] = 1 + degree[i];
    nodes[j + 7] = 1;
    nodes[j + 8] = 1;
    nodes[j + 9] = req.fixed[i] ? 1 : 0;
  }
  const edges = new Float32Array((req.edges.length / 2) * PPE);
  for (let e = 0, k = 0; e < req.edges.length; e += 2, k += PPE) {
    edges[k] = req.edges[e] * PPN;
    edges[k + 1] = req.edges[e + 1] * PPN;
    edges[k + 2] = 1;
  }
  const settings = settingsFor(order);
  let done = 0;
  const step = () => {
    if (id !== run) return;
    const before = positions();
    const t0 = performance.now();
    let n = 0;
    while (done < req.iterations && performance.now() - t0 < SLICE_MS) {
      iterate(settings, nodes, edges);
      done++;
      n++;
    }
    const now = positions();
    // Settled: the nodes moved only a tiny part of the graph's size per round.
    const finished = done >= req.iterations || (done >= req.minIterations && movement(before, now, req.fixed) / Math.max(n, 1) < 0.0005);
    const update: LayoutUpdate = { run: req.run, positions: now, done: finished };
    postMessage(update, { transfer: [now.buffer] });
    if (!finished) setTimeout(step, 0);
  };
  step();
}

function positions(): Float32Array {
  const order = nodes.length / PPN;
  const out = new Float32Array(order * 2);
  for (let i = 0; i < order; i++) {
    out[i * 2] = nodes[i * PPN];
    out[i * 2 + 1] = nodes[i * PPN + 1];
  }
  return out;
}

/** Average distance moved by free nodes, relative to the spread of the graph. */
function movement(a: Float32Array, b: Float32Array, fixed: Uint8Array): number {
  let sum = 0;
  let count = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < a.length; i += 2) {
    const x = b[i], y = b[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (fixed[i / 2]) continue;
    sum += Math.hypot(x - a[i], y - a[i + 1]);
    count++;
  }
  const spread = Math.max(maxX - minX, maxY - minY, 1);
  return count ? sum / count / spread : 0;
}

onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: "start"; request: LayoutRequest } | { type: "stop" } | { type: "move"; index: number; x: number; y: number; fixed: boolean };
  if (msg.type === "start") start(msg.request);
  else if (msg.type === "stop") run++;
  else if (msg.type === "move" && msg.index * PPN < nodes.length) {
    const j = msg.index * PPN;
    nodes[j] = msg.x;
    nodes[j + 1] = msg.y;
    nodes[j + 2] = nodes[j + 3] = nodes[j + 4] = nodes[j + 5] = 0;
    nodes[j + 9] = msg.fixed ? 1 : 0;
  }
};
