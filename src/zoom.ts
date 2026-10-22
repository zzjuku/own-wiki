// Zoom (M13): the whole app bigger or smaller, 50–200 % in 10 % steps, with
// Cmd + scroll (Ctrl + scroll on Windows), Cmd/Ctrl + = − 0 and Settings →
// Zoom. Remembered on this computer (local storage, never synced). The Graph
// and Family tree drawings keep their own wheel and pinch zoom: on the Mac
// Cmd + scroll is never theirs; on Windows Ctrl + scroll over them is (a
// trackpad pinch sends the same), and the keys zoom the app.
import { useSyncExternalStore } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IS_MAC } from "./QuickOpen";

const KEY = "ownwiki.zoom";
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
/** Wheel movement (pixels) that makes one step; a mouse wheel's notch is about 100. */
const WHEEL_PER_STEP = 100;
/** Drawings that zoom themselves (on Windows, Ctrl + scroll over them is theirs). */
const CANVASES = ".graph-canvas, .tree-canvas, .local-graph";

let level = load();
const listeners = new Set<() => void>();

function load(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? Math.round(n / ZOOM_STEP) * ZOOM_STEP : 100;
  } catch {
    return 100;
  }
}

function apply() {
  // (Outside the app, e.g. in tests, there's no webview: nothing to do.)
  void getCurrentWebview()
    .setZoom(level / 100)
    .catch(() => {});
}

/** Sets the zoom level (percent), within 50–200 % on a 10 % step. */
export function setZoom(percent: number) {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent / ZOOM_STEP) * ZOOM_STEP));
  if (next === level) return;
  level = next;
  try {
    localStorage.setItem(KEY, String(level));
  } catch {
    // Not remembering it is harmless.
  }
  apply();
  listeners.forEach((l) => l());
}

export const zoomLevel = () => level;

export function useZoom(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => level,
  );
}

/** Applies the remembered level and listens for the wheel and keys (once, at start). */
export function initZoom() {
  if (level !== 100) apply();
  let wheel = 0;
  window.addEventListener(
    "wheel",
    (e) => {
      if (!(IS_MAC ? e.metaKey : e.ctrlKey)) return;
      if (!IS_MAC && (e.target as Element | null)?.closest?.(CANVASES)) return;
      e.preventDefault();
      e.stopPropagation();
      wheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      while (Math.abs(wheel) >= WHEEL_PER_STEP) {
        setZoom(level + (wheel < 0 ? ZOOM_STEP : -ZOOM_STEP));
        wheel -= Math.sign(wheel) * WHEEL_PER_STEP;
      }
    },
    { passive: false, capture: true },
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (!(IS_MAC ? e.metaKey : e.ctrlKey) || e.altKey) return;
      const step = e.key === "=" || e.key === "+" ? 1 : e.key === "-" || e.key === "_" ? -1 : e.key === "0" && !e.shiftKey ? 0 : null;
      if (step === null) return;
      e.preventDefault();
      setZoom(step === 0 ? 100 : level + step * ZOOM_STEP);
    },
    { capture: true },
  );
}
