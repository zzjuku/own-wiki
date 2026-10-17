import { useEffect, useRef, useState } from "react";

interface Props {
  onInsert: (rows: number, cols: number) => void;
  close: () => void;
}

const clamp = (v: string, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v)) || 1));

/** Asks for the size of a new table (default 3 × 3). */
export function TableDialog({ onInsert, close }: Props) {
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("3");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.select(), []);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="dialog"
        role="dialog"
        aria-label="Insert table"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(clamp(rows, 100), clamp(cols, 20));
        }}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <h2>Insert table</h2>
        <div className="row">
          <label className="field grow">
            <span>Rows</span>
            <input ref={first} type="number" min={1} max={100} value={rows} onChange={(e) => setRows(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Columns</span>
            <input type="number" min={1} max={20} value={cols} onChange={(e) => setCols(e.target.value)} />
          </label>
        </div>
        <p className="muted small-note">A header row is added on top.</p>
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}
