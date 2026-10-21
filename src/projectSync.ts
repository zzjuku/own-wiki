// While a project is open (M10): watch its files for changes from outside,
// and keep this computer's "open here" marker fresh (removed on close), so
// the other computer warns before opening it too.
import { useEffect } from "react";
import { api, type FilesChanged } from "./api";
import { useFilesChanged } from "./fileEvents";

/** How often the marker is refreshed (a marker older than 6 minutes counts as stale). */
const MARK_EVERY_MS = 2 * 60 * 1000;

export function useProjectSync(project: string, onChange: (c: FilesChanged) => void) {
  useEffect(() => {
    void api.watchProject(project).catch(() => {});
    const mark = () => void api.markOpen(project).catch(() => {});
    mark();
    const timer = setInterval(mark, MARK_EVERY_MS);
    // (Quitting the app removes the marker too: src-tauri/src/lib.rs.)
    return () => {
      clearInterval(timer);
      void api.unwatchProject().catch(() => {});
      void api.markClosed(project).catch(() => {});
    };
  }, [project]);
  useFilesChanged(project, onChange);
}
