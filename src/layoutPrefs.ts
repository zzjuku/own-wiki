// Layout choices: the sidebar hidden or shown (this computer only, browser
// local storage), and where the page's right edge was dragged to (wins over
// the theme's page width, in every project; synced in the library).
import { useCallback, useState, useSyncExternalStore } from "react";
import { api } from "./api";

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

// The dragged page edge, as a share of the window's width (0–1), the same
// on every computer: it's kept in the library (`_themes/settings.json`,
// synced), so the infobox sits at the same spot on the Mac and on Windows.
// Measured from the window's left edge, the infobox stays put when the
// sidebar is hidden or shown; the text and Contents take the room.
let pageEdge: number | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
// Earlier, the edge was kept per computer in pixels (and before that, a fixed width).
const OLD_RIGHT_KEY = "ownwiki.pageRight";
write("ownwiki.pageWidth", null);

/** Reads the edge from the library (after it opens, or changed on the other computer). */
export async function loadPageEdge() {
  try {
    let edge = await api.getPageEdge();
    const old = Number(read(OLD_RIGHT_KEY));
    if (edge === null && read(OLD_RIGHT_KEY) !== null && old > 0 && window.innerWidth > 0) {
      // This computer's own dragged edge becomes the shared one.
      edge = Math.min(1, old / window.innerWidth);
      await api.setPageEdge(edge);
    }
    write(OLD_RIGHT_KEY, null);
    pageEdge = edge;
    notify();
  } catch {
    // Without a library the theme's width applies.
  }
}

/** Moves the page's right edge to `x` pixels from the window's left (null: the
 * theme's page width again); `save` keeps it in the library. */
export function setPageRight(x: number | null, save = true) {
  pageEdge = x === null || !window.innerWidth ? null : Math.min(1, x / window.innerWidth);
  notify();
  if (save) void api.setPageEdge(pageEdge).catch(() => {});
}

/** Where the page's right edge was dragged to, as a share of the window width (null: not dragged). */
export function usePageEdge(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => pageEdge,
  );
}
