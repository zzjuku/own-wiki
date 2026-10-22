// Data the backend works out from the link index (the graph, family trees),
// shared by every view showing it and read again shortly after anything may
// have changed pages (a save, rename, move, delete, live reload, project
// settings). Rust only sends the data again when its fingerprint changed, so
// a save that changed nothing costs almost nothing.
import { useEffect, useState } from "react";
import { indexEvents } from "./api";

/** Wait this long after a change before reading (several saves in a row become one read). */
const CHANGE_DELAY_MS = 250;

type Reader<T> = (project: string, known: string | null) => Promise<{ hash: string; data?: T }>;

/** A hook giving the open project's data (null until first read), kept up to date. */
export function makeIndexStore<T>(fetch: Reader<T>): (project: string) => T | null {
  interface Entry {
    hash: string | null;
    data: T | null;
    reading: Promise<void> | null;
    again: boolean;
  }
  let project: string | null = null;
  let entry: Entry = { hash: null, data: null, reading: null, again: false };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function read(p: string): Promise<void> {
    if (entry.reading) {
      entry.again = true;
      return entry.reading;
    }
    const mine = entry;
    mine.reading = fetch(p, mine.hash).then(
      (r) => {
        mine.reading = null;
        if (project !== p || entry !== mine) return;
        if (r.data) {
          mine.hash = r.hash;
          mine.data = r.data;
          listeners.forEach((l) => l());
        }
        if (mine.again) {
          mine.again = false;
          void read(p);
        }
      },
      () => {
        mine.reading = null;
      },
    );
    return mine.reading;
  }

  indexEvents.addEventListener("changed", () => {
    if (!project || !listeners.size) return;
    const p = project;
    clearTimeout(timer);
    timer = setTimeout(() => void read(p), CHANGE_DELAY_MS);
  });

  return function useIndexData(p: string): T | null {
    if (project !== p) {
      project = p;
      entry = { hash: null, data: null, reading: null, again: false };
    }
    const [data, setData] = useState(entry.data);
    useEffect(() => {
      const update = () => setData(entry.data);
      listeners.add(update);
      // Missed changes while nobody listened: check (cheap when nothing changed).
      void read(p);
      update();
      return () => void listeners.delete(update);
    }, [p]);
    return project === p ? data : null;
  };
}
