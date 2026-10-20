// The right edge of the page column: drag it to make pages wider or narrower
// (all projects, this computer only), double-click to go back to the theme's
// page width. The edge keeps its place on screen, so the infobox stays put
// when the sidebar is hidden or shown and the text takes the room.
import { useLayoutEffect, useRef } from "react";
import { PAGE_WIDTH_MIN, setPageRight, usePageRight } from "./layoutPrefs";

export function PageWidthHandle() {
  const ref = useRef<HTMLDivElement>(null);
  const right = usePageRight();

  // The column's width: from where it starts to the dragged edge, again
  // whenever the room around it changes (sidebar, window size).
  useLayoutEffect(() => {
    const column = ref.current?.parentElement;
    const view = column?.parentElement;
    if (!column || !view) return;
    const fit = () => {
      if (right === null) return column.style.removeProperty("--page-width");
      const left = column.getBoundingClientRect().left;
      column.style.setProperty("--page-width", `${Math.max(PAGE_WIDTH_MIN, right - left)}px`);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(view);
    return () => watch.disconnect();
  }, [right]);

  function start(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const column = e.currentTarget.parentElement!;
    const box = column.getBoundingClientRect();
    const startX = e.clientX;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    let x: number | null = null;
    const move = (ev: PointerEvent) => {
      x = Math.max(box.left + PAGE_WIDTH_MIN, box.right + ev.clientX - startX);
      setPageRight(x, false);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("dragging");
      if (x !== null) setPageRight(x);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return (
    <div
      ref={ref}
      className="page-width-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Page width"
      title="Drag to change the page width (all projects, this computer). Double-click: the theme's width."
      onPointerDown={start}
      onDoubleClick={() => setPageRight(null)}
    />
  );
}
