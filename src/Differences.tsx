// Two versions of a page side by side, differences marked (M10): the edit
// clash bar's "Show differences" and the Conflicts screen.
import { useMemo, type ReactNode } from "react";
import type { Infobox } from "./api";
import { diffFields, diffLines, type DiffRow } from "./diff";

export interface Version {
  /** "Yours", "Original"… */
  label: string;
  /** Under the label, e.g. when it was changed. */
  note?: string;
  text: string;
  infobox?: Infobox | null;
}

/** Unchanged lines kept around a change; longer unchanged runs fold. */
const CONTEXT = 2;

type Shown = DiffRow | { fold: number };

function folded(rows: DiffRow[]): Shown[] {
  const out: Shown[] = [];
  const near = (i: number) => rows.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((r) => r.changed);
  let skipped = 0;
  rows.forEach((r, i) => {
    if (r.changed || near(i)) {
      if (skipped) out.push({ fold: skipped });
      skipped = 0;
      out.push(r);
    } else skipped++;
  });
  if (skipped) out.push({ fold: skipped });
  return out;
}

const cell = (s: string | null) => (s === null ? <span className="diff-none">—</span> : s || " ");

export function Differences({ left, right, boxes = true }: { left: Version; right: Version; boxes?: boolean }) {
  const rows = useMemo(() => folded(diffLines(left.text, right.text)), [left.text, right.text]);
  const fields = useMemo(() => (boxes ? diffFields(left.infobox ?? null, right.infobox ?? null) : []), [boxes, left.infobox, right.infobox]);
  const textSame = rows.every((r) => !("changed" in r) || !r.changed);
  const head = (v: Version): ReactNode => (
    <th>
      {v.label}
      {v.note && <span className="diff-note">{v.note}</span>}
    </th>
  );
  return (
    <div className="differences">
      {fields.length > 0 && (
        <table className="diff-table diff-fields">
          <thead>
            <tr>
              <th className="diff-label">Infobox</th>
              {head(left)}
              {head(right)}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.label} className={f.changed ? "changed" : ""}>
                <td className="diff-label">{f.label}</td>
                <td>{cell(f.left)}</td>
                <td>{cell(f.right)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="diff-table diff-text">
        <thead>
          <tr>
            {head(left)}
            {head(right)}
          </tr>
        </thead>
        <tbody>
          {textSame && (
            <tr>
              <td colSpan={2} className="muted">
                The text is the same.
              </td>
            </tr>
          )}
          {!textSame &&
            rows.map((r, i) =>
              "fold" in r ? (
                <tr key={i} className="diff-fold">
                  <td colSpan={2}>
                    … {r.fold} unchanged {r.fold === 1 ? "line" : "lines"} …
                  </td>
                </tr>
              ) : (
                <tr key={i} className={r.changed ? "changed" : ""}>
                  <td>{cell(r.left)}</td>
                  <td>{cell(r.right)}</td>
                </tr>
              ),
            )}
        </tbody>
      </table>
    </div>
  );
}
