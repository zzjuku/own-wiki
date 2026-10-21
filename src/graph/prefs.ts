// The graph's choices on this computer (browser local storage, never synced):
// filters and switches per project (the Graph screen and the local graph
// share the switches), whether the Graph screen's panel and the local graph
// beside pages are open, and the local graph's depth.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_FILTERS, type GraphFilters } from "./model";

export interface GraphPrefs {
  filters: GraphFilters;
  /** The Graph screen's filter and colour panel is open. */
  panelOpen: boolean;
}

export interface LocalPrefs {
  /** The local graph is shown beside pages. */
  open: boolean;
  /** How many links away from the page it reaches (1–3). */
  depth: number;
}

const DEFAULT_PREFS: GraphPrefs = { filters: DEFAULT_FILTERS, panelOpen: false };
const DEFAULT_LOCAL: LocalPrefs = { open: false, depth: 1 };
const LOCAL_KEY = "ownwiki.localGraph";
const prefsKey = (project: string) => `ownwiki.graph.${project}`;

const cache = new Map<string, unknown>();
const listeners = new Set<() => void>();

function load<T extends object>(key: string, fallback: T): T {
  if (!cache.has(key)) {
    let value = fallback;
    try {
      const raw = localStorage.getItem(key);
      if (raw) value = { ...fallback, ...JSON.parse(raw) };
    } catch {
      // Unreadable: the defaults.
    }
    cache.set(key, value);
  }
  return cache.get(key) as T;
}

function store<T>(key: string, value: T) {
  cache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembering it is harmless.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function usePref<T extends object>(key: string, fallback: T): [T, (change: Partial<T>) => void] {
  const value = useSyncExternalStore(subscribe, () => load(key, fallback));
  const set = useCallback((change: Partial<T>) => store(key, { ...load(key, fallback), ...change }), [key, fallback]);
  return [value, set];
}

export function useGraphPrefs(project: string): [GraphPrefs, (change: Partial<GraphPrefs>) => void] {
  const [prefs, set] = usePref(prefsKey(project), DEFAULT_PREFS);
  // Filters saved by an older version may lack newer keys.
  const full = useMemo(() => ({ ...prefs, filters: { ...DEFAULT_FILTERS, ...prefs.filters } }), [prefs]);
  return [full, set];
}

export function useLocalPrefs(): [LocalPrefs, (change: Partial<LocalPrefs>) => void] {
  return usePref(LOCAL_KEY, DEFAULT_LOCAL);
}
