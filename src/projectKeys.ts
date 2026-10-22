// A project's window-wide shortcuts: hide the sidebar (⌘\), Search (⌘⇧F),
// Graph (⌘⌥G), Family tree (⌘⌥T), quick open (⌘O), back and forward (keys
// and the mouse's side buttons). None of them work while a dialog is open,
// except hiding the sidebar.
import { useEffect, useRef } from "react";
import { isFamilyKey } from "./family/FamilyTreeView";
import { isGraphKey } from "./graph/GraphView";
import { historyKey } from "./history";
import { IS_MAC, isQuickOpenKey } from "./QuickOpen";
import { isSearchKey } from "./SearchView";

export interface ProjectKeys {
  toggleSidebar: () => void;
  search: () => void;
  graph: () => void;
  family: () => void;
  quickOpen: () => void;
  go: (step: -1 | 1) => void;
}

export function useProjectKeys(handlers: ProjectKeys) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const dialogOpen = () => !!document.querySelector(".backdrop");
    const key = (e: KeyboardEvent) => {
      const h = latest.current;
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        return h.toggleSidebar();
      }
      const screen = isSearchKey(e) ? h.search : isGraphKey(e) ? h.graph : isFamilyKey(e) ? h.family : null;
      if (screen) {
        if (dialogOpen()) return;
        e.preventDefault();
        return screen();
      }
      if (isQuickOpenKey(e)) {
        e.preventDefault();
        return h.quickOpen();
      }
      const step = historyKey(e);
      if (!step || dialogOpen()) return;
      e.preventDefault();
      h.go(step as -1 | 1);
    };
    const mouse = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) latest.current.go(e.button === 3 ? -1 : 1);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mouseup", mouse);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mouseup", mouse);
    };
  }, []);
}
