// The right edge of the page column: drag it to make pages wider or
// narrower (all projects, this computer only), double-click to go back to
// the theme's page width.
import { PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, setPageWidth } from "./layoutPrefs";

export function PageWidthHandle() {
  function start(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const column = e.currentTarget.parentElement!;
    const startX = e.clientX;
    const startWidth = column.getBoundingClientRect().width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      width = Math.min(PAGE_WIDTH_MAX, Math.max(PAGE_WIDTH_MIN, startWidth + ev.clientX - startX));
      setPageWidth(width, false);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("dragging");
      if (width !== startWidth) setPageWidth(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return (
    <div
      className="page-width-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Page width"
      title="Drag to change the page width (all projects, this computer). Double-click: the theme's width."
      onPointerDown={start}
      onDoubleClick={() => setPageWidth(null)}
    />
  );
}
