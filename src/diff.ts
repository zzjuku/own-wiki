// Differences between two versions of a page (M10: the edit clash bar's
// "Show differences" and the Conflicts screen): text line by line, infobox
// field by field, side by side.
import type { Infobox } from "./api";
import { valueText } from "./infobox";

/** One row of a side-by-side view; null = no line on that side. */
export interface DiffRow {
  left: string | null;
  right: string | null;
  changed: boolean;
}

/** Above this many line pairs, lines are only paired up in order (no alignment). */
const MAX_CELLS = 4_000_000;

/** Lines of `a` and `b` side by side: equal lines aligned, changed runs paired. */
export function diffLines(a: string, b: string): DiffRow[] {
  const x = a.replace(/\n$/, "").split("\n");
  const y = b.replace(/\n$/, "").split("\n");
  if (x.length * y.length > MAX_CELLS) {
    return Array.from({ length: Math.max(x.length, y.length) }, (_, i) => ({
      left: x[i] ?? null,
      right: y[i] ?? null,
      changed: x[i] !== y[i],
    }));
  }
  // Longest common subsequence, from the end.
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const rows: DiffRow[] = [];
  let left: string[] = [];
  let right: string[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(left.length, right.length); k++) rows.push({ left: left[k] ?? null, right: right[k] ?? null, changed: true });
    left = [];
    right = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      flush();
      rows.push({ left: x[i], right: y[j], changed: false });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) left.push(x[i++]);
    else right.push(y[j++]);
  }
  flush();
  return rows;
}

export interface FieldRow {
  label: string;
  left: string | null;
  right: string | null;
  changed: boolean;
}

/** Infobox values side by side, matched by field name; the box's own settings (colour, template) as rows too. */
export function diffFields(a: Infobox | null, b: Infobox | null): FieldRow[] {
  const values = (ib: Infobox | null) => {
    const m = new Map<string, { label: string; text: string }>();
    for (const f of ib?.fields ?? []) {
      if (f.type === "heading" || f.type === "divider") continue;
      const text = (f.spoiler ? "(spoiler) " : "") + (f.value === undefined || f.value === null ? "" : valueText(f));
      m.set(f.label.trim().toLowerCase(), { label: f.label, text });
    }
    return m;
  };
  const x = values(a);
  const y = values(b);
  const keys = [...new Set([...x.keys(), ...y.keys()])];
  const rows: FieldRow[] = keys.map((k) => {
    const l = x.get(k);
    const r = y.get(k);
    return { label: (l ?? r)!.label, left: l?.text ?? null, right: r?.text ?? null, changed: l?.text !== r?.text };
  });
  if (!a !== !b) rows.unshift({ label: "Infobox", left: a ? "yes" : "none", right: b ? "yes" : "none", changed: true });
  return rows;
}
