// The open page and its file on disk (M10). When the watcher reports the
// page changed outside the app (Drive brought the other computer's version):
// - no unsaved edits: the page reloads in place, with a short notice;
// - unsaved edits: autosave pauses and a bar asks what to keep (Show
//   differences / Use the other version / Keep mine). Nothing is lost: the
//   version not kept goes to the Trash;
// - deleted: a bar offers Keep it (saves it again) or Close.
// A save refused because the file changed (fsutil::check_version) leads to
// the same bar.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, isChanged, type Infobox, type MyVersion } from "./api";
import type { Autosaver } from "./autosave";
import { Differences } from "./Differences";
import { useReportError } from "./notify";

export interface SyncOptions {
  project: string;
  pageId: string;
  title: string;
  /** The page's version when loaded (updated by `reload` and here). */
  version: React.MutableRefObject<string | null>;
  savers: Autosaver[];
  /** The page as it is in the app right now. */
  mine: () => MyVersion;
  /** Everything needed to write the page again after it was deleted on disk. */
  restoreData: () => { title: string; aliases: string[]; categories: string[]; sort: string | null; infobox: Infobox | null; body: string };
  /** Re-reads the page from disk and shows it (the editor starts over with it). */
  reload: () => Promise<void>;
  /** The page file was written again ("Keep it"): the page list needs reloading. */
  onRestored: () => void;
  /** "Close" after the page was deleted on disk. */
  onClosed: () => void;
  /** Changes whenever the watcher saw this page's file change. */
  diskTick: number;
}

type Clash = "changed" | "deleted" | null;

const NOTICE_MS = 4000;

export function usePageSync(o: SyncOptions) {
  const report = useReportError();
  const [clash, setClash] = useState<Clash>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ theirs: { text: string; infobox: Infobox | null }; mine: MyVersion } | null>(null);
  const [busy, setBusy] = useState(false);
  const opts = useRef(o);
  opts.current = o;
  const dirty = () => opts.current.savers.some((s) => s.hasPending);
  const pause = () => opts.current.savers.forEach((s) => s.pause());
  const settle = () =>
    opts.current.savers.forEach((s) => {
      s.discard();
      s.resume();
    });

  /** Looks at the file on disk and reacts (reload, or the bar). */
  const check = useCallback(async () => {
    const { project, pageId, version } = opts.current;
    if (!version.current) return;
    let state: "same" | "changed" | "deleted";
    try {
      state = await api.pageDiskState(project, pageId, version.current);
    } catch {
      return;
    }
    if (state === "same") return;
    if (state === "deleted") {
      pause();
      setClash("deleted");
    } else if (dirty()) {
      pause();
      setClash("changed");
    } else {
      await opts.current.reload();
      setNotice("This page was changed on another computer. It shows the new version now.");
    }
  }, []);

  useEffect(() => {
    if (o.diskTick) void check();
  }, [o.diskTick, check]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // Leaving the page while the bar is up: unsaved edits go to the Trash rather than being lost.
  const clashRef = useRef<Clash>(null);
  clashRef.current = clash;
  useEffect(
    () => () => {
      const { project, pageId, title } = opts.current;
      if (clashRef.current && dirty()) void api.trashMine(project, pageId, title, opts.current.mine()).catch(() => {});
    },
    [],
  );

  /** For the savers: a save refused because the file changed shows the bar. True if handled. */
  const onSaveError = useCallback(
    (e: unknown) => {
      if (!isChanged(e)) return false;
      pause();
      void check();
      return true;
    },
    [check],
  );

  async function act(f: () => Promise<void>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      report(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const { project, pageId, title } = o;
  const keepMine = () =>
    act(async () => {
      o.version.current = await api.keepMine(project, pageId, o.mine());
      settle();
      setClash(null);
      setNotice("Your version was kept; the other one is in the Trash.");
    });
  const takeOther = () =>
    act(async () => {
      await api.trashMine(project, pageId, title, o.mine());
      settle();
      await o.reload();
      setClash(null);
      setNotice("The other version is shown now; yours is in the Trash.");
    });
  const keepIt = () =>
    act(async () => {
      o.version.current = await api.restorePage(project, pageId, o.restoreData());
      settle();
      setClash(null);
      o.onRestored();
    });
  const showDiff = () =>
    act(async () => {
      const theirs = await api.readPage(project, pageId);
      setDiff({ theirs: { text: theirs.body, infobox: theirs.infobox }, mine: o.mine() });
    });

  const bar =
    clash === "changed" ? (
      <div className="sync-bar warn" role="alert">
        <span>
          <strong>This page was changed on another computer</strong> while you edited it. Yours isn't saved yet.
        </span>
        <div className="spacer" />
        <button disabled={busy} onClick={() => void showDiff()}>
          Show differences
        </button>
        <button disabled={busy} onClick={() => void takeOther()}>
          Use the other version
        </button>
        <button className="primary" disabled={busy} onClick={() => void keepMine()}>
          Keep mine
        </button>
      </div>
    ) : clash === "deleted" ? (
      <div className="sync-bar warn" role="alert">
        <span>
          <strong>This page was deleted on another computer</strong> (or moved to the Trash).
        </span>
        <div className="spacer" />
        <button className="primary" disabled={busy} onClick={() => void keepIt()}>
          Keep it
        </button>
        <button disabled={busy} onClick={o.onClosed}>
          Close
        </button>
      </div>
    ) : notice ? (
      <div className="sync-bar info" role="status">
        <span>{notice}</span>
      </div>
    ) : null;

  const dialog = diff && (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDiff(null)}>
      <div className="dialog wide diff-dialog" role="dialog" aria-label="Differences" onKeyDown={(e) => e.key === "Escape" && setDiff(null)}>
        <h2>Differences</h2>
        <Differences
          left={{ label: "Yours (not saved)", text: diff.mine.body, infobox: diff.mine.infobox }}
          right={{ label: "The other computer's", text: diff.theirs.text, infobox: diff.theirs.infobox }}
          boxes={diff.mine.withInfobox}
        />
        <div className="dialog-actions">
          <button
            onClick={() => {
              setDiff(null);
              void takeOther();
            }}
          >
            Use the other version
          </button>
          <button
            onClick={() => {
              setDiff(null);
              void keepMine();
            }}
          >
            Keep mine
          </button>
          <button className="primary" autoFocus onClick={() => setDiff(null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return { bar, dialog, onSaveError, clash };
}
