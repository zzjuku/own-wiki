// Full-size image viewer: clicking an image in the read view or the editor
// preview shows it as large as the window allows. Zoom with the wheel,
// pinch, + and −, or a double-click; drag to move a zoomed image. The arrow
// keys step through the page's images (from a gallery: through that
// gallery). Esc closes. Also marks images whose file is missing.
import { useEffect, useRef, useState } from "react";
import { isHiddenSpoiler } from "./spoilers";

const CONTENT = ".read-view .markdown, .split-preview .markdown";
const MAX_ZOOM = 8;

interface Shot {
  src: string;
  caption: string;
  file: string;
}

function shotOf(img: HTMLImageElement): Shot {
  const box = img.closest(".wiki-image, .gallery-item, .infobox-image");
  const caption = box?.querySelector(".wiki-caption, figcaption, .infobox-caption")?.textContent?.trim() ?? "";
  const file = box?.getAttribute("data-file") ?? img.dataset.file ?? "";
  return { src: img.dataset.full || img.src, caption, file };
}

export function ImageViewer() {
  const [view, setView] = useState<{ shots: Shot[]; index: number } | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  // Open on click; mark images that don't load.
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const img = (e.target as Element).closest?.("img");
      if (!img || !img.closest(CONTENT) || img.closest("a")) return;
      const root = img.closest(CONTENT)!;
      const gallery = img.closest(".wiki-gallery");
      const all = [...(gallery ?? root).querySelectorAll<HTMLImageElement>("img")].filter(
        (i) => (gallery || !i.closest(".wiki-gallery")) && !i.closest(".broken") && !isHiddenSpoiler(i),
      );
      const index = Math.max(0, all.indexOf(img));
      e.preventDefault();
      setZoom({ scale: 1, x: 0, y: 0 });
      setView({ shots: all.map(shotOf), index });
    };
    const error = (e: Event) => {
      const img = e.target as HTMLElement;
      if (img.tagName !== "IMG" || !img.closest(CONTENT)) return;
      const box = img.closest(".wiki-image, .gallery-item, .infobox-image");
      box?.classList.add("broken");
      box?.setAttribute("title", `Image not found: ${box.getAttribute("data-file") ?? ""}`);
    };
    document.addEventListener("click", click);
    document.addEventListener("error", error, true);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("error", error, true);
    };
  }, []);

  const step = (d: number) => {
    setView((v) => (v && v.shots.length > 1 ? { ...v, index: (v.index + d + v.shots.length) % v.shots.length } : v));
    setZoom({ scale: 1, x: 0, y: 0 });
  };

  /** Zooms by `factor` around a point on screen (default: the middle). */
  function zoomBy(factor: number, cx = window.innerWidth / 2, cy = window.innerHeight / 2) {
    setZoom((z) => {
      const scale = Math.min(MAX_ZOOM, Math.max(1, z.scale * factor));
      if (scale === 1) return { scale: 1, x: 0, y: 0 };
      // Keep the point under the cursor in place.
      const ox = cx - window.innerWidth / 2;
      const oy = cy - window.innerHeight / 2;
      const k = scale / z.scale;
      return { scale, x: ox - (ox - z.x) * k, y: oy - (oy - z.y) * k };
    });
  }

  useEffect(() => {
    if (!view) return;
    const key = (e: KeyboardEvent) => {
      const handled = ["Escape", "ArrowLeft", "ArrowRight", "+", "=", "-", "0"].includes(e.key);
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") setView(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "+" || e.key === "=") zoomBy(1.5);
      else if (e.key === "-") zoomBy(1 / 1.5);
      else setZoom({ scale: 1, x: 0, y: 0 });
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [view]);

  if (!view) return null;
  const shot = view.shots[view.index];
  const many = view.shots.length > 1;

  function drag(e: React.PointerEvent) {
    if (zoom.scale === 1 || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y };
    const move = (ev: PointerEvent) => setZoom((z) => ({ ...z, x: start.zx + ev.clientX - start.x, y: start.zy + ev.clientY - start.y }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-label="Image"
      onMouseDown={(e) => e.target === e.currentTarget && setView(null)}
      onWheel={(e) => zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY)}
    >
      <div className="viewer-stage" onMouseDown={(e) => e.target === e.currentTarget && setView(null)}>
        <img
          ref={imgRef}
          key={shot.src}
          src={shot.src}
          alt={shot.caption}
          draggable={false}
          className={`${zoom.scale > 1 ? "zoomed" : ""} ${/\.svg$/i.test(shot.file) ? "vector" : ""}`}
          style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
          onPointerDown={drag}
          onDoubleClick={(e) => (zoom.scale > 1 ? setZoom({ scale: 1, x: 0, y: 0 }) : zoomBy(2.5, e.clientX, e.clientY))}
        />
      </div>
      {many && (
        <>
          <button className="viewer-nav prev" aria-label="Previous image" title="Previous (←)" onClick={() => step(-1)}>
            ‹
          </button>
          <button className="viewer-nav next" aria-label="Next image" title="Next (→)" onClick={() => step(1)}>
            ›
          </button>
        </>
      )}
      <div className="viewer-bar">
        <div className="viewer-text">
          {shot.caption && <span className="viewer-caption">{shot.caption}</span>}
          <span className="viewer-file">
            {many && `${view.index + 1} / ${view.shots.length} · `}
            {shot.file}
          </span>
        </div>
        <div className="viewer-tools">
          <button aria-label="Zoom out" title="Zoom out (−)" disabled={zoom.scale <= 1} onClick={() => zoomBy(1 / 1.5)}>
            −
          </button>
          <button title="Fit to window (0)" disabled={zoom.scale === 1} onClick={() => setZoom({ scale: 1, x: 0, y: 0 })}>
            Fit
          </button>
          <button aria-label="Zoom in" title="Zoom in (+)" disabled={zoom.scale >= MAX_ZOOM} onClick={() => zoomBy(1.5)}>
            +
          </button>
          <button aria-label="Close" title="Close (Esc)" onClick={() => setView(null)}>
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
