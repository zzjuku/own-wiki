// Small form controls shared by the template screen and the Infobox tab:
// a colour picker, a list of removable chips, and drag-to-reorder rows.
import { useRef, useState } from "react";
import { dragOrder } from "./fieldMoves";
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

/** The nearest ancestor that scrolls vertically (null: the page itself). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Near the top or bottom edge of the scrolling area (px), the list scrolls by itself. */
const EDGE = 48;
const MAX_SPEED = 22;

/**
 * Drag-to-reorder for a vertical list. Rows carry `data-reorder`; dragging
 * starts on a handle (`start(event, index)`). `size(i)`: how many rows move
 * together from row i (a section heading takes its fields along); `drops(i)`:
 * the only insertion points allowed for row i, if limited. While dragging,
 * the list scrolls by itself when the pointer nears its top or bottom edge.
 * `onMove` gets the new order (old indexes). Pointer events, because the
 * Windows webview intercepts HTML5 drag and drop.
 */
export function useReorder(
  onMove: (order: number[]) => void,
  { size = () => 1, drops }: { size?: (i: number) => number; drops?: (i: number) => number[] | null } = {},
) {
  const listRef = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; size: number; drop: number } | null>(null);

  function start(e: React.PointerEvent, from: number) {
    const list = listRef.current;
    if (e.button !== 0 || !list) return;
    e.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-reorder]")];
    const n = size(from);
    const allowed = drops?.(from) ?? null;
    const scroller = scrollParent(list);
    // Positions are kept relative to the scrolled content, so they stay right while it scrolls.
    const offset = () => (scroller ? scroller.scrollTop - scroller.getBoundingClientRect().top : window.scrollY);
    const at = offset();
    const boxes = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top + at, bottom: b.bottom + at };
    });
    const mids = boxes.map((b) => (b.top + b.bottom) / 2);
    const edgeAt = (k: number) => (k < boxes.length ? boxes[k].top : (boxes[boxes.length - 1]?.bottom ?? 0));
    let y = e.clientY;
    let drop = from;
    setDrag({ from, size: n, drop });
    document.body.classList.add("reordering");
    const update = () => {
      const pos = y + offset();
      const next = allowed
        ? allowed.reduce((best, k) => (Math.abs(edgeAt(k) - pos) < Math.abs(edgeAt(best) - pos) ? k : best), allowed[0])
        : mids.filter((m) => m < pos).length;
      if (next !== drop) {
        drop = next;
        setDrag({ from, size: n, drop });
      }
    };
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      const area = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const top = Math.max(area.top, 0);
      const bottom = Math.min(area.bottom, window.innerHeight);
      const speed = y < top + EDGE ? -(top + EDGE - y) : y > bottom - EDGE ? y - (bottom - EDGE) : 0;
      if (!speed) return;
      const step = Math.sign(speed) * Math.min(MAX_SPEED, Math.ceil((Math.abs(speed) / EDGE) * MAX_SPEED));
      const el = scroller ?? document.scrollingElement;
      if (!el) return;
      const before = el.scrollTop;
      el.scrollTop += step;
      if (el.scrollTop !== before) update();
    });
    const move = (ev: PointerEvent) => {
      y = ev.clientY;
      update();
    };
    const up = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("reordering");
      setDrag(null);
      const order = dragOrder(rows.length, from, n, drop);
      if (order) onMove(order);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Class for row `i` showing where the dragged rows would land. */
  function rowClass(i: number, count: number): string {
    if (!drag) return "";
    const parts = [];
    if (i >= drag.from && i < drag.from + drag.size) parts.push("reorder-source");
    const stays = drag.drop >= drag.from && drag.drop <= drag.from + drag.size;
    if (!stays && drag.drop === i) parts.push("drop-before");
    if (!stays && i === count - 1 && drag.drop === count) parts.push("drop-after");
    return parts.join(" ");
  }

  return { listRef, start, rowClass, dragging: drag !== null };
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
