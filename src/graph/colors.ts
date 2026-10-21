// The graph's colours come from theme variables (--graph-…, src/theme.css).
// sigma.js draws with WebGL and only understands hex and rgb() colours, so
// every value is turned into rgba() by painting it once.
import { useEffect, useState } from "react";
import type { GraphColors } from "./controller";

const VARS: Record<Exclude<keyof GraphColors, "font">, string> = {
  bg: "--graph-bg",
  node: "--graph-node",
  active: "--graph-node-active",
  faded: "--graph-node-faded",
  line: "--graph-line",
  lineActive: "--graph-line-active",
  label: "--graph-label",
  missing: "--graph-red-link",
  category: "--graph-category",
  group: "--graph-group",
};

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour as rgba(), as sigma.js reads it. */
export function toRgba(css: string): string {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return css;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${Math.round((a / 255) * 100) / 100})`;
}

export function readColors(el: Element = document.documentElement): GraphColors {
  const style = getComputedStyle(el);
  const out = { font: style.getPropertyValue("--font-ui").trim() || "sans-serif" } as GraphColors;
  for (const [k, v] of Object.entries(VARS)) out[k as keyof typeof VARS] = toRgba(style.getPropertyValue(v).trim() || "#888");
  return out;
}

/** The graph colours of the current theme, updated when the theme changes. */
export function useGraphColors(): GraphColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    // Themes are applied by rewriting a <style> element in <head> (themes/runtime.tsx).
    const obs = new MutationObserver(() => setColors((old) => {
      const next = readColors();
      return JSON.stringify(next) === JSON.stringify(old) ? old : next;
    }));
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, []);
  return colors;
}
