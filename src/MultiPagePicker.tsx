// Picking several existing pages at once (Add several… in Page link and
// Linked from fields): a search box and a list with tick boxes. Enter in the
// search box ticks the best match and clears the search, so names can be
// typed one after another.
import { useMemo, useState, type ReactNode } from "react";
import type { PageInfo } from "./api";
import { displayGroup } from "./tree";
import { useWiki } from "./wiki";

/** Rows shown at most; typing narrows the list. */
const LIMIT = 300;

export function MultiPagePicker({
  title,
  confirmLabel,
  note,
  unavailable,
  onPick,
  close,
}: {
  title: string;
  /** The confirm button's text, given how many pages are ticked. */
  confirmLabel: (n: number) => string;
  note?: ReactNode;
  /** Why a page can't be picked (shown, greyed out), or null. */
  unavailable?: (page: PageInfo) => string | null;
  onPick: (pages: PageInfo[]) => void;
  close: () => void;
}) {
  const wiki = useWiki();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PageInfo[]>([]);
  const shown = useMemo(() => {
    const seen = new Set<string>();
    const out: PageInfo[] = [];
    for (const e of query.trim() ? wiki.names.search(query, LIMIT * 2) : wiki.names.entries) {
      if (seen.has(e.page.id)) continue;
      seen.add(e.page.id);
      out.push(e.page);
      if (out.length > LIMIT) break;
    }
    return out;
  }, [query, wiki.names]);
  const isPicked = (p: PageInfo) => picked.some((x) => x.id === p.id);
  const toggle = (p: PageInfo) => setPicked(isPicked(p) ? picked.filter((x) => x.id !== p.id) : [...picked, p]);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide multi-picker" role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>{title}</h2>
        {note && <p className="dialog-note">{note}</p>}
        <input
          className="multi-picker-search"
          autoFocus
          value={query}
          placeholder="Find pages… (Enter ticks the first match)"
          aria-label="Find pages"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const first = shown.find((p) => !unavailable?.(p) && !isPicked(p));
            if (first && query.trim()) {
              toggle(first);
              setQuery("");
            }
          }}
        />
        {picked.length > 0 && (
          <div className="chips multi-picker-picked" aria-label="Ticked pages">
            {picked.map((p) => (
              <span key={p.id} className="alias-chip">
                {p.title}
                <button type="button" aria-label={`Untick ${p.title}`} title="Untick" onClick={() => toggle(p)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <ul className="multi-picker-list" aria-label="Pages">
          {shown.slice(0, LIMIT).map((p) => {
            const why = unavailable?.(p) ?? null;
            return (
              <li key={p.id}>
                <label className={`check ${why ? "disabled" : ""}`}>
                  <input type="checkbox" disabled={!!why} checked={isPicked(p)} onChange={() => toggle(p)} />
                  <span className="multi-picker-title">{p.title}</span>
                  {p.group && <span className="muted small">{displayGroup(p.group)}</span>}
                  {why && <span className="muted small">· {why}</span>}
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className="muted small">No page matches.</li>}
          {shown.length > LIMIT && <li className="muted small">More pages: type to narrow the list.</li>}
        </ul>
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!picked.length}
            onClick={() => {
              onPick(picked);
              close();
            }}
          >
            {confirmLabel(picked.length)}
          </button>
        </div>
      </div>
    </div>
  );
}
