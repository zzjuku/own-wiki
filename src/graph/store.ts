// The open project's graph data, shared by the Graph screen and the local
// graph beside pages (see indexStore.ts).
import { api } from "../api";
import { makeIndexStore } from "../indexStore";
import type { GraphData } from "./model";

export const useGraphData = makeIndexStore<GraphData>((p, known) => api.graphData(p, known));
