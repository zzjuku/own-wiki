// Talks to the physics worker (physics.worker.ts).

/** How long a line between two linked nodes likes to be (graph units). */
export const LINK_DISTANCE = 40;

export type PhysicsIn =
  | {
      type: "start";
      /** x, y of every node. */
      positions: Float32Array;
      /** Radius of every node (they don't overlap). */
      radius: Float32Array;
      /** Pairs of node numbers. */
      edges: Uint32Array;
      /** How much moving there is to do: 1 = a fresh layout, small = only settle a little. */
      alpha: number;
      /** Keep drifting gently once settled. */
      drift: boolean;
    }
  | { type: "drag"; index: number; x: number; y: number }
  | { type: "release"; index: number }
  | { type: "reheat"; alpha: number }
  | { type: "pause"; paused: boolean }
  | { type: "stop" };

export interface PhysicsOut {
  positions: Float32Array;
  /** The graph has just come to rest (positions are worth saving). */
  settled: boolean;
}

export class Physics {
  private worker: Worker | null = null;

  constructor(private onFrame: (positions: Float32Array, settled: boolean) => void) {}

  private send(msg: PhysicsIn, transfer: Transferable[] = []) {
    if (!this.worker) {
      this.worker = new Worker(new URL("./physics.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<PhysicsOut>) => this.onFrame(e.data.positions, e.data.settled);
    }
    this.worker.postMessage(msg, transfer);
  }

  start(positions: Float32Array, radius: Float32Array, edges: Uint32Array, alpha: number, drift: boolean) {
    this.send({ type: "start", positions, radius, edges, alpha, drift }, [positions.buffer, radius.buffer, edges.buffer]);
  }

  drag(index: number, x: number, y: number) {
    this.send({ type: "drag", index, x, y });
  }

  release(index: number) {
    this.send({ type: "release", index });
  }

  reheat(alpha: number) {
    this.send({ type: "reheat", alpha });
  }

  pause(paused: boolean) {
    if (this.worker) this.send({ type: "pause", paused });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
  }
}
