// Files dragged in from Finder / Explorer. The app window receives them
// (the webview never sees them as HTML drag and drop), so one listener sends
// each drop to the registered target under the pointer: the text editor, an
// infobox Image field, the gallery dialog. While files are dragged over a
// target it gets the class `files-over`.
import { useEffect, useRef, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface DropPoint {
  /** CSS pixels in the window. */
  x: number;
  y: number;
}

interface Target {
  ref: RefObject<HTMLElement | null>;
  drop: (paths: string[], at: DropPoint) => void;
}

const targets = new Set<Target>();
let listening = false;
let over: HTMLElement | null = null;

/** The innermost registered target under the point. */
function targetAt(p: DropPoint): Target | null {
  const hit = document.elementFromPoint(p.x, p.y);
  if (!hit) return null;
  let best: Target | null = null;
  for (const t of targets) {
    const el = t.ref.current;
    if (!el || !el.contains(hit)) continue;
    if (!best || best.ref.current!.contains(el)) best = t;
  }
  return best;
}

function setOver(el: HTMLElement | null) {
  if (over === el) return;
  over?.classList.remove("files-over");
  over = el;
  over?.classList.add("files-over");
}

function listen() {
  if (listening) return;
  listening = true;
  let paths: string[] = [];
  getCurrentWebview()
    .onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") {
        setOver(null);
        return;
      }
      if (payload.type === "enter") paths = payload.paths;
      // Positions arrive in physical pixels.
      const scale = window.devicePixelRatio || 1;
      const at = { x: payload.position.x / scale, y: payload.position.y / scale };
      const target = targetAt(at);
      if (payload.type === "drop") {
        setOver(null);
        if (target && payload.paths.length) target.drop(payload.paths, at);
        paths = [];
      } else {
        setOver(paths.length && target ? target.ref.current : null);
      }
    })
    .catch(() => {
      listening = false;
    });
}

/** Makes the element in `ref` accept dropped files while `enabled`. */
export function useFileDrop(
  ref: RefObject<HTMLElement | null>,
  drop: (paths: string[], at: DropPoint) => void,
  enabled = true,
) {
  const dropRef = useRef(drop);
  dropRef.current = drop;
  useEffect(() => {
    if (!enabled) return;
    listen();
    const t: Target = { ref, drop: (p, at) => dropRef.current(p, at) };
    targets.add(t);
    return () => {
      targets.delete(t);
      if (over && over === ref.current) setOver(null);
    };
  }, [ref, enabled]);
}
