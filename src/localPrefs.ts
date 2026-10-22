// Choices remembered on this computer (browser local storage, never synced),
// as hooks that update every view using them.
import { useCallback, useSyncExternalStore } from "react";

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

export function usePref<T extends object>(key: string, fallback: T): [T, (change: Partial<T>) => void] {
  const value = useSyncExternalStore(subscribe, () => load(key, fallback));
  const set = useCallback((change: Partial<T>) => store(key, { ...load(key, fallback), ...change }), [key, fallback]);
  return [value, set];
}

