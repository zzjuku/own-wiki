// Layout choices remembered on this computer only (browser local storage,
// never synced): the sidebar hidden or shown, and the page width set by
// dragging the page's edge (wins over the theme's page width, in every project).
import { useCallback, useState } from "react";

const SIDEBAR_KEY = "ownwiki.sidebarHidden";
const WIDTH_KEY = "ownwiki.pageWidth";

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

/** Narrowest and widest page the edge can be dragged to (pixels). */
export const PAGE_WIDTH_MIN = 480;
export const PAGE_WIDTH_MAX = 3000;

/** The dragged page width, if any. */
export function storedPageWidth(): number | null {
  const n = Number(read(WIDTH_KEY));
  return Number.isFinite(n) && n >= PAGE_WIDTH_MIN && n <= PAGE_WIDTH_MAX ? n : null;
}

/** Shows `width` (null: the theme's again); `save` remembers it. */
export function setPageWidth(width: number | null, save = true) {
  const root = document.documentElement;
  if (width === null) root.style.removeProperty("--page-width");
  else root.style.setProperty("--page-width", `${Math.round(width)}px`);
  if (save) write(WIDTH_KEY, width === null ? null : String(Math.round(width)));
}

/** At start: the remembered width, if any. */
export function applyStoredPageWidth() {
  const w = storedPageWidth();
  if (w !== null) setPageWidth(w, false);
}
