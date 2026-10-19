// The quote box dialog: the quote (bold, italic, links, spoilers), who said
// it (a name or a page link) and where it's from. Opened by the Quote box
// button (new) or by clicking a quote box in the source editor.
import { useState } from "react";
import { MiniEditor } from "./MiniEditor";
import { IS_MAC } from "./QuickOpen";
import type { Quote } from "./quotes";

interface Props {
  pageId: string;
  initial: Quote;
  isNew: boolean;
  save: (q: Quote) => void;
  /** Deletes the quote box being edited. */
  remove?: () => void;
  close: () => void;
}

export function QuoteDialog({ pageId, initial, isNew, save, remove, close }: Props) {
  const [q, setQ] = useState(initial);
  const empty = !q.text.trim();
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="dialog quote-dialog"
        role="dialog"
        aria-label={isNew ? "New quote box" : "Edit quote box"}
        onSubmit={(e) => {
          e.preventDefault();
          if (!empty) save(q);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !(e.target as HTMLElement).closest(".cm-tooltip, .link-popup")) close();
        }}
      >
        <h2>{isNew ? "Quote box" : "Edit quote box"}</h2>
        <div className="field">
          <span>Quote</span>
          <MiniEditor multiline autoFocus pageId={pageId} label="Quote" value={q.text} onChange={(text) => setQ((x) => ({ ...x, text }))} />
        </div>
        <div className="field">
          <span>By (optional)</span>
          <MiniEditor
            pageId={pageId}
            label="By"
            placeholder={`A name, or a page link (${IS_MAC ? "⌘" : "Ctrl+"}K)`}
            value={q.by}
            onChange={(by) => setQ((x) => ({ ...x, by }))}
          />
        </div>
        <div className="field">
          <span>Source (optional)</span>
          <MiniEditor pageId={pageId} label="Source" placeholder="Where it's from" value={q.source} onChange={(source) => setQ((x) => ({ ...x, source }))} />
        </div>
        <div className="dialog-actions">
          {remove && (
            <button type="button" className="danger-text" onClick={remove}>
              Remove quote box
            </button>
          )}
          <div className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={empty}>
            {isNew ? "Insert" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
