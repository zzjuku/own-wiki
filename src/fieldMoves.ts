// Moving rows of a list (dragOrder, inOrder), and infobox fields in the
// Infobox tab and the template editor (M10):
// a section heading moves together with its fields (up to the next heading),
// a field moves on its own, and "Move to section…" puts a field at the end of
// a section (or a whole section after another one) in one step. Moves return
// the new order as old indexes, so callers can reorder fields and the rows'
// ids alike.
import type { Field } from "./api";

const isHeading = (f: Field) => f.type === "heading";

/** How many rows move when row `i` is dragged: a heading takes its fields along. */
export function blockSize(fields: Field[], i: number): number {
  if (!fields[i] || !isHeading(fields[i])) return 1;
  let j = i + 1;
  while (j < fields.length && !isHeading(fields[j])) j++;
  return j - i;
}

/** Where a dragged heading may land: before a heading, or at the end (sections stay whole). */
export function headingDrops(fields: Field[]): number[] {
  return [...fields.map((f, i) => (isHeading(f) ? i : -1)).filter((i) => i >= 0), fields.length];
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/** The order after moving rows `from … from+size-1` to insertion point `drop`
 * (0 … length); null if they'd stay where they are. */
export function dragOrder(length: number, from: number, size: number, drop: number): number[] | null {
  if (drop >= from && drop <= from + size) return null;
  const moving = range(from, from + size);
  const rest = range(0, length).filter((i) => i < from || i >= from + size);
  const at = drop > from ? drop - size : drop;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * The order after "Move to section…": row `from` (with its fields, if it's a
 * heading) goes to the end of the section of heading `target`, or with
 * `target` -1 to the top part (before the first heading). Null if nothing moves.
 */
export function sectionOrder(fields: Field[], from: number, target: number): number[] | null {
  const size = blockSize(fields, from);
  const moving = range(from, from + size);
  const rest = range(0, fields.length).filter((i) => i < from || i >= from + size);
  let at: number;
  if (target < 0) {
    at = rest.findIndex((i) => isHeading(fields[i]));
    if (at < 0) at = rest.length;
  } else {
    at = rest.indexOf(target) + 1;
    if (at === 0) return null;
    while (at < rest.length && !isHeading(fields[rest[at]])) at++;
  }
  const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return order.every((v, k) => v === k) ? null : order;
}

/** The heading row `i` sits under (-1: the top part). */
export function sectionOf(fields: Field[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (isHeading(fields[j])) return j;
  return -1;
}

export const inOrder = <T,>(list: T[], order: number[]): T[] => order.map((i) => list[i]);
