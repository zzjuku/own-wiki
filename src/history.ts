// Back and forward in a project: the places visited since it was opened.
// A place is a page id, "category:Name", "search:query" (the Search screen), "graph:" (the Graph screen)
// or "family:<page id>" (the Family tree screen).
import { IS_MAC } from "./QuickOpen";

/** History entries for category pages ("category:Name"; page ids end in ".md"). */
export const CAT_KEY = "category:";
export const catKey = (name: string) => CAT_KEY + name;
export const keyCategory = (key: string) => (key.startsWith(CAT_KEY) ? key.slice(CAT_KEY.length) : null);
/** History entries for the Search screen ("search:query"). */
export const SEARCH_KEY = "search:";
export const keySearch = (key: string) => (key.startsWith(SEARCH_KEY) ? key.slice(SEARCH_KEY.length) : null);
/** The history entry of the Graph screen. */
export const GRAPH_KEY = "graph:";
/** History entries for the Family tree screen ("family:<page id of the person in the middle>"). */
export const FAMILY_KEY = "family:";
export const keyFamily = (key: string) => (key.startsWith(FAMILY_KEY) ? key.slice(FAMILY_KEY.length) : null);

/** Pages visited in this project since it was opened (back/forward). */
export interface History {
  back: string[];
  forward: string[];
}

export const HISTORY_LIMIT = 200;

/** Cmd+[ / Cmd+] on the Mac, Alt+Left / Alt+Right on Windows: -1 back, 1 forward, 0 neither. */
export function historyKey(e: KeyboardEvent): number {
  if (IS_MAC) {
    if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return 0;
    if (e.key === "[" || e.code === "BracketLeft") return -1;
    if (e.key === "]" || e.code === "BracketRight") return 1;
    return 0;
  }
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  return e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
}
