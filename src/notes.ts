// Field notes (M13): a short text before or after one entry of an infobox
// value, on the same line and smaller ("[[House A]] (by marriage)"). Stored
// on the page's field next to its value, by the entry's place:
//   notes: [{ i: 0, text: "(by marriage)" }, { i: 2, text: "(claimed)", before: true }]
// Single values (Text, Number, Date…) have entry 0; List items, Page link
// pages, typed-in Linked from names and Date, place / Date, text entries
// count in the order stored. The values themselves keep their format.
import type { Field } from "./api";

export interface FieldNote {
  /** The entry's place in the value (0 for a single value). */
  i: number;
  /** Markdown on one line: bold, italic, [[links]], ||spoilers||. */
  text: string;
  /** Shown before the entry (else after). */
  before?: boolean;
}

/** A note while it's edited (no place yet: the rows decide it). */
export interface NoteDraft {
  text: string;
  before?: boolean;
}

/** The field's notes that can be shown. */
export function notesOf(f: Pick<Field, "notes">): FieldNote[] {
  const list = Array.isArray(f.notes) ? (f.notes as unknown[]) : [];
  return list.filter(
    (n): n is FieldNote => !!n && typeof n === "object" && Number.isInteger((n as FieldNote).i) && typeof (n as FieldNote).text === "string" && !!(n as FieldNote).text.trim(),
  );
}

/** The note of entry `i`, if any. */
export const noteAt = (f: Pick<Field, "notes">, i: number): FieldNote | undefined => notesOf(f).find((n) => n.i === i);

/** Notes for entries in order (null: no note), as stored (empty ones dropped). */
export function notesFrom(drafts: (NoteDraft | null | undefined)[]): FieldNote[] {
  return drafts.flatMap((d, i) => (d?.text.trim() ? [{ i, text: d.text.trim(), ...(d.before ? { before: true } : {}) }] : []));
}

/** `html` with its note (already HTML) before or after it. */
export function withNoteHtml(html: string, noteHtml: string, before: boolean | undefined): string {
  if (!noteHtml) return html;
  const note = `<span class="infobox-note">${noteHtml}</span>`;
  return before ? `${note} ${html}` : `${html} ${note}`;
}

/** The notes after entries were removed or reordered: `kept[n]` is the old place of the entry now at place n. */
export function remapNotes(notes: FieldNote[], kept: number[]): FieldNote[] {
  return notes.flatMap((n) => {
    const at = kept.indexOf(n.i);
    return at < 0 ? [] : [{ ...n, i: at }];
  });
}
