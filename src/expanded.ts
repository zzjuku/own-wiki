// Which groups are open in the sidebar, remembered per project on this
// computer only (browser local storage, not synced).
import { useCallback, useState } from "react";

const expandedKey = (project: string) => `ownwiki.expanded.${project}`;

function loadExpanded(project: string): Set<string> {
  try {
    const raw = localStorage.getItem(expandedKey(project));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(project: string, ids: Set<string>) {
  try {
    localStorage.setItem(expandedKey(project), JSON.stringify([...ids]));
  } catch {
    // Not being able to remember open groups is harmless.
  }
}

export function useExpanded(project: string) {
  const [expanded, setState] = useState(() => loadExpanded(project));
  const setExpanded = useCallback(
    (update: (prev: Set<string>) => Set<string>) =>
      setState((prev) => {
        const next = update(prev);
        saveExpanded(project, next);
        return next;
      }),
    [project],
  );
  /** Opens or closes one group. */
  const toggle = useCallback(
    (group: string, open: boolean) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(group);
        else next.delete(group);
        return next;
      }),
    [setExpanded],
  );
  return { expanded, setExpanded, toggle };
}
