// Field notes in the Infobox tab (M13): a small "Note" button per entry and,
// when on, a one-line note with a Before / After switch under the entry.
// The note allows bold, italic, [[links]] and ||spoilers|| like text fields.
import { MiniEditor } from "./MiniEditor";
import type { NoteDraft } from "./notes";

/** The button that adds (or shows) an entry's note. */
export function NoteToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`plain note-toggle ${active ? "active" : ""}`}
      title={active ? "This entry has a note (shown smaller, before or after it)" : "Add a short note before or after this entry (smaller, on the same line)"}
      aria-label={`Note for ${label}`}
      aria-pressed={active}
      onClick={onClick}
    >
      Note
    </button>
  );
}

/** The note of one entry: Before / After, the text, remove. */
export function NoteEditor({
  pageId,
  label,
  note,
  onChange,
  autoFocus,
}: {
  pageId: string;
  label: string;
  note: NoteDraft;
  /** null: the note is removed. */
  onChange: (note: NoteDraft | null) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="note-editor">
      <button
        type="button"
        className="note-place"
        title={note.before ? "Shown before the entry. Click: after it." : "Shown after the entry. Click: before it."}
        aria-label={`${label}: note ${note.before ? "before" : "after"} the entry`}
        onClick={() => onChange({ ...note, before: note.before ? undefined : true })}
      >
        {note.before ? "◂ Before" : "After ▸"}
      </button>
      <MiniEditor
        pageId={pageId}
        label={`${label}: note`}
        placeholder="Note, e.g. (by marriage)"
        value={note.text}
        autoFocus={autoFocus}
        onChange={(text) => onChange({ ...note, text })}
      />
      <button type="button" className="plain remove" title="Remove the note" aria-label={`Remove the note of ${label}`} onClick={() => onChange(null)}>
        ×
      </button>
    </div>
  );
}
