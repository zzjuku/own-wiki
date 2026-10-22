// Draws a laid-out family tree (M12) as SVG: boxes with name, picture and
// years, couple lines, children's lines, stubs and spoiler boxes. Wheel or
// pinch zooms, dragging pans (a click on a box still opens it). Resting on a
// box shows the hover card and highlights its lines; resting on a stub
// highlights the full box, and clicking the stub moves there.
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, type Ref, type RefObject } from "react";
import { HOVER_DELAY_MS, showCardFor } from "../HoverCard";
import { imageUrl } from "../infobox";
import { type Family, labelText, lifeYears } from "./data";
import type { Placed, TreeLayout } from "./layout";
import type { TBox } from "./model";

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface TreeHandle {
  fit: (animate?: boolean) => void;
  /** Moves `key`'s box into the middle (and flashes it). */
  centreOn: (key: string, animate?: boolean) => void;
  zoom: (factor: number) => void;
  getView: () => View;
  setView: (v: View) => void;
  /** The drawing (Save as image). */
  svg: () => SVGSVGElement | null;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;
const CLICK_SLOP = 4;
const PAD = 8;
/** Space between the frame and a picture. */
const INSET = 5;
/** Height of the name and years under a picture. */
export const TEXT_H = 50;

/** Measures text in the tree's font (canvas, cached per font). */
let ctx: CanvasRenderingContext2D | null = null;
export function measureText(text: string, font: string): number {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** A name in at most two lines of `width`, cut with "…". */
export function wrapName(name: string, width: number, font: string): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measureText(next, font) <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === 1) {
      line = words.slice(i).join(" ");
      break;
    }
  }
  lines.push(line);
  return lines.slice(0, 2).map((l) => {
    if (measureText(l, font) <= width) return l;
    let cut = l;
    while (cut.length > 1 && measureText(`${cut}…`, font) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  });
}

/** Zoom out, zoom in and Fit for a tree (the screen's corner, a page tree's bar). */
export function ZoomButtons({ handle }: { handle: RefObject<TreeHandle | null> }) {
  return (
    <>
      <button className="plain" title="Zoom out" aria-label="Zoom out" onClick={() => handle.current?.zoom(1 / 1.25)}>
        −
      </button>
      <button className="plain" title="Zoom in" aria-label="Zoom in" onClick={() => handle.current?.zoom(1.25)}>
        +
      </button>
      <button className="plain" title="Show the whole tree" onClick={() => handle.current?.fit(true)}>
        Fit
      </button>
    </>
  );
}

/** What is selected on the Family tree screen: a box, or a line (its place in the layout's lines). */
export type Selection = { kind: "box"; key: string } | { kind: "line"; index: number };

export interface TreeFonts {
  name: string;
  years: string;
}

export function TreeCanvas({
  layout,
  fam,
  project,
  centreKey,
  spoilers,
  fonts,
  handle,
  onOpen,
  onReveal,
  onCreate,
  label,
  wheelZoom = true,
  selection,
}: {
  layout: TreeLayout;
  fam: Family;
  project: string;
  centreKey: string;
  spoilers: boolean;
  fonts: TreeFonts;
  handle?: Ref<TreeHandle>;
  onOpen: (person: number) => void;
  onReveal: (keys: string[]) => void;
  onCreate: (person: number) => void;
  label: string;
  /** The wheel zooms (the Family tree screen); off in page text, where it scrolls the page. */
  wheelZoom?: boolean;
  /** Selecting (the Family tree screen): a click selects a person or a line, a double-click opens. */
  selection?: { selected: Selection | null; onSelect: (s: Selection | null) => void };
}) {
  const svg = useRef<SVGSVGElement>(null);
  const group = useRef<SVGGElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const anim = useRef<number>(0);

  const apply = useCallback(() => {
    const v = view.current;
    group.current?.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
  }, []);

  const animateTo = useCallback(
    (to: View, animate: boolean) => {
      cancelAnimationFrame(anim.current);
      if (!animate) {
        view.current = to;
        return apply();
      }
      const from = { ...view.current };
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 350);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
        apply();
        if (t < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [apply],
  );

  const byKey = useMemo(() => new Map(layout.boxes.map((b) => [b.key, b])), [layout]);

  const api = useMemo<TreeHandle>(
    () => ({
      fit: (animate = false) => {
        const el = svg.current;
        if (!el || !layout.boxes.length) return;
        const { width, height } = el.getBoundingClientRect();
        const b = layout.bounds;
        const k = Math.min(1.2, Math.max(MIN_ZOOM, Math.min((width - 60) / (b.maxX - b.minX || 1), (height - 60) / (b.maxY - b.minY || 1))));
        animateTo({ k, x: width / 2 - ((b.minX + b.maxX) / 2) * k, y: height / 2 - ((b.minY + b.maxY) / 2) * k }, animate);
      },
      centreOn: (key, animate = true) => {
        const el = svg.current;
        const b = byKey.get(key);
        if (!el || !b) return;
        const { width, height } = el.getBoundingClientRect();
        const k = Math.max(view.current.k, 0.6);
        animateTo({ k, x: width / 2 - (b.x + b.w / 2) * k, y: height / 2 - (b.y + b.h / 2) * k }, animate);
        const node = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
        node?.classList.remove("flash");
        void (node as SVGElement | null)?.getBoundingClientRect();
        node?.classList.add("flash");
      },
      zoom: (factor) => {
        const el = svg.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        zoomAt(width / 2, height / 2, factor);
      },
      getView: () => ({ ...view.current }),
      setView: (v) => animateTo(v, false),
      svg: () => svg.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, byKey, animateTo],
  );
  useImperativeHandle(handle, () => api, [api]);

  function zoomAt(px: number, py: number, factor: number) {
    const v = view.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
    const f = k / v.k;
    view.current = { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    cancelAnimationFrame(anim.current);
    apply();
  }

  // Wheel and pinch zoom (passive: false, so the page doesn't scroll).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      // In page text the wheel scrolls the page (zoom with the buttons).
      if (!wheelZoom) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // Dragging pans; a press that doesn't move is a click.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  // The click that ends a drag opens nothing.
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      svg.current?.setPointerCapture(e.pointerId);
      svg.current?.classList.add("panning");
      hover(null);
    }
    cancelAnimationFrame(anim.current);
    view.current = { ...view.current, x: d.vx + dx, y: d.vy + dy };
    apply();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    dragged.current = !!d?.moved;
    svg.current?.classList.remove("panning");
    if (d?.moved) svg.current?.releasePointerCapture(e.pointerId);
  };
  const onClick = (e: React.MouseEvent) => {
    if (dragged.current) return void (dragged.current = false);
    const target = e.target as Element;
    const el = target.closest<SVGGElement>("[data-key]");
    const b = el ? byKey.get(el.dataset.key!) : undefined;
    if (!b) {
      const line = target.closest<SVGPathElement>("[data-line]");
      return selection?.onSelect(line ? { kind: "line", index: Number(line.dataset.line) } : null);
    }
    hover(null);
    if (b.box.kind === "stub") api.centreOn(b.box.target!);
    else if (b.box.kind === "hidden") onReveal(b.box.reveal ?? []);
    else if (selection) selection.onSelect(b.box.kind === "person" || b.box.kind === "placeholder" ? { kind: "box", key: b.key } : null);
    else if (b.box.kind === "placeholder") onCreate(b.box.person!);
    else if (b.box.kind === "person") onOpen(b.box.person!);
  };
  // While selecting, a double-click opens (a placeholder: creates its page).
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!selection) return;
    const b = byKey.get((e.target as Element).closest<SVGGElement>("[data-key]")?.dataset.key ?? "");
    if (b?.box.kind === "placeholder") onCreate(b.box.person!);
    else if (b?.box.kind === "person") onOpen(b.box.person!);
  };

  // Hover: lines of the box light up (stubs: their full box); the card after a moment.
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovered = useRef<string | null>(null);
  function hover(key: string | null) {
    if (key === hovered.current) return;
    const el = svg.current;
    if (!el) return;
    clearTimeout(hoverTimer.current);
    el.querySelectorAll(".lit").forEach((n) => n.classList.remove("lit"));
    hovered.current = key;
    showCardFor(null);
    if (!key) return;
    const b = byKey.get(key);
    if (!b) return;
    const target = b.box.kind === "stub" ? b.box.target! : key;
    el.querySelectorAll(`[data-p~="${CSS.escape(target)}"], [data-key="${CSS.escape(target)}"]`).forEach((n) => n.classList.add("lit"));
    const person = b.box.person;
    if (b.box.kind !== "person" && b.box.kind !== "placeholder") return;
    hoverTimer.current = setTimeout(() => {
      const node = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (!node || hovered.current !== key || person === undefined) return;
      const rect = node.getBoundingClientRect();
      const p = fam.people[person];
      showCardFor(p.id ? { rect, pageId: p.id } : { rect, missing: p.title });
    }, HOVER_DELAY_MS);
  }
  useEffect(() => () => {
    clearTimeout(hoverTimer.current);
    showCardFor(null);
  }, []);
  const onPointerOver = (e: React.PointerEvent) => {
    if (drag.current?.moved) return;
    const el = (e.target as Element).closest<SVGGElement>("[data-key]");
    hover(el?.dataset.key ?? null);
  };

  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const selecting = !!selection;
  const selectedBox = selection?.selected?.kind === "box" ? selection.selected.key : null;
  const selectedLine = selection?.selected?.kind === "line" ? selection.selected.index : null;
  const boxes = useMemo(
    () =>
      layout.boxes.map((b) => (
        <BoxView
          key={b.key}
          b={b}
          fam={fam}
          project={project}
          centre={b.key === centreKey}
          selected={selectedBox === b.key}
          spoilers={spoilers}
          fonts={fonts}
          clip={`${ids}${b.key}`}
        />
      )),
    [layout, fam, project, centreKey, selectedBox, spoilers, fonts, ids],
  );
  const lines = useMemo(
    () => (
      <>
        {layout.lines.map((l, i) => (
          <path key={i} d={l.d} className={`tree-line ${l.style} ${l.kind}${selectedLine === i ? " selected" : ""}`} data-p={l.people.join(" ")} />
        ))}
        {/* Wider invisible lines, easier to click. */}
        {selecting &&
          layout.lines.map((l, i) => (l.select ? <path key={`hit${i}`} d={l.d} className="tree-line-hit" data-line={i} /> : null))}
      </>
    ),
    [layout, selectedLine, selecting],
  );
  const labels = useMemo(
    () =>
      layout.labels.map((l, i) => (
        <text key={i} x={l.x} y={l.y} className="tree-couple-label" textAnchor="middle">
          {labelText(l.text, spoilers)}
        </text>
      )),
    [layout, spoilers],
  );

  return (
    <svg
      ref={svg}
      className="tree-canvas"
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerOver={onPointerOver}
      onPointerLeave={() => hover(null)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <g ref={group}>
        <g className="tree-lines">{lines}</g>
        {labels}
        {boxes}
      </g>
    </svg>
  );
}

function BoxView({
  b,
  fam,
  project,
  centre,
  selected,
  spoilers,
  fonts,
  clip,
}: {
  b: Placed;
  fam: Family;
  project: string;
  centre: boolean;
  selected: boolean;
  spoilers: boolean;
  fonts: TreeFonts;
  /** Id for the picture's clip path (unique in the window). */
  clip: string;
}) {
  const p = b.box.person !== undefined ? fam.people[b.box.person] : undefined;
  const common = {
    "data-key": b.key,
    "data-name": b.box.kind === "hidden" ? undefined : p?.title,
    className: `tree-box ${b.box.kind}${centre ? " centre" : ""}${selected ? " selected" : ""}`,
    transform: `translate(${b.x},${b.y})`,
  };
  if (b.box.kind === "stub") {
    return (
      <g {...common} data-target={b.box.target}>
        <title>{`${p?.title ?? ""} — shown elsewhere in this tree. Click to go there.`}</title>
        <rect width={b.w} height={b.h} />
        <text x={b.w / 2} y={b.h / 2} dominantBaseline="central" textAnchor="middle">
          ↪ {p?.title}
        </text>
      </g>
    );
  }
  if (b.box.kind === "hidden" || b.box.kind === "unknown") {
    return (
      <g {...common}>
        <title>{b.box.kind === "hidden" ? "Spoiler: click to reveal" : "Unknown parent"}</title>
        <rect width={b.w} height={b.h} />
        <text x={b.w / 2} y={b.h / 2} dominantBaseline="central" textAnchor="middle">
          {b.box.kind === "hidden" ? "▒▒▒" : "?"}
        </text>
      </g>
    );
  }
  // A picture: big on top, name and years below; else name and years only.
  const image = hasPicture(b.box, fam) ? imageUrl(project, p!.image!, b.w) : null;
  const picH = image ? b.h - TEXT_H : 0;
  const name = wrapName(p?.title ?? "", b.w - 2 * PAD, fonts.name);
  const years = p ? lifeYears(p, spoilers) : "";
  const lineH = 17;
  const total = name.length * lineH + (years ? 15 : 0);
  const top = picH + (b.h - picH - total) / 2 + 13;
  return (
    <g {...common}>
      <rect width={b.w} height={b.h} />
      {image && (
        <>
          <clipPath id={clip}>
            <rect className="tree-picture-clip" x={INSET} y={INSET} width={b.w - 2 * INSET} height={picH - INSET} />
          </clipPath>
          <image
            href={image}
            x={INSET}
            y={INSET}
            width={b.w - 2 * INSET}
            height={picH - INSET}
            preserveAspectRatio="xMidYMin slice"
            clipPath={`url(#${clip})`}
          />
        </>
      )}
      <text className="tree-name" x={b.w / 2} y={top} textAnchor="middle">
        {name.map((l, i) => (
          <tspan key={i} x={b.w / 2} dy={i ? lineH : 0}>
            {l}
          </tspan>
        ))}
      </text>
      {years && (
        <text className="tree-years" x={b.w / 2} y={top + name.length * lineH - 1} textAnchor="middle">
          {years}
        </text>
      )}
    </g>
  );
}

/** A person box that shows a picture (the page's hover-card image). */
export function hasPicture(b: TBox, fam: Family): boolean {
  return b.kind === "person" && !!fam.people[b.person!]?.image;
}
