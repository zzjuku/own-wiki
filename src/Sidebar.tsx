// The sidebar page tree. Only the rows on screen are rendered, so it stays
// fast with thousands of pages. Drag and drop uses pointer events (not HTML5
// drag and drop, which the Windows webview intercepts for file drops).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IS_MAC } from "./QuickOpen";
import { parentOf, ROOT, type Row } from "./tree";

export const ROW_HEIGHT = 28;
const OVERSCAN = 12;
const DRAG_START_PX = 5;
const EXPAND_ON_HOVER_MS = 650;
const AUTOSCROLL_EDGE_PX = 36;

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

interface Props {
  rows: Row[];
  selected: string | null;
  /** Pages picked with ⌘/Ctrl-click or Shift-click (several at once). */
  picked: ReadonlySet<string>;
  onPick: (ids: Set<string>) => void;
  /** Group highlighted as the place new pages and groups go (null = none). */
  selectedGroup: string | null;
  /** Row to scroll into view; a new object each time it's asked for. */
  reveal: { id: string } | null;
  onOpenPage: (id: string) => void;
  onSelectGroup: (id: string) => void;
  /** Click on empty space below the rows. */
  onSelectTop: () => void;
  onToggle: (groupId: string, open: boolean) => void;
  menuFor: (row: Row) => MenuItem[];
  canDrop: (row: Row, target: string) => boolean;
  onDrop: (row: Row, target: string) => void;
  empty: ReactNode;
}

interface Drag {
  row: Row;
  x: number;
  y: number;
  /** Group id the row would be dropped into, or null for nowhere. */
  target: string | null;
}

export function Sidebar(props: Props) {
  const { rows, selected, reveal } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  // Latest props for the window-level pointer handlers.
  const live = useRef(props);
  live.current = props;
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Scroll a row into view when asked to.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const i = reveal ? rows.findIndex((r) => r.id === reveal.id) : -1;
    if (!el || i < 0) return;
    const top = i * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    // Only when asked: not on every rows change, or it would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  function startPointer(e: React.PointerEvent, row: Row) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let current: Drag | null = null;
    let hoverGroup: string | null = null;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let scrollFrame = 0;
    let lastY = startY;

    const targetAt = (x: number, y: number): { target: string | null; group: string | null } => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const zone = el?.closest<HTMLElement>("[data-drop]");
      // Drop zones: tree rows, the tree's empty space, and the project name (top level).
      if (!zone || !zone.closest(".sidebar")) return { target: null, group: null };
      const target = zone.dataset.drop ?? null;
      const ok = target !== null && live.current.canDrop(row, target);
      return { target: ok ? target : null, group: zone.dataset.group ?? null };
    };

    const autoscroll = () => {
      const el = scrollRef.current;
      if (!el || !current) return;
      const r = el.getBoundingClientRect();
      if (lastY < r.top + AUTOSCROLL_EDGE_PX) el.scrollTop -= 12;
      else if (lastY > r.bottom - AUTOSCROLL_EDGE_PX) el.scrollTop += 12;
      scrollFrame = requestAnimationFrame(autoscroll);
    };

    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (!current) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_PX) return;
        current = { row, x: ev.clientX, y: ev.clientY, target: null };
        document.body.classList.add("dragging");
        scrollFrame = requestAnimationFrame(autoscroll);
      }
      const { target, group } = targetAt(ev.clientX, ev.clientY);
      current = { row, x: ev.clientX, y: ev.clientY, target };
      document.body.classList.toggle("drag-root", target === ROOT);
      setDrag(current);
      // Hovering over a closed group opens it after a moment.
      if (group !== hoverGroup) {
        hoverGroup = group;
        clearTimeout(hoverTimer);
        const r = live.current.rows.find((x) => x.id === group && x.kind === "group");
        if (group && r && !r.expanded && group !== row.id) {
          hoverTimer = setTimeout(() => live.current.onToggle(group, true), EXPAND_ON_HOVER_MS);
        }
      }
    };

    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      clearTimeout(hoverTimer);
      cancelAnimationFrame(scrollFrame);
      document.body.classList.remove("dragging", "drag-root");
      if (current) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (drop && current.target !== null) live.current.onDrop(row, current.target);
      }
      current = null;
      setDrag(null);
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && current) {
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  }

  function openMenu(x: number, y: number, row: Row) {
    setMenu({ x, y, items: props.menuFor(row) });
  }

  // Where a Shift-click range starts: the last page clicked.
  const anchor = useRef<string | null>(null);

  function activate(row: Row, e: React.MouseEvent) {
    if (suppressClick.current) return;
    const multi = (IS_MAC ? e.metaKey : e.ctrlKey) || e.shiftKey;
    if (row.kind === "page" && multi) {
      // ⌘/Ctrl-click: add or take away one page (the open one counts as picked);
      // Shift-click: every page between the last one clicked and this one.
      const base = new Set(props.picked.size ? props.picked : selected ? [selected] : []);
      const from = anchor.current ?? selected;
      if (e.shiftKey && from) {
        const pages = rows.filter((r) => r.kind === "page").map((r) => r.id);
        const [a, b] = [pages.indexOf(from), pages.indexOf(row.id)].sort((x, y) => x - y);
        if (a >= 0) pages.slice(a, b + 1).forEach((id) => base.add(id));
        else base.add(row.id);
      } else if (base.has(row.id)) base.delete(row.id);
      else base.add(row.id);
      anchor.current = row.id;
      props.onPick(base);
      return;
    }
    anchor.current = row.kind === "page" ? row.id : anchor.current;
    if (props.picked.size) props.onPick(new Set());
    if (row.kind === "group") {
      props.onSelectGroup(row.id);
      props.onToggle(row.id, !row.expanded);
    } else props.onOpenPage(row.id);
  }

  return (
    <>
      <div
        ref={scrollRef}
        className={`tree ${drag?.target === ROOT ? "drop-root" : ""}`}
        data-drop={ROOT}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t === e.currentTarget || t.classList.contains("tree-inner")) props.onSelectTop();
        }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        role="tree"
        aria-label="Pages"
      >
        {rows.length === 0 && <div className="tree-empty">{props.empty}</div>}
        <div className="tree-inner" style={{ height: rows.length * ROW_HEIGHT }}>
          {rows.slice(first, last).map((row, i) => {
            const isPicked = row.kind === "page" && props.picked.has(row.id);
            const isSelected =
              row.kind === "page" ? row.id === selected || isPicked : row.id === props.selectedGroup;
            const isTarget = row.kind === "group" && drag?.target === row.id;
            const isDragged = drag?.row.id === row.id;
            return (
              <div
                key={row.kind + row.id}
                className={[
                  "tree-row",
                  `is-${row.kind}`,
                  isSelected && "selected",
                  isPicked && "picked",
                  isTarget && "drop-target",
                  isDragged && "drag-source",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ top: (first + i) * ROW_HEIGHT, paddingLeft: 6 + row.depth * 14 }}
                data-drop={row.kind === "group" ? row.id : parentOf(row.id)}
                data-group={row.kind === "group" ? row.id : undefined}
                role="treeitem"
                aria-expanded={row.kind === "group" ? row.expanded : undefined}
                aria-selected={isSelected}
                aria-level={row.depth + 1}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(e.clientX, e.clientY, row);
                }}
              >
                <button
                  className="tree-main"
                  title={row.label}
                  onPointerDown={(e) => startPointer(e, row)}
                  onClick={(e) => activate(row, e)}
                >
                  {row.kind === "group" ? (
                    <span className={`chevron ${row.expanded ? "open" : ""}`} aria-hidden>
                      <svg viewBox="0 0 10 10" width="10" height="10">
                        <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    </span>
                  ) : (
                    <span className="chevron" aria-hidden />
                  )}
                  <span className={`tree-label ${row.kind === "group" ? "group-label" : ""}`}>
                    {row.label}
                  </span>
                  {row.kind === "group" && row.empty && row.expanded && (
                    <span className="tree-note">empty</span>
                  )}
                </button>
                <button
                  className="tree-more"
                  aria-label={`Actions for ${row.label}`}
                  title="Actions"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openMenu(r.left, r.bottom + 2, row);
                  }}
                >
                  ⋯
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
          {drag.row.kind === "group" ? "▸ " : ""}
          {drag.row.label}
        </div>
      )}
      {menu && <ContextMenu {...menu} close={() => setMenu(null)} />}
    </>
  );
}

function ContextMenu({
  x,
  y,
  items,
  close,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    // Keep the menu inside the window.
    const r = ref.current!.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 6),
      y: Math.min(y, window.innerHeight - r.height - 6),
    });
    ref.current!.querySelector("button")?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [close]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const buttons = [...ref.current!.querySelectorAll("button")];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? "danger-text" : ""}
          onClick={() => {
            close();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
