// Talks to the layout worker (layout.worker.ts).

export interface LayoutRequest {
  /** Number of this run (updates of older runs are dropped). */
  run: number;
  /** x, y of every node. */
  positions: Float32Array;
  /** 1 = the node stays where it is. */
  fixed: Uint8Array;
  /** Pairs of node numbers. */
  edges: Uint32Array;
  /** At most this many rounds; at least `minIterations` before it may stop on its own. */
  iterations: number;
  minIterations: number;
}

export interface LayoutUpdate {
  run: number;
  positions: Float32Array;
  done: boolean;
}

export class Layout {
  private worker: Worker | null = null;
  private run = 0;
  running = false;

  constructor(private onUpdate: (positions: Float32Array, done: boolean) => void) {}

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<LayoutUpdate>) => {
        if (e.data.run !== this.run) return;
        if (e.data.done) this.running = false;
        this.onUpdate(e.data.positions, e.data.done);
      };
    }
    return this.worker;
  }

  start(positions: Float32Array, fixed: Uint8Array, edges: Uint32Array, iterations: number, minIterations = 40) {
    this.run++;
    this.running = true;
    const request: LayoutRequest = { run: this.run, positions, fixed, edges, iterations, minIterations };
    this.ensure().postMessage({ type: "start", request }, [positions.buffer, fixed.buffer, edges.buffer]);
  }

  /** A node was dragged while the layout runs. */
  move(index: number, x: number, y: number, fixed: boolean) {
    if (this.running) this.worker?.postMessage({ type: "move", index, x, y, fixed });
  }

  stop() {
    this.run++;
    this.running = false;
    this.worker?.postMessage({ type: "stop" });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.running = false;
  }
}
