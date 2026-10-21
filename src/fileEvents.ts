// Changes to the open project's files from outside the app (M10): the Rust
// file watcher (src-tauri/src/watcher.rs) sends them as "files-changed".
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { FilesChanged } from "./api";

export const FILES_CHANGED = "files-changed";

/** Calls `handler` for every change the watcher reports (for `project` only, if given). */
export function useFilesChanged(project: string | null, handler: (c: FilesChanged) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void listen<FilesChanged>(FILES_CHANGED, (e) => {
      if (!project || e.payload.project === project) ref.current(e.payload);
    }).then((un) => (live ? (stop = un) : un()));
    return () => {
      live = false;
      stop?.();
    };
  }, [project]);
}
