// The local graph (M11): a panel beside the page with the page in the middle
// and its neighbours around it, 1–3 links deep. It follows the page you're
// on, moves like the Graph screen, and shares its switches (link types,
// extra nodes, arrows) and colour rules. Open in Graph shows the full graph
// centred on this page.
import { useEffect, useMemo, useRef, useState } from "react";
import { useWiki } from "../wiki";
import { GraphSwitches } from "./GraphPanel";
import { buildModel, DEFAULT_FILTERS, localModel, pageKey } from "./model";
import { useGraphPrefs, useLocalPrefs } from "./prefs";
import { useGraphData } from "./store";
import { useGraphCanvas } from "./useGraphCanvas";

export function LocalGraph({
  pageId,
  revealAll,
  onOpenPage,
  onOpenInGraph,
}: {
  pageId: string;
  revealAll: boolean;
  onOpenPage: (id: string) => void;
  onOpenInGraph: (id: string) => void;
}) {
  const wiki = useWiki();
  const data = useGraphData(wiki.project);
  const [prefs, setPrefs] = useGraphPrefs(wiki.project);
  const [local, setLocal] = useLocalPrefs();
  const [switchesOpen, setSwitchesOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ctrl = useGraphCanvas(box, { onOpenPage, card: "beside", testName: "__localGraph", spoilers: revealAll });

  const f = prefs.filters;
  const rules = wiki.settings.graphColors;
  const categories = wiki.categories.list;
  // The whole graph with the shared switches (no page filters), then the part around the page.
  const full = useMemo(
    () =>
      data &&
      buildModel(data, { categories, rules }, {
        ...DEFAULT_FILTERS,
        textLinks: f.textLinks,
        fieldLinks: f.fieldLinks,
        redLinks: f.redLinks,
        categories: f.categories,
        groups: f.groups,
      }),
    [data, categories, rules, f.textLinks, f.fieldLinks, f.redLinks, f.categories, f.groups],
  );
  const depth = Math.min(3, Math.max(1, local.depth));
  const center = pageKey(pageId);
  const model = useMemo(() => full && localModel(full, center, depth), [full, center, depth]);

  const shown = useRef(false);
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !model) return;
    const moved = c.setModel(model, null);
    c.setCenter(center);
    if (!shown.current) {
      shown.current = true;
      c.fitView();
    }
    // Once it has settled, the view moves to show all of it.
    if (moved) c.fitSoon();
  }, [model, center, ctrl]);
  useEffect(() => ctrl.current?.setArrows(f.arrows), [f.arrows, ctrl]);

  const count = model ? model.nodes.length - 1 : 0;

  return (
    <aside className="local-graph" aria-label="Local graph">
      <div className="local-graph-head">
        <strong>Local graph</strong>
        <div className="local-depth" role="group" aria-label="Depth">
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              className={`plain ${d === depth ? "selected" : ""}`}
              aria-pressed={d === depth}
              title={d === 1 ? "Pages linked directly" : `Up to ${d} links away`}
              onClick={() => setLocal({ depth: d })}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button
          className={`plain nav ${switchesOpen ? "active" : ""}`}
          title="Lines and extra nodes (the same as on the Graph screen)"
          aria-label="Graph switches"
          aria-pressed={switchesOpen}
          onClick={() => setSwitchesOpen((o) => !o)}
        >
          ⚙
        </button>
        <button className="plain nav" title="Close the local graph" aria-label="Close the local graph" onClick={() => setLocal({ open: false })}>
          ×
        </button>
      </div>
      {switchesOpen && (
        <div className="local-switches">
          <GraphSwitches filters={f} set={(change) => setPrefs({ filters: { ...f, ...change } })} />
        </div>
      )}
      <div className="graph-canvas local-canvas" ref={box} />
      <div className="local-graph-foot">
        <span className="muted small">{count === 1 ? "1 page nearby" : `${count} pages nearby`}</span>
        <div className="spacer" />
        <button title="The full graph, centred on this page" onClick={() => onOpenInGraph(pageId)}>
          Open in Graph
        </button>
      </div>
    </aside>
  );
}
