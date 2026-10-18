// Small form controls shared by the template screen and the Infobox tab:
// a colour picker, a list of removable chips, and drag-to-reorder rows.
import { useRef, useState } from "react";
import { contrastText, isColor, SWATCHES } from "./infobox";

/** Colour swatches plus a custom colour; `null` = the theme's colour. */
export function ColorPicker({
  value,
  onChange,
  defaultLabel = "Theme colour",
}: {
  value: string | null | undefined;
  onChange: (c: string | null) => void;
  defaultLabel?: string;
}) {
  const current = isColor(value) ? value.toLowerCase() : null;
  const custom = current !== null && !SWATCHES.includes(current);
  return (
    <div className="color-picker" role="group" aria-label="Infobox colour">
      <button
        type="button"
        className={`swatch theme-swatch ${current === null ? "selected" : ""}`}
        title={defaultLabel}
        aria-label={defaultLabel}
        aria-pressed={current === null}
        onClick={() => onChange(null)}
      >
        A
      </button>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch ${current === c ? "selected" : ""}`}
          style={{ background: c }}
          title={c}
          aria-label={`Colour ${c}`}
          aria-pressed={current === c}
          onClick={() => onChange(c)}
        />
      ))}
      <label
        className={`swatch custom-swatch ${custom ? "selected" : ""}`}
        title="Other colour…"
        style={custom ? { background: current!, color: contrastText(current!) } : undefined}
      >
        <span aria-hidden="true">+</span>
        <input
          type="color"
          aria-label="Other colour"
          value={current ?? "#cedff2"}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
      </label>
    </div>
  );
}

/** Removable chips with an input to add more (choice options, field names). */
export function Chips({
  values,
  onChange,
  placeholder,
  suggestions = [],
  label,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  suggestions?: string[];
  label: string;
}) {
  const [text, setText] = useState("");
  const listId = useRef(`chips-${Math.random().toString(36).slice(2)}`).current;
  function add() {
    const v = text.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setText("");
  }
  const offered = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className="chips" role="group" aria-label={label}>
      {values.map((v, i) => (
        <span key={`${v}-${i}`} className="alias-chip">
          {v}
          <button type="button" aria-label={`Remove ${v}`} title="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="chips-input"
        value={text}
        placeholder={placeholder}
        list={offered.length ? listId : undefined}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
      />
      {offered.length > 0 && (
        <datalist id={listId}>
          {offered.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}

/**
 * Drag-to-reorder for a vertical list. Rows carry `data-reorder`; dragging
 * starts on a handle (`start(event, index)`). While dragging, `drop` is the
 * insertion point (0 … rows) to draw a line at. Pointer events, because the
 * Windows webview intercepts HTML5 drag and drop.
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const listRef = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; drop: number } | null>(null);

  function start(e: React.PointerEvent, from: number) {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    const rows = [...listRef.current.querySelectorAll<HTMLElement>(":scope > [data-reorder]")];
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    let drop = from;
    setDrag({ from, drop });
    document.body.classList.add("reordering");
    const move = (ev: PointerEvent) => {
      const next = mids.filter((m) => m < ev.clientY).length;
      if (next !== drop) {
        drop = next;
        setDrag({ from, drop });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("reordering");
      setDrag(null);
      const to = drop > from ? drop - 1 : drop;
      if (to !== from) onMove(from, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Class for row `i` showing where a dragged row would land. */
  function rowClass(i: number, count: number): string {
    if (!drag) return "";
    const parts = [];
    if (i === drag.from) parts.push("reorder-source");
    if (drag.drop === i && drag.drop !== drag.from && drag.drop !== drag.from + 1) parts.push("drop-before");
    if (i === count - 1 && drag.drop === count && drag.from !== count - 1) parts.push("drop-after");
    return parts.join(" ");
  }

  return { listRef, start, rowClass, dragging: drag !== null };
}

/** Moves item `from` to position `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function DragHandle({ onPointerDown, label }: { onPointerDown: (e: React.PointerEvent) => void; label: string }) {
  return (
    <span className="drag-handle" title="Drag to reorder" aria-label={label} onPointerDown={onPointerDown}>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
        {[3, 8, 13].map((y) => (
          <g key={y}>
            <circle cx="2.5" cy={y} r="1.3" />
            <circle cx="7.5" cy={y} r="1.3" />
          </g>
        ))}
      </svg>
    </span>
  );
}
