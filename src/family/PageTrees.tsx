// Family trees in page text (M12): each `<familytree …>` line renders as an
// empty slot (markdown.ts); this draws a tree into every slot of a rendered
// page, read-only, in a box you can pan (drag) and zoom (buttons), with
// Open in Family tree. Works in embeds and the editor preview too.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useWiki, WikiContext, type Wiki } from "../wiki";
import { Family } from "./data";
import { relatedPage, useFamilyData, useTreeMetrics, withPerson } from "./FamilyTreeView";
import { layoutTree } from "./layout";
import { buildTree } from "./model";
import { TreeCanvas, type TreeHandle } from "./TreeCanvas";
import type { TreeLineCall } from "./treeLine";

const MIN_HEIGHT = 200;
const MAX_HEIGHT = 520;

/** Draws the family trees into the slots inside `ref` whenever `html` changes. */
export function usePageTrees(ref: RefObject<HTMLElement | null>, html: string, spoilers: boolean) {
  const wiki = useWiki();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const roots: Root[] = [];
    el.querySelectorAll<HTMLElement>(".familytree-slot").forEach((slot) => {
      const call: TreeLineCall = { root: slot.dataset.root ?? "", up: Number(slot.dataset.up) || 0, down: Number(slot.dataset.down) || 0 };
      const root = createRoot(slot);
      root.render(<Slot wiki={wiki} call={call} spoilers={spoilers} />);
      roots.push(root);
    });
    // (Unmounted after the current render: React doesn't like it during one.)
    return () => void setTimeout(() => roots.forEach((r) => r.unmount()));
  }, [ref, html, wiki, spoilers]);
}

function Slot({ wiki, call, spoilers }: { wiki: Wiki; call: TreeLineCall; spoilers: boolean }) {
  return (
    <WikiContext.Provider value={wiki}>
      <PageTree call={call} spoilers={spoilers} />
    </WikiContext.Provider>
  );
}

function PageTree({ call, spoilers }: { call: TreeLineCall; spoilers: boolean }) {
  const wiki = useWiki();
  const raw = useFamilyData(wiki.project);
  const target = wiki.names.resolve(call.root)?.page;
  const data = useMemo(() => (raw && target ? withPerson(raw, target.id, target.title) : null), [raw, target]);
  const fam = useMemo(() => (data ? new Family(data) : null), [data]);
  const { fonts, metrics } = useTreeMetrics(fam);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const centre = target && fam ? fam.byPage.get(target.id) : undefined;
  const layout = useMemo(() => {
    if (!fam || centre === undefined) return null;
    return layoutTree(buildTree(fam, centre, { up: call.up, down: call.down, partnersParents: false, revealAll: spoilers, revealed }), metrics);
  }, [fam, centre, call.up, call.down, spoilers, revealed, metrics]);
  const handle = useRef<TreeHandle>(null);
  useEffect(() => {
    // (A frame later: a page just switched from editing may not have its size yet.)
    if (!layout) return;
    const f = requestAnimationFrame(() => handle.current?.fit());
    return () => cancelAnimationFrame(f);
    // Fitted once; later changes keep the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!layout]);

  if (!call.root || !target)
    return (
      <div className="page-tree-missing" role="note">
        Family tree: there's no page “{call.root || "(none chosen)"}”.
      </div>
    );
  if (!layout || !fam) return <div className="page-tree page-tree-loading" />;
  const b = layout.bounds;
  const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, b.maxY - b.minY + 70)));
  return (
    <div className="page-tree" style={{ height }}>
      <div className="page-tree-bar">
        <span className="page-tree-title">Family tree of {target.title}</span>
        <span className="spacer" />
        <button className="plain" title="Zoom out" aria-label="Zoom out" onClick={() => handle.current?.zoom(1 / 1.25)}>
          −
        </button>
        <button className="plain" title="Zoom in" aria-label="Zoom in" onClick={() => handle.current?.zoom(1.25)}>
          +
        </button>
        <button className="plain" title="Show the whole tree" onClick={() => handle.current?.fit(true)}>
          Fit
        </button>
        <button className="plain" onClick={() => wiki.openFamilyTree(target.id)}>
          Open in Family tree
        </button>
      </div>
      <TreeCanvas
        handle={handle}
        layout={layout}
        fam={fam}
        project={wiki.project}
        centreKey={`n${centre}`}
        spoilers={spoilers}
        fonts={fonts}
        wheelZoom={false}
        label={`Family tree of ${target.title}`}
        onOpen={(i) => {
          const id = fam.people[i].id;
          if (id) wiki.follow({ pageId: id });
        }}
        onReveal={(keys) => setRevealed((r) => new Set([...r, ...keys]))}
        onCreate={(i) => wiki.createFromLink(fam.people[i].title, relatedPage(fam, i), { stay: true })}
      />
    </div>
  );
}
