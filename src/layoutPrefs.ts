// Layout choices remembered on this computer only (browser local storage,
// never synced): the sidebar hidden or shown, and where the page's right edge
// was dragged to (wins over the theme's page width, in every project).
import { useCallback, useState, useSyncExternalStore } from "react";

const SIDEBAR_KEY = "ownwiki.sidebarHidden";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembering it is harmless.
  }
}

/** Is the sidebar hidden? */
export function useSidebarHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => read(SIDEBAR_KEY) === "1");
  const set = useCallback((v: boolean) => {
    setHidden(v);
    write(SIDEBAR_KEY, v ? "1" : null);
  }, []);
  return [hidden, set];
}

/** Narrowest page the edge can be dragged to (pixels). */
export const PAGE_WIDTH_MIN = 480;

// The dragged page edge, as its distance from the window's left edge: the
// infobox (at the page's right) then stays in place when the sidebar is
// hidden or shown; the text and Contents take the room that comes or goes.
const RIGHT_KEY = "ownwiki.pageRight";
let pageRight: number | null = (() => {
  const n = Number(read(RIGHT_KEY));
  return read(RIGHT_KEY) !== null && Number.isFinite(n) && n > 0 ? n : null;
})();
const listeners = new Set<() => void>();
// The earlier setting (a fixed width) isn't used any more.
write("ownwiki.pageWidth", null);

/** Moves the page's right edge to `x` (null: the theme's page width again); `save` remembers it. */
export function setPageRight(x: number | null, save = true) {
  pageRight = x === null ? null : Math.round(x);
  listeners.forEach((l) => l());
  if (save) write(RIGHT_KEY, pageRight === null ? null : String(pageRight));
}

/** Where the page's right edge was dragged to (null: not dragged). */
export function usePageRight(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => pageRight,
  );
}
