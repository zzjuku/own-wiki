declare module "graphology-layout-forceatlas2/iterate.js" {
  /** One round of ForceAtlas2 on its node and edge matrices (changed in place). */
  export default function iterate(settings: Record<string, unknown>, nodes: Float32Array, edges: Float32Array): void;
}
