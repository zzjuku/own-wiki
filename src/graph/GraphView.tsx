// The Graph screen (M11): every page of the project and the links between
// them, Obsidian-style. Zoom with the wheel or trackpad, drag the background
// to pan, drag a node to move it; resting on a node highlights it and its
// neighbours and shows the hover card; a click opens the page. Where the
// nodes sit is remembered per project on this computer, so the graph looks
// the same next time; Re-arrange lays it out anew. The graph moves all the
// time, Obsidian-style (controller.ts).
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { showCardFor } from "../HoverCard";
import { useReportError } from "../notify";
import { IS_MAC } from "../QuickOpen";
import { useWiki } from "../wiki";
import { useGraphColors } from "./colors";
import { GraphController, type SavedLayout, type ViewState } from "./controller";
import { buildModel, DEFAULT_FILTERS, type GraphData, type Model, type ModelNode } from "./model";

export const GRAPH_KEYS = IS_MAC ? "⌘⌥G" : "Ctrl+Alt+G";

/** Cmd+Alt+G (Ctrl+Alt+G on Windows). Alt changes the letter on the Mac, so the key's place is checked. */
export function isGraphKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyG";
}

// Kept while the app runs, per project: where the view was (Back returns
// there) and the positions last saved (read from disk only once).
const views = new Map<string, ViewState>();
const layouts = new Map<string, SavedLayout | null>();
const SAVE_DELAY_MS = 800;

/** The project's remembered layout (from memory, else from the cache folder). */
async function loadLayout(project: string): Promise<SavedLayout | null> {
  if (layouts.has(project)) return layouts.get(project) ?? null;
  const saved = await api.graphLayout(project).catch(() => null);
  layouts.set(project, saved);
  return saved;
}

/** Test hook: the controller of the graph on screen (not in the built app). */
declare global {
  interface Window {
    __graph?: GraphController;
  }
}

export function GraphView({ revealAll, dataKey, onOpenPage }: {
  revealAll: boolean;
  /** Changes when pages may have changed (the graph is read again). */
  dataKey: unknown;
  onOpenPage: (id: string) => void;
}) {
  const wiki = useWiki();
  const project = wiki.project;
  const report = useReportError();
  const colors = useGraphColors();
  const box = useRef<HTMLDivElement>(null);
  const ctrl = useRef<GraphController | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const actions = useRef({ onOpenPage, wiki });
  actions.current = { onOpenPage, wiki };

  // The controller lives as long as the screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: SavedLayout | null = null;
    const flush = () => {
      clearTimeout(saveTimer);
      if (pending) void api.saveGraphLayout(project, pending).catch(() => {});
      pending = null;
    };
    const c = new GraphController(el, colors, {
      open: (n: ModelNode) => {
        showCardFor(null);
        const { onOpenPage, wiki } = actions.current;
        if (n.kind === "page") onOpenPage(n.ref);
        else if (n.kind === "missing") wiki.createFromLink(n.ref);
        else if (n.kind === "category") wiki.openCategory(n.ref);
      },
      hover: (n, at) => {
        if (!n || !at) return showCardFor(null);
        // The card goes into the top corner away from the node, so it doesn't cover the neighbours.
        const area = el.getBoundingClientRect();
        const width = parseFloat(getComputedStyle(el).getPropertyValue("--card-width")) || 340;
        const left = at.x > area.left + area.width / 2 ? area.left + 12 : area.right - width - 12;
        const rect = new DOMRect(left, area.top + 6, 0, 0);
        if (n.kind === "page") showCardFor({ rect, pageId: n.ref });
        else if (n.kind === "missing") showCardFor({ rect, missing: n.ref });
        else if (n.kind === "category") showCardFor({ rect, category: n.ref });
      },
      save: (layout) => {
        layouts.set(project, layout);
        pending = layout;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, SAVE_DELAY_MS);
      },
    });
    ctrl.current = c;
    if (import.meta.env.MODE !== "production") window.__graph = c;
    return () => {
      // (Only a graph that was shown: React mounts screens twice while developing.)
      if (c.graph.order) views.set(project, c.getView());
      c.destroy();
      flush();
      showCardFor(null);
      ctrl.current = null;
      if (window.__graph === c) delete window.__graph;
    };
    // Colours are passed on below; the controller isn't rebuilt for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useEffect(() => ctrl.current?.setColors(colors), [colors]);
  useEffect(() => ctrl.current?.setSpoilers(revealAll), [revealAll]);

  // Read the graph (again when pages change).
  const categories = wiki.categories.list;
  const first = useRef(true);
  useEffect(() => {
    let live = true;
    Promise.all([api.graphData(project), loadLayout(project)]).then(
      ([data, saved]: [GraphData, SavedLayout | null]) => {
        const c = ctrl.current;
        if (!live || !c) return;
        const m = buildModel(data, { categories }, DEFAULT_FILTERS);
        c.setModel(m, saved);
        if (first.current) {
          first.current = false;
          const view = views.get(project);
          if (view) c.setView(view);
          else c.fitView();
        }
        setModel(m);
      },
      report,
    );
    return () => {
      live = false;
    };
  }, [project, dataKey, categories, report]);

  const pages = model?.nodes.filter((n) => n.kind === "page").length ?? 0;
  const lines = model?.edges.filter((e) => e.kind === "link").length ?? 0;

  return (
    <div className="page graph-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Graph</h1>
        </div>
        <div className="spacer" />
        {model && (
          <span className="muted small graph-count">
            {pages === 1 ? "1 page" : `${pages.toLocaleString("en")} pages`} · {lines === 1 ? "1 link" : `${lines.toLocaleString("en")} links`}
          </span>
        )}
        <button
          title="Lay out every node anew (positions you dragged are lost)"
          disabled={!model?.nodes.length}
          onClick={() => ctrl.current?.rearrange()}
        >
          Re-arrange
        </button>
      </header>
      <div className="graph-canvas" ref={box} aria-label="Graph of pages and links" />
      {model && !model.nodes.length && <p className="empty center graph-empty">No pages yet.</p>}
    </div>
  );
}
