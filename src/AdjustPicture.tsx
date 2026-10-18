// "Adjust picture": shows an infobox picture in its frame, large. A size
// slider goes from the whole picture to 4× closer; dragging moves the picture
// in any direction. The part outside the frame shows faintly around it.
import { useEffect, useRef, useState } from "react";
import type { Frame } from "./api";
import { imageUrl, MAX_ZOOM, minZoom, placement, pictureStyle, type Crop } from "./infobox";

interface Props {
  project: string;
  file: string;
  crop: Crop | undefined;
  frame: Frame;
  save: (crop: Crop) => void;
  close: () => void;
}

const SHOW_MAX = { width: 460, height: 380 };
/** Room around the frame where the rest of the picture shows. */
const MARGIN = { x: 90, y: 60 };

export function AdjustPicture({ project, file, crop, frame, save, close }: Props) {
  const k = Math.min(1, SHOW_MAX.width / frame.width, SHOW_MAX.height / frame.height);
  const pw = Math.round(frame.width * k);
  const ph = Math.round(frame.height * k);
  const [aspect, setAspect] = useState<number | null>(crop?.aspect ?? null);
  const [c, setC] = useState({ x: crop?.x ?? 50, y: crop?.y ?? 50, zoom: crop?.zoom ?? 1 });
  const lowest = aspect ? minZoom(aspect, frame) : 1;
  const zoom = Math.min(MAX_ZOOM, Math.max(lowest, c.zoom));
  const current: Crop = { x: c.x, y: c.y, zoom, aspect: aspect ?? undefined };
  const p = aspect ? placement(current, frame) : null;
  const style = pictureStyle(aspect ? current : undefined, frame);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close]);

  function setZoom(z: number) {
    setC((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(lowest, z)) }));
  }

  function drag(e: React.PointerEvent) {
    if (!p || e.button !== 0) return;
    e.preventDefault();
    // How far the picture sticks out of the frame (negative: it's smaller).
    const ox = (p.width / 100) * pw - pw;
    const oy = (p.height / 100) * ph - ph;
    const start = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
    const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
    const move = (ev: PointerEvent) =>
      setC((v) => ({
        ...v,
        x: Math.abs(ox) > 1 ? clamp(start.cx - ((ev.clientX - start.x) / ox) * 100) : v.x,
        y: Math.abs(oy) > 1 ? clamp(start.cy - ((ev.clientY - start.y) / oy) * 100) : v.y,
      }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("reordering");
    };
    document.body.classList.add("reordering");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const src = imageUrl(project, file, Math.min(1280, frame.width * MAX_ZOOM));
  const log = Math.log;

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog adjust-dialog" role="dialog" aria-label="Adjust picture">
        <h2>Adjust picture</h2>
        <p className="muted small-note">Drag the picture to move it. The frame shows what the infobox will show.</p>
        <div
          className="adjust-stage"
          style={{ width: pw + 2 * MARGIN.x, height: ph + 2 * MARGIN.y }}
          onWheel={(e) => aspect && setZoom(zoom * Math.exp(-e.deltaY * 0.002))}
        >
          {/* The whole picture, faint, then the framed part on top. */}
          <div className="adjust-ghost" style={{ left: MARGIN.x, top: MARGIN.y, width: pw, height: ph }}>
            {aspect && <img src={src} alt="" draggable={false} style={styleObject(style)} />}
          </div>
          <div
            ref={frameRef}
            className={`adjust-frame ${aspect ? "movable" : ""}`}
            style={{ left: MARGIN.x, top: MARGIN.y, width: pw, height: ph }}
            onPointerDown={drag}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              style={styleObject(style)}
              onLoad={(e) => {
                const i = e.currentTarget;
                if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight);
              }}
            />
          </div>
        </div>
        <div className="adjust-zoom">
          <span className="muted small">Smaller</span>
          <input
            type="range"
            aria-label="Picture size"
            min={log(lowest)}
            max={log(MAX_ZOOM)}
            step={0.005}
            value={log(zoom)}
            disabled={!aspect}
            onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
          />
          <span className="muted small">Larger</span>
        </div>
        <div className="row adjust-presets">
          <button type="button" disabled={!aspect} onClick={() => setC({ x: 50, y: 50, zoom: lowest })}>
            Whole picture
          </button>
          <button type="button" onClick={() => setC((v) => ({ ...v, zoom: 1 }))}>
            Fill the frame
          </button>
          <button type="button" onClick={() => setC((v) => ({ ...v, x: 50, y: 50 }))}>
            Centre
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!aspect}
            onClick={() => save({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, zoom: Math.round(zoom * 1000) / 1000, aspect: Math.round(aspect! * 10000) / 10000 })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** "a:b;c:d" -> a React style object. */
export function styleObject(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const part of css.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim().replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    out[key] = part.slice(i + 1).trim();
  }
  return out as React.CSSProperties;
}
