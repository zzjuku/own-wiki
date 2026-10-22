// Save as image (M12): the whole tree (not only the part on screen), with
// spoilers as currently shown. SVG keeps everything as shapes and text, with
// the theme's colours written in and pictures embedded; PNG is drawn on a
// canvas at twice the size, which can use the theme's fonts.
import type { TreeLayout } from "./layout";

const PAD = 24;
/** Canvas sides above this are refused by browsers; the PNG is made smaller to fit. */
const MAX_SIDE = 16000;

/** Style properties written into the SVG (its classes and theme variables don't travel). */
const PROPS = [
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-opacity", "opacity",
  "font-family", "font-size", "font-weight", "font-style", "rx",
] as const;

function bounds(layout: TreeLayout) {
  const b = layout.bounds;
  // Couple labels sit above their lines; lines stay within the boxes' rows.
  return { x: b.minX - PAD, y: b.minY - PAD, w: b.maxX - b.minX + 2 * PAD, h: b.maxY - b.minY + 2 * PAD };
}

/** The colour behind the tree (the first ancestor with one). */
function background(svg: SVGSVGElement): string {
  for (let el: Element | null = svg; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") return c;
  }
  return "#ffffff";
}

/** A picture as a data URL (so the file holds it), drawn through a canvas:
 * the app's pictures can be loaded as images but not fetched. */
async function dataUrl(url: string): Promise<string | null> {
  const img = await loadImage(url);
  if (!img) return null;
  try {
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.naturalWidth, img.naturalHeight];
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** The tree as an SVG file. */
export async function treeSvg(svg: SVGSVGElement, layout: TreeLayout): Promise<string> {
  const { x, y, w, h } = bounds(layout);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Styles from the live tree, element by element (the clone has the same shape).
  const live = [svg, ...svg.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  const drop: Element[] = [];
  live.forEach((el, i) => {
    const c = copies[i] as SVGElement;
    // Clickable copies of lines and tooltips stay out.
    if (el.matches("[data-line], title")) drop.push(c);
    const s = getComputedStyle(el);
    c.setAttribute("style", PROPS.map((p) => `${p}:${s.getPropertyValue(p)}`).join(";"));
    c.removeAttribute("class");
    for (const a of [...c.attributes]) if (a.name.startsWith("data-")) c.removeAttribute(a.name);
  });
  drop.forEach((n) => n.remove());
  clone.querySelector("g")?.removeAttribute("transform");
  for (const img of clone.querySelectorAll("image")) {
    const src = await dataUrl(img.getAttribute("href") ?? "");
    if (src) img.setAttribute("href", src);
    else img.remove();
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  clone.setAttribute("width", String(Math.ceil(w)));
  clone.setAttribute("height", String(Math.ceil(h)));
  clone.removeAttribute("role");
  clone.removeAttribute("aria-label");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  Object.entries({ x, y, width: w, height: h, fill: background(svg) }).forEach(([k, v]) => bg.setAttribute(k, String(v)));
  clone.insertBefore(bg, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

/** The tree as a PNG file, drawn from the live SVG's shapes with their styles. */
export async function treePng(svg: SVGSVGElement, layout: TreeLayout): Promise<Uint8Array> {
  const { x, y, w, h } = bounds(layout);
  const scale = Math.min(2, MAX_SIDE / w, MAX_SIDE / h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background(svg);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  // (The outer group's transform is the screen's pan and zoom: left out.)
  const group = svg.querySelector("g");
  for (const child of group?.children ?? []) await draw(ctx, child);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The picture couldn't be made (the tree may be too big).");
  return new Uint8Array(await blob.arrayBuffer());
}

const num = (v: string | null | undefined, fallback = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
};

function stroke(ctx: CanvasRenderingContext2D, s: CSSStyleDeclaration) {
  if (s.stroke === "none" || s.stroke === "transparent" || s.stroke === "rgba(0, 0, 0, 0)") return false;
  ctx.strokeStyle = s.stroke;
  ctx.lineWidth = num(s.strokeWidth, 1);
  ctx.lineCap = (s.strokeLinecap as CanvasLineCap) || "butt";
  const dash = s.strokeDasharray && s.strokeDasharray !== "none" ? s.strokeDasharray.split(/[ ,]+/).map((d) => num(d)) : [];
  ctx.setLineDash(dash);
  ctx.globalAlpha = num(s.strokeOpacity, 1) * num(s.opacity, 1);
  return true;
}

/** Draws an SVG element and its children (the shapes the tree uses: g, rect, path, image, text). */
async function draw(ctx: CanvasRenderingContext2D, el: Element): Promise<void> {
  if (el.matches("[data-line], clipPath, title")) return;
  const s = getComputedStyle(el);
  if (s.display === "none") return;
  ctx.save();
  const t = el.getAttribute("transform")?.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
  if (el.tagName === "g" && t) ctx.translate(num(t[1]), num(t[2]));
  switch (el.tagName) {
    case "rect": {
      const [rx, ry, rw, rh] = ["x", "y", "width", "height"].map((a) => num(el.getAttribute(a)));
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, num(s.getPropertyValue("rx")));
      if (s.fill !== "none") {
        ctx.fillStyle = s.fill;
        ctx.globalAlpha = num(s.opacity, 1);
        ctx.fill();
      }
      if (stroke(ctx, s)) ctx.stroke();
      break;
    }
    case "path":
      if (stroke(ctx, s)) ctx.stroke(new Path2D(el.getAttribute("d") ?? ""));
      break;
    case "image": {
      const [ix, iy, iw, ih] = ["x", "y", "width", "height"].map((a) => num(el.getAttribute(a)));
      const img = await loadImage(el.getAttribute("href") ?? "");
      if (img) {
        // preserveAspectRatio "xMidYMin slice": fill the frame, cut the sides or the bottom.
        const k = Math.max(iw / img.width, ih / img.height);
        const sw = iw / k;
        const sh = ih / k;
        ctx.beginPath();
        ctx.roundRect(ix, iy, iw, ih, num(getComputedStyle(el.parentElement!.querySelector(".tree-picture-clip") ?? el).getPropertyValue("rx")));
        ctx.clip();
        ctx.drawImage(img, (img.width - sw) / 2, 0, sw, sh, ix, iy, iw, ih);
      }
      break;
    }
    case "text": {
      ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      ctx.fillStyle = s.fill;
      ctx.globalAlpha = num(s.opacity, 1);
      const anchor = el.getAttribute("text-anchor");
      ctx.textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
      ctx.textBaseline = el.getAttribute("dominant-baseline") === "central" ? "middle" : "alphabetic";
      const tx = num(el.getAttribute("x"));
      let ty = num(el.getAttribute("y"));
      const spans = el.querySelectorAll("tspan");
      if (!spans.length) ctx.fillText(el.textContent ?? "", tx, ty);
      spans.forEach((sp) => {
        ty += num(sp.getAttribute("dy"));
        ctx.fillText(sp.textContent ?? "", num(sp.getAttribute("x"), tx), ty);
      });
      break;
    }
    default:
      for (const child of el.children) await draw(ctx, child);
  }
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // (Pictures come from the app's own scheme, which allows this: the canvas stays readable.)
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
