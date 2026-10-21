// The Graph screen (M11): every page of the project and the links between
// them, Obsidian-style and always gently moving (controller.ts). Zoom with
// the wheel or trackpad, drag the background to pan, drag a node and its
// neighbours follow; resting on a node highlights it and its neighbours and
// shows the hover card; a click opens the page. The search box highlights
// matching titles and aliases and moves to the first; the side panel has
// the filters, extra nodes and colour rules. Where the nodes sit is
// remembered per project on this computer; Re-arrange lays it out anew.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ProjectSettings } from "../api";
import { IS_MAC } from "../QuickOpen";
import { matchesAll, parseQuery } from "../search";
import { useWiki } from "../wiki";
import type { SavedLayout, ViewState } from "./controller";
import { GraphPanel } from "./GraphPanel";
import { buildModel, pageKey, type GraphColorRule } from "./model";
import { useGraphPrefs } from "./prefs";
import { useGraphData } from "./store";
import { useGraphCanvas } from "./useGraphCanvas";

export const GRAPH_KEYS = IS_MAC ? "⌘⌥G" : "Ctrl+Alt+G";

/** Cmd+Alt+G (Ctrl+Alt+G on Windows). Alt changes the letter on the Mac, so the key's place is checked. */
export function isGraphKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyG";
}

// Kept while the app runs, per project: where the view was and what was
// searched (Back returns there), and the positions last saved (read from disk once).
const views = new Map<string, ViewState>();
const queries = new Map<string, string>();
const layouts = new Map<string, SavedLayout | null>();
const SAVE_DELAY_MS = 800;
/** Colour rules are saved this long after the last change (the colour picker changes continuously). */
const RULES_DELAY_MS = 400;
/** Wait this long after typing before moving to the first match. */
const SEARCH_DELAY_MS = 250;

/** The project's remembered layout (from memory, else from the cache folder). */
async function loadLayout(project: string): Promise<SavedLayout | null> {
  if (layouts.has(project)) return layouts.get(project) ?? null;
  const saved = await api.graphLayout(project).catch(() => null);
  layouts.set(project, saved);
  return saved;
}

export function GraphView({
  revealAll,
  focusPage,
  onOpenPage,
  changeSettings,
}: {
  revealAll: boolean;
  /** Open centred on this page ("Open in Graph" from the local graph). */
  focusPage: { id: string; key: number } | null;
  onOpenPage: (id: string) => void;
  changeSettings: (next: ProjectSettings) => void;
}) {
  const wiki = useWiki();
  const project = wiki.project;
  const box = useRef<HTMLDivElement>(null);
  const data = useGraphData(project);
  const [prefs, setPrefs] = useGraphPrefs(project);
  const filters = prefs.filters;

  // Positions are saved a moment after the graph comes to rest (and when the screen closes).
  const saving = useRef<{ timer?: ReturnType<typeof setTimeout>; pending: SavedLayout | null }>({ pending: null });
  const flushLayout = () => {
    clearTimeout(saving.current.timer);
    if (saving.current.pending) void api.saveGraphLayout(project, saving.current.pending).catch(() => {});
    saving.current.pending = null;
  };
  const ctrl = useGraphCanvas(box, {
    onOpenPage,
    card: "corner",
    testName: "__graph",
    spoilers: revealAll,
    onSave: (layout) => {
      layouts.set(project, layout);
      saving.current.pending = layout;
      clearTimeout(saving.current.timer);
      saving.current.timer = setTimeout(flushLayout, SAVE_DELAY_MS);
    },
    onClose: (c) => {
      // (Only a graph that was shown: React mounts screens twice while developing.)
      if (c.graph.order) views.set(project, c.getView());
      flushLayout();
    },
  });

  // Colour rules: shown at once, saved to project.json a moment later.
  const savedRules = wiki.settings.graphColors;
  const [rules, setRulesState] = useState<GraphColorRule[]>(savedRules ?? []);
  const rulesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRules = useRef<GraphColorRule[] | null>(null);
  const latest = useRef({ settings: wiki.settings, changeSettings });
  latest.current = { settings: wiki.settings, changeSettings };
  const saveRules = () => {
    clearTimeout(rulesTimer.current);
    rulesTimer.current = undefined;
    const next = pendingRules.current;
    pendingRules.current = null;
    if (next) latest.current.changeSettings({ ...latest.current.settings, graphColors: next });
  };
  useEffect(() => {
    // Changed elsewhere (the other computer): show those, unless a change of ours is waiting.
    if (rulesTimer.current === undefined) setRulesState(savedRules ?? []);
  }, [savedRules]);
  function setRules(next: GraphColorRule[]) {
    setRulesState(next);
    pendingRules.current = next;
    clearTimeout(rulesTimer.current);
    rulesTimer.current = setTimeout(saveRules, RULES_DELAY_MS);
  }
  // Leaving the screen saves a change still waiting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => saveRules(), []);

  const categories = wiki.categories.list;
  const model = useMemo(() => (data ? buildModel(data, { categories, rules }, filters) : null), [data, categories, rules, filters]);

  // Show the model (positions for new nodes from the remembered layout).
  const first = useRef(true);
  useEffect(() => {
    if (!model) return;
    let live = true;
    void loadLayout(project).then((saved) => {
      const c = ctrl.current;
      if (!live || !c) return;
      c.setModel(model, saved);
      if (!first.current) return;
      first.current = false;
      const view = views.get(project);
      if (focusPage) {
        c.fitView();
        c.setMarked(new Set([pageKey(focusPage.id)]));
        c.focus(pageKey(focusPage.id));
      } else if (view) c.setView(view);
      else c.fitView();
    });
    return () => {
      live = false;
    };
    // focusPage is only read on the first showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, project, ctrl]);

  useEffect(() => ctrl.current?.setArrows(filters.arrows), [filters.arrows, ctrl]);

  // Search: matching titles and aliases (and extra nodes' names) light up.
  const [query, setQuery] = useState(() => queries.get(project) ?? "");
  const matches = useMemo(() => {
    const terms = parseQuery(query);
    if (!terms.length || !model || !data) return [];
    const aliases = new Map(data.pages.map((p) => [pageKey(p.id), p.aliases ?? []]));
    return model.nodes
      .filter((n) => [n.label, ...(aliases.get(n.key) ?? [])].some((name) => matchesAll(name, terms)))
      .map((n) => n.key);
  }, [query, model, data]);
  useEffect(() => {
    queries.set(project, query);
    if (focusPage && first.current) return;
    ctrl.current?.setMarked(new Set(matches));
  }, [matches, project, query, ctrl, focusPage]);
  // Move to the first match once typing pauses.
  const firstMatch = matches[0];
  useEffect(() => {
    if (!firstMatch) return;
    const t = setTimeout(() => ctrl.current?.focus(firstMatch), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [firstMatch, ctrl]);

  const pages = model?.nodes.filter((n) => n.kind === "page").length ?? 0;
  const lines = model?.edges.filter((e) => e.kind === "link").length ?? 0;
  const filtered = !!(filters.group || filters.category || filters.template || filters.hideOrphans);

  return (
    <div className="page graph-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Graph</h1>
        </div>
        <div className="graph-search">
          <input
            type="search"
            value={query}
            placeholder="Find in graph…"
            aria-label="Search the graph"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) ctrl.current?.focus(matches[0]);
              if (e.key === "Escape") setQuery("");
            }}
          />
          {query.trim() && <span className="muted small graph-matches">{matches.length === 1 ? "1 match" : `${matches.length} matches`}</span>}
        </div>
        <div className="spacer" />
        {model && (
          <span className="muted small graph-count">
            {pages === 1 ? "1 page" : `${pages.toLocaleString("en")} pages`} · {lines === 1 ? "1 link" : `${lines.toLocaleString("en")} links`}
            {filtered && " (filtered)"}
          </span>
        )}
        <button
          title="Lay out every node anew"
          disabled={!model?.nodes.length}
          onClick={() => ctrl.current?.rearrange()}
        >
          Re-arrange
        </button>
        <button
          className={prefs.panelOpen ? "active" : ""}
          aria-pressed={prefs.panelOpen}
          title="Filters, extra nodes and colours"
          onClick={() => setPrefs({ panelOpen: !prefs.panelOpen })}
        >
          Filters & colours
        </button>
      </header>
      <div className="graph-body">
        <div className="graph-canvas" ref={box} aria-label="Graph of pages and links" />
        {prefs.panelOpen && (
          <GraphPanel filters={filters} setFilters={(change) => setPrefs({ filters: { ...filters, ...change } })} rules={rules} setRules={setRules} />
        )}
        {model && !model.nodes.length && <p className="empty center graph-empty">{data?.pages.length ? "No page matches the filters." : "No pages yet."}</p>}
      </div>
    </div>
  );
}
