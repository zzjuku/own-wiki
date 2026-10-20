// Colour arithmetic for themes: reading CSS colours, mixing them, and
// picking readable text. Only the forms themes use: #rgb, #rrggbb,
// #rrggbbaa, rgb()/rgba() with commas or spaces and an optional alpha.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

export function formatColor({ r, g, b, a }: Rgba): string {
  if (a >= 0.999) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${+a.toFixed(3)})`;
}

/** `a` moved `amount` (0–1) of the way towards `b`. */
export function mix(a: string, b: string, amount: number): string | null {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return null;
  const t = (p: number, q: number) => p + (q - p) * amount;
  return formatColor({ r: t(x.r, y.r), g: t(x.g, y.g), b: t(x.b, y.b), a: t(x.a, y.a) });
}

/** The colour with opacity `alpha`. */
export function withAlpha(color: string, alpha: number): string | null {
  const c = parseColor(color);
  return c ? formatColor({ ...c, a: alpha }) : null;
}

/** Relative luminance (0 black – 1 white). */
export function luminance(color: string): number | null {
  const c = parseColor(color);
  if (!c) return null;
  const [r, g, b] = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark or white text, whichever reads better on `color`. */
export function readableOn(color: string): string | null {
  const l = luminance(color);
  if (l === null) return null;
  return l > 0.4 ? "#202122" : "#ffffff";
}

/** "#rrggbb" for a colour input (alpha dropped), or null. */
export function toHex6(value: string): string | null {
  const c = parseColor(value);
  return c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : null;
}
