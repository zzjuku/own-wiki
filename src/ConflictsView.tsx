// The Conflicts screen (M10): files Drive kept twice because both computers
// changed them before syncing (see src-tauri/src/conflicts.rs). Each pair is
// shown side by side with the differences marked; the user keeps one (the
// other goes to the Trash) or, for pages and categories, both (the copy gets
// a new title).
import { useEffect, useState } from "react";
import { api, errorText, type Conflict, type ConflictSide } from "./api";
import { Differences } from "./Differences";
import { useReportError } from "./notify";
import { useWiki } from "./wiki";

const KIND_TEXT: Record<Conflict["kind"], string> = {
  page: "Page",
  category: "Category",
  project: "Project settings and templates",
  theme: "Theme",
};

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Pair({ c, onResolved }: { c: Conflict; onResolved: (c: Conflict) => void }) {
  const wiki = useWiki();
  const report = useReportError();
  const [sides, setSides] = useState<[ConflictSide, ConflictSide] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([api.conflictSide(c.kind, c.original), api.conflictSide(c.kind, c.copy)]).then(
      (s) => live && setSides(s),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [c]);

  async function keep(which: "original" | "copy" | "both") {
    setBusy(true);
    try {
      await api.resolveConflict(wiki.project, c, which);
      onResolved(c);
    } catch (e) {
      report(e);
      setBusy(false);
    }
  }

  const file = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const both = c.kind === "page" || c.kind === "category";
  return (
    <section className="conflict" aria-label={`${KIND_TEXT[c.kind]} ${c.title}`}>
      <header className="conflict-head">
        <h2>
          <span className="muted">{KIND_TEXT[c.kind]}:</span> {c.title}
        </h2>
        <div className="spacer" />
        <button disabled={busy} onClick={() => void keep("original")}>
          Keep the original
        </button>
        <button disabled={busy} onClick={() => void keep("copy")}>
          Keep the copy
        </button>
        {both && (
          <button disabled={busy} title="The copy stays as a page of its own, with “(copy)” after its title" onClick={() => void keep("both")}>
            Keep both
          </button>
        )}
      </header>
      {error && <p className="dialog-error">{error}</p>}
      {sides && (
        <Differences
          left={{ label: `Original: ${file(c.original)}`, note: `changed ${when(sides[0].modified)}`, text: sides[0].text, infobox: sides[0].infobox }}
          right={{ label: `Copy: ${file(c.copy)}`, note: `changed ${when(sides[1].modified)}`, text: sides[1].text, infobox: sides[1].infobox }}
          boxes={c.kind === "page"}
        />
      )}
    </section>
  );
}

/** `onResolved`: what the resolved pair replaced must be read again. */
export function ConflictsView({ onResolved }: { onResolved: (c: Conflict) => void }) {
  const wiki = useWiki();
  const [list, setList] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api.conflicts(wiki.project).then(
      (l) => live && setList(l),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [wiki.project, wiki.names, version]);

  return (
    <div className="page conflicts-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Conflicts</h1>
        </div>
        <div className="spacer" />
        {list && <span className="muted small">{list.length === 1 ? "1 conflict" : `${list.length} conflicts`}</span>}
      </header>
      <div className="conflicts-body">
        <p className="hint">
          These files were changed on both computers before Google Drive could sync them. Either Drive kept both versions, or one
          computer's edit was overwritten by the other's and the app brought it back as a copy (“from …” in its name). Until you
          choose, the copy stays out of the sidebar, links and search. The version you don't keep goes to the Trash.
        </p>
        {error && <p className="dialog-error">{error}</p>}
        {list && list.length === 0 && <p className="empty small">No conflicts. Everything is in one version.</p>}
        {list?.map((c) => (
          <Pair
            key={`${c.original}\n${c.copy}`}
            c={c}
            onResolved={(resolved) => {
              setVersion((v) => v + 1);
              onResolved(resolved);
            }}
          />
        ))}
      </div>
    </div>
  );
}
