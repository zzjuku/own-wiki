// The graph's live physics (d3-force, as Obsidian uses), in a web worker so
// thousands of nodes don't hold up the window. Linked nodes pull together,
// all nodes push each other apart, a gentle pull keeps everything near the
// middle. It runs all the time the Graph screen is open: fast while settling
// or while a node is dragged, then slower with a gentle drift so the graph
// keeps moving a little. Positions go back to the window every frame.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import { LINK_DISTANCE, type PhysicsIn, type PhysicsOut } from "./physics";

interface Node extends SimulationNodeDatum {
  r: number;
  /** Drift: each node wanders on its own slow circle. */
  phase: number;
  speed: number;
}

/** Below this the graph counts as settled (positions are saved; frames slow down). */
const SETTLED = 0.03;
/** How far nodes wander while drifting (in graph units per round). */
const DRIFT = 0.025;

let sim: Simulation<Node, undefined> | null = null;
let nodes: Node[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let paused = false;
let dragging = -1;
let round = 0;
let settledSent = false;
let drift = true;

/** Wander force: a small push that slowly turns, different for each node. */
function wander() {
  for (const n of nodes) {
    const a = n.phase + round * n.speed;
    n.vx! += Math.cos(a) * DRIFT;
    n.vy! += Math.sin(a * 1.3) * DRIFT;
  }
}

function start(msg: Extract<PhysicsIn, { type: "start" }>) {
  sim?.stop();
  const count = msg.positions.length / 2;
  nodes = Array.from({ length: count }, (_, i) => ({
    x: msg.positions[i * 2],
    y: msg.positions[i * 2 + 1],
    r: msg.radius[i],
    phase: Math.random() * Math.PI * 2,
    speed: 0.01 + Math.random() * 0.02,
  }));
  const links = [];
  for (let e = 0; e < msg.edges.length; e += 2) links.push({ source: msg.edges[e], target: msg.edges[e + 1] });
  const big = count > 2000;
  sim = forceSimulation<Node>(nodes)
    .stop()
    .alpha(msg.alpha)
    .alphaDecay(big ? 0.03 : 0.0228)
    .velocityDecay(0.4)
    .force("link", forceLink(links).distance(LINK_DISTANCE))
    .force("charge", forceManyBody<Node>().strength(-45).theta(big ? 1.1 : 0.9).distanceMax(500))
    .force("x", forceX<Node>(0).strength(0.07))
    .force("y", forceY<Node>(0).strength(0.07))
    .force("collide", forceCollide<Node>((n) => n.r + 2).iterations(1));
  drift = msg.drift;
  settledSent = false;
  round = 0;
  schedule(0);
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(step, ms);
}

function step() {
  if (!sim || paused) return;
  const t0 = performance.now();
  // Settling (or dragging): full speed. Settled: the forces keep a little life, plus the drift.
  const active = sim.alpha() > SETTLED || dragging >= 0;
  if (!active) sim.alphaTarget(drift ? 0.004 : 0);
  if (drift) wander();
  sim.tick();
  round++;
  const positions = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    positions[i * 2] = nodes[i].x!;
    positions[i * 2 + 1] = nodes[i].y!;
  }
  const settled = !active && !settledSent;
  if (settled) settledSent = true;
  const out: PhysicsOut = { positions, settled };
  postMessage(out, { transfer: [positions.buffer] });
  const spent = performance.now() - t0;
  // About 60 frames a second while things move, 30 (20 for big graphs) while drifting.
  const frame = active ? 16 : nodes.length > 2000 ? 50 : 33;
  if (active || drift) schedule(Math.max(0, frame - spent));
}

onmessage = (e: MessageEvent<PhysicsIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case "start":
      return start(msg);
    case "drag": {
      const n = nodes[msg.index];
      if (!n || !sim) return;
      if (dragging !== msg.index) {
        dragging = msg.index;
        sim.alphaTarget(0.3);
        settledSent = false;
        schedule(0);
      }
      n.fx = msg.x;
      n.fy = msg.y;
      return;
    }
    case "release": {
      const n = nodes[msg.index];
      if (n) n.fx = n.fy = null;
      dragging = -1;
      sim?.alphaTarget(0);
      return;
    }
    case "reheat":
      if (!sim) return;
      sim.alpha(Math.max(sim.alpha(), msg.alpha));
      settledSent = false;
      return schedule(0);
    case "pause":
      paused = msg.paused;
      if (!paused) schedule(0);
      return;
    case "stop":
      sim?.stop();
      sim = null;
      clearTimeout(timer);
  }
};
