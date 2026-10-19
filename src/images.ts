// Images in page text: `[[File:Name.png|right|medium|Caption]]`, and
// galleries: `File|Caption` lines between `<gallery>` and `</gallery>`.
// Nobody types this: the Image and Gallery buttons, drag and drop, paste and
// the Edit image popup write it. The Rust side (src-tauri/src/wikilinks.rs)
// finds the same images and the links in their captions.
import { blockAround } from "./quotes";
import { isFileName } from "./wikilinks";

export type ImagePos = "right" | "left" | "center" | "full";
export type ImageSize = "small" | "medium" | "large";

export interface TextImage {
  /** File name inside the project's assets/ folder. */
  file: string;
  pos: ImagePos;
  size: ImageSize;
  /** Inline Markdown (bold, italic, [[links]], ||spoilers||). */
  caption: string;
  /** Blurred (and its caption hidden) until clicked. */
  spoiler?: boolean;
}

export interface GalleryItem {
  file: string;
  caption: string;
}

export const POSITIONS: { value: ImagePos; label: string }[] = [
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "full", label: "Full width" },
];

export const SIZES: { value: ImageSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

/** Width on the page in CSS pixels (must match .wiki-image in styles/images.css). */
export const SIZE_PX: Record<ImageSize, number> = { small: 160, medium: 250, large: 400 };
/** Full-width images are shown from a copy at most this wide. */
export const FULL_PX = 1200;
/** Gallery cells (must match .wiki-gallery in styles/images.css). */
export const GALLERY_PX = 170;

const POS_WORDS: Record<string, ImagePos> = { right: "right", left: "left", center: "center", centre: "center", full: "full" };
const SIZE_WORDS: Record<string, ImageSize> = { small: "small", medium: "medium", large: "large" };

/** Image file types for page text (SVG included) and for infobox fields. */
export const TEXT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
export const FIELD_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

export const hasExtension = (path: string, list: string[]) =>
  list.includes(path.slice(path.lastIndexOf(".") + 1).toLowerCase());

/** `[[File:…]]` at the start of `src` (one line; the caption may hold [[links]]). */
export function imageAtStart(src: string): { length: number; inner: string } | null {
  if (!src.startsWith("[[") || !isFileName(src.slice(2))) return null;
  let depth = 1;
  for (let j = 2; j + 1 < src.length; ) {
    const c = src[j];
    if (c === "\n") return null;
    if (c === "[" && src[j + 1] === "[") {
      depth++;
      j += 2;
    } else if (c === "]" && src[j + 1] === "]") {
      depth--;
      j += 2;
      if (depth === 0) return { length: j, inner: src.slice(2, j - 2) };
    } else j++;
  }
  return null;
}

/** Splits at `|` outside nested [[links]]. */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) {
      depth++;
      i++;
    } else if (s.startsWith("]]", i)) {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (s[i] === "|" && depth === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  // In tables the separator is written `\|`.
  return parts.map((p, i) => (i < parts.length - 1 && p.endsWith("\\") ? p.slice(0, -1) : p));
}

/** The inside of `[[File:…]]` as an image. */
export function parseImage(inner: string): TextImage {
  const [first, ...rest] = splitTop(inner);
  const img: TextImage = { file: first.slice(5).trim(), pos: "right", size: "medium", caption: "" };
  for (const part of rest) {
    const word = part.trim().toLowerCase();
    if (POS_WORDS[word]) img.pos = POS_WORDS[word];
    else if (SIZE_WORDS[word]) img.size = SIZE_WORDS[word];
    else if (word === "spoiler") img.spoiler = true;
    // A `|` in the caption is stored as `&#124;` (so `||spoilers||` work there too).
    else img.caption = part.trim().replace(/&#124;/g, "|");
  }
  return img;
}

/** Unfinished `[[` (and stray `]]`) become single brackets, so they can't break the image. */
function balanceBrackets(s: string): string {
  const opens: number[] = [];
  const drop = new Set<number>();
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) {
      opens.push(i);
      i++;
    } else if (s.startsWith("]]", i)) {
      if (opens.length) opens.pop();
      else drop.add(i);
      i++;
    }
  }
  for (const i of opens) drop.add(i);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += s[i];
    if (drop.has(i)) i++;
  }
  return out;
}

/** A caption safe to write between `|`s: one line, balanced brackets, plain `|` written as `&#124;`. */
function cleanCaption(caption: string, inTable: boolean): string {
  const one = balanceBrackets(caption.replace(/\s*\r?\n\s*/g, " ").trim());
  let out = "";
  let depth = 0;
  for (let i = 0; i < one.length; i++) {
    if (one.startsWith("[[", i)) {
      depth++;
      out += "[[";
      i++;
    } else if (one.startsWith("]]", i)) {
      depth = Math.max(0, depth - 1);
      out += "]]";
      i++;
    } else if (one[i] === "|") {
      if (depth === 0) out += "&#124;";
      // A link's own `|` inside a table row.
      else out += inTable && one[i - 1] !== "\\" ? "\\|" : "|";
    } else out += one[i];
  }
  return out;
}

/** The source of an image. In table rows the `|` is written `\|`. */
export function imageSource(img: TextImage, inTable = false): string {
  const pipe = inTable ? "\\|" : "|";
  const caption = cleanCaption(img.caption, inTable);
  const spoiler = img.spoiler ? `${pipe}spoiler` : "";
  return `[[File:${img.file.trim()}${pipe}${img.pos}${pipe}${img.size}${spoiler}${caption ? pipe + caption : ""}]]`;
}

export const newImage = (file: string): TextImage => ({ file, pos: "right", size: "medium", caption: "" });

// ---- galleries ----

export const GALLERY_OPEN = /^ {0,3}<gallery(\s+spoiler)?>[ \t]*$/i;
/** A whole gallery at the start of the text: m[1] "spoiler", m[2] its lines. */
export const GALLERY = /^ {0,3}<gallery(\s+spoiler)?>[ \t]*(?:\n([\s\S]*?))?\n {0,3}<\/gallery>[ \t]*(?:\n+|$)/i;
export const GALLERY_CLOSE = /^ {0,3}<\/gallery>[ \t]*$/i;

/** The images of a gallery, from the lines between its tags. */
export function parseGallery(lines: string[]): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const raw of lines) {
    let t = raw.trim();
    if (!t) continue;
    if (isFileName(t)) t = t.slice(5);
    const bar = t.indexOf("|");
    const file = (bar < 0 ? t : t.slice(0, bar)).trim();
    if (file) items.push({ file, caption: bar < 0 ? "" : t.slice(bar + 1).trim() });
  }
  return items;
}

export function gallerySource(items: GalleryItem[], spoiler = false): string {
  const lines = items.map((i) => {
    const caption = i.caption.replace(/\s*\r?\n\s*/g, " ").trim();
    return caption ? `${i.file}|${caption}` : i.file;
  });
  return [spoiler ? "<gallery spoiler>" : "<gallery>", ...lines, "</gallery>"].join("\n");
}

/** The gallery whose lines include line `n` (0-based) of `lines`: its first and last line. */
export const galleryAround = (lines: string[], n: number) => blockAround(lines, n, GALLERY_OPEN, GALLERY_CLOSE);
