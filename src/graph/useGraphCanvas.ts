// A graph drawn into a box: the controller (controller.ts) for as long as
// the box is shown, clicks that open pages (or create missing ones, open
// categories), and hover cards placed so they don't cover the neighbours.
// Used by the Graph screen and the local graph beside pages.
import { useEffect, useRef } from "react";
import { showCardFor } from "../HoverCard";
import { useWiki } from "../wiki";
import { useGraphColors } from "./colors";
import { GraphController, type SavedLayout } from "./controller";
import type { ModelNode } from "./model";

/** Test hook: the controllers on screen (not in the built app). */
declare global {
  interface Window {
    __graph?: GraphController;
    __localGraph?: GraphController;
  }
}

export function useGraphCanvas(
  box: React.RefObject<HTMLDivElement | null>,
  {
    onOpenPage,
    onSave,
    onClose,
    card,
    testName,
    spoilers,
  }: {
    onOpenPage: (id: string) => void;
    /** Positions worth remembering (only the Graph screen keeps them). */
    onSave?: (layout: SavedLayout) => void;
    /** The box goes away (the controller is about to be dropped). */
    onClose?: (c: GraphController) => void;
    /** Where hover cards go: the top corner away from the node, or beside the box (narrow boxes). */
    card: "corner" | "beside";
    testName: "__graph" | "__localGraph";
    spoilers: boolean;
  },
): React.RefObject<GraphController | null> {
  const wiki = useWiki();
  const colors = useGraphColors();
  const ctrl = useRef<GraphController | null>(null);
  const latest = useRef({ onOpenPage, onSave, onClose, wiki });
  latest.current = { onOpenPage, onSave, onClose, wiki };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const c = new GraphController(el, colors, {
      open: (n: ModelNode) => {
        showCardFor(null);
        const { onOpenPage, wiki } = latest.current;
        if (n.kind === "page") onOpenPage(n.ref);
        else if (n.kind === "missing") wiki.createFromLink(n.ref);
        else if (n.kind === "category") wiki.openCategory(n.ref);
      },
      hover: (n, at) => {
        if (!n || !at) return showCardFor(null);
        const area = el.getBoundingClientRect();
        const width = parseFloat(getComputedStyle(el).getPropertyValue("--card-width")) || 340;
        const left =
          card === "beside"
            ? Math.max(8, area.left - width - 10)
            : at.x > area.left + area.width / 2
              ? area.left + 12
              : area.right - width - 12;
        const rect = new DOMRect(left, area.top + 6, 0, 0);
        if (n.kind === "page") showCardFor({ rect, pageId: n.ref });
        else if (n.kind === "missing") showCardFor({ rect, missing: n.ref });
        else if (n.kind === "category") showCardFor({ rect, category: n.ref });
      },
      save: (layout) => latest.current.onSave?.(layout),
    });
    c.setSpoilers(spoilers);
    ctrl.current = c;
    // The box changes size with the window, the side panel and the sidebar.
    const resize = new ResizeObserver(() => c.resized());
    resize.observe(el);
    if (import.meta.env.MODE !== "production") window[testName] = c;
    return () => {
      resize.disconnect();
      latest.current.onClose?.(c);
      c.destroy();
      showCardFor(null);
      ctrl.current = null;
      if (window[testName] === c) delete window[testName];
    };
    // Colours and spoilers are passed on below; the controller isn't rebuilt for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiki.project, box, card, testName]);

  useEffect(() => ctrl.current?.setColors(colors), [colors]);
  useEffect(() => ctrl.current?.setSpoilers(spoilers), [spoilers]);
  return ctrl;
}
