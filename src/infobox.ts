// Templates and infoboxes in the page view: field types, values, and the
// AWOIAF-style box (HTML) for the read view and the editor preview.
// The file format is described in src-tauri/src/infobox.rs.
import { readableOn } from "./themes/color";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Field, FieldKind, Frame, Infobox, Relations, Template } from "./api";
import { renderInline, renderPage, slugify, spoilerHtml, type LinkContext } from "./markdown";
import { hasWords } from "./linkEntry";
import { reverseEntries, twoWayExtras, type RelationEntry } from "./relations";
import { norm } from "./wikilinks";
import { noteAt, withNoteHtml } from "./notes";

export interface KindInfo {
  kind: FieldKind;
  label: string;
  /** Has a value (headings and dividers don't; Linked from: names typed in). */
  hasValue: boolean;
}

export const KINDS: KindInfo[] = [
  { kind: "text", label: "Text", hasValue: true },
  { kind: "longtext", label: "Long text", hasValue: true },
  { kind: "number", label: "Number", hasValue: true },
  { kind: "yesno", label: "Yes/No", hasValue: true },
  { kind: "choice", label: "Choice", hasValue: true },
  { kind: "list", label: "List", hasValue: true },
  // One type for links to pages: one page or several (Juku, 2026-10-18).
  // "link" (exactly one page) still reads and edits, but isn't offered.
  { kind: "links", label: "Page link", hasValue: true },
  { kind: "link", label: "Page link (one page)", hasValue: true },
  { kind: "linkedfrom", label: "Linked from", hasValue: true },
  { kind: "date", label: "Date", hasValue: true },
  // A date (or range) with text after it: a place ("283 AC, Winterfell"), or a
  // smaller note ("283 – 298 AC  King of the Andals"); optionally several entries.
  { kind: "dateplace", label: "Date, place", hasValue: true },
  { kind: "datetext", label: "Date, text", hasValue: true },
  { kind: "image", label: "Image", hasValue: true },
  { kind: "heading", label: "Section heading", hasValue: false },
  { kind: "divider", label: "Divider", hasValue: false },
];

/** Section headings and dividers: they lay out the box and hold no value. */
export const isLayout = (k: string) => k === "heading" || k === "divider";

/** Where a field shows: in the box (default), or in the title area. Text,
 * Choice and List fields can go above or below the title (titles,
 * nicknames); Image fields beside it (e.g. a coat of arms). */
export type Place = "above" | "below" | "beside";
export const PLACES: Record<string, Place[]> = { text: ["above", "below"], choice: ["above", "below"], list: ["above", "below"], image: ["beside"] };

/** A field's place in the title area, if it has one (and its type allows it). */
export function titlePlace(f: Field): Place | null {
  const p = f.options?.place;
  return typeof p === "string" && (PLACES[f.type] ?? []).includes(p as Place) ? (p as Place) : null;
}

/** A field shown above or below the title that also keeps its row in the box. */
export const alsoInBox = (f: Field) => titlePlace(f) !== "beside" && f.options?.inBox === true;

/** A new field's starting label. */
export const newFieldLabel = (k: string) => (k === "heading" ? "New section" : k === "divider" ? "" : "New field");

export const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label ?? k;
export const hasValue = (k: string) => KINDS.find((x) => x.kind === k)?.hasValue ?? true;

/** Colours offered next to the custom colour picker. */
export const SWATCHES = ["#cedff2", "#d5e8d4", "#f8e0b0", "#f4cccc", "#e1d5e7", "#d9d9d9", "#b0c4de", "#c9a66b"];

// ---- ids ----

function randomPart(n = 4) {
  return Math.random().toString(36).slice(2, 2 + n).padEnd(n, "0");
}

/** A new template id: readable start, random end ("character-k2j4"). */
export function newTemplateId(name: string): string {
  const base = slugify(name).replace(/[^\p{L}\p{N}-]/gu, "").slice(0, 30) || "template";
  return `${base}-${randomPart()}`;
}

/** A key for a new template field ("f-k2j4"), unique within `fields`. Keys
 * are random rather than numbered, so a deleted field's key never comes back
 * (pages may still have that field). */
export function newFieldKey(fields: Field[]): string {
  const taken = new Set(fields.map((f) => f.key));
  for (;;) {
    const key = `f-${randomPart()}`;
    if (!taken.has(key)) return key;
  }
}

// ---- values ----

export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.every(isEmptyValue);
  if (typeof v === "object") return Object.values(v as object).every(isEmptyValue);
  return false;
}

export function fieldHasValue(f: Field): boolean {
  return hasValue(f.type) && !isEmptyValue(f.value);
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Why a stored value doesn't fit its field's type (null: it fits, or there is none). */
export function valueProblem(f: Field): string | null {
  const v = f.value;
  if (isEmptyValue(v)) return null;
  switch (f.type) {
    case "text":
    case "longtext":
    case "link":
      return typeof v === "string" ? null : "This value doesn't fit a " + kindLabel(f.type) + " field.";
    case "number":
      return typeof v === "number" ? null : "This isn't a number.";
    case "yesno":
      return typeof v === "boolean" ? null : "This isn't Yes or No.";
    case "choice":
      if (typeof v !== "string") return "This value doesn't fit a Choice field.";
      return (f.options?.choices ?? []).some((c) => c === v) ? null : `“${v}” isn't one of the options.`;
    case "list":
    case "links":
    case "linkedfrom":
      return isStringArray(v) ? null : "This value doesn't fit a " + kindLabel(f.type) + " field.";
    case "date":
      return typeof v === "object" && !Array.isArray(v) ? null : "This isn't a date.";
    case "dateplace":
    case "datetext": {
      const ok = (x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x);
      return (Array.isArray(v) ? v.every(ok) : ok(v)) ? null : "This value doesn't fit a " + kindLabel(f.type) + " field.";
    }
    case "image": {
      const file = typeof v === "object" && !Array.isArray(v) ? (v as { file?: unknown }).file : null;
      return file === undefined || typeof file === "string" ? null : "This isn't an image.";
    }
    default:
      return null;
  }
}

/** A stored value as plain text (for warnings about values that don't fit). */
export function rawValueText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isStringArray(v)) return v.join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** A value as short readable text (hidden values, warnings). */
export function valueText(f: Field): string {
  const v = f.value;
  if (!valueProblem(f)) {
    if (f.type === "yesno") return v ? "Yes" : "No";
    if (f.type === "date") return formatDate(v);
    if (isDateTextKind(f.type)) return dateEntries(v).map((e) => [formatDate(e.date), e.text].filter(Boolean).join(", ")).join("; ");
    if (f.type === "image") return (v as { file?: string })?.file ?? "";
  }
  return rawValueText(v);
}

const STRING_KINDS = ["text", "longtext", "choice", "link"];
const LIST_KINDS = ["list", "links", "linkedfrom"];

/** A value moved to another field type, converted where nothing is lost
 * (same rules as convert_value in src-tauri/src/infobox.rs). */
export function convertValue(v: unknown, to: string): unknown {
  const obj = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  // A date gets an empty text next to it; a date with no text is a plain date again.
  if (obj && isDateTextKind(to) && !("date" in obj) && !("text" in obj)) return { date: obj };
  if (obj && to === "date" && "date" in obj && isEmptyValue(obj.text)) return obj.date;
  const toString = STRING_KINDS.includes(to);
  const toList = LIST_KINDS.includes(to);
  if (Array.isArray(v) && toString && v.length <= 1 && v.every((x) => typeof x === "string")) return v[0] ?? null;
  if (typeof v === "string" && toList) return [v];
  if (typeof v === "number" && toString) return String(v);
  if (typeof v === "number" && toList) return [String(v)];
  if (typeof v === "string" && to === "number") {
    const n = Number(v.trim());
    return v.trim() !== "" && Number.isFinite(n) ? n : v;
  }
  return v;
}

/** Empty strings and lists are stored as no value. */
export function cleanValue(v: unknown): unknown {
  if (typeof v === "string") return v.trim() === "" ? undefined : v;
  if (Array.isArray(v)) {
    const items = v.filter((x) => !isEmptyValue(x));
    return items.length ? items : undefined;
  }
  return isEmptyValue(v) ? undefined : v;
}

// ---- dates ----

/** One entry of a Date, place or Date, text field. */
export interface DateEntry {
  date?: unknown;
  /** A place, or a note; Markdown (links, bold…). */
  text?: string;
}

export const isDateTextKind = (k: string) => k === "dateplace" || k === "datetext";

/** The entries of a Date, place / Date, text value (one entry or a list of them). */
export function dateEntries(v: unknown): DateEntry[] {
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  return list.filter((e): e is DateEntry => !!e && typeof e === "object" && !Array.isArray(e));
}

export type Qualifier = "c" | "before" | "after";

export interface DatePoint {
  year?: number;
  era?: string;
  month?: number;
  day?: number;
  qualifier?: Qualifier;
}

export interface DateRange {
  start?: DatePoint;
  /** "present" = still going on. */
  end?: DatePoint | "present";
}

export const isRange = (v: unknown): v is DateRange =>
  typeof v === "object" && v !== null && ("start" in v || "end" in v);

const QUALIFIER_TEXT: Record<Qualifier, string> = { c: "c. ", before: "before ", after: "after " };

function pointText(p: DatePoint, withEra: boolean): string {
  if (p.year === undefined || p.year === null) return "";
  const year = p.year < 0 ? `−${-p.year}` : String(p.year);
  const day = p.month ? `${p.day ? `${p.day}.` : ""}${p.month}.` : "";
  const q = p.qualifier ? QUALIFIER_TEXT[p.qualifier] ?? "" : "";
  const era = withEra && p.era?.trim() ? ` ${p.era.trim()}` : "";
  return `${q}${day}${year}${era}`;
}

// ---- ages ----

/** A date field's role for ages: a birth date or a death date. */
export function ageRole(f: Field): "birth" | "death" | null {
  const r = f.options?.age;
  return (f.type === "date" || f.type === "dateplace") && (r === "birth" || r === "death") ? r : null;
}

/** The date a Date or Date, place field holds (a range: its start). */
function fieldDate(f: Field): DatePoint | null {
  const v = f.type === "dateplace" ? dateEntries(f.value)[0]?.date : f.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const p = (isRange(v) ? v.start : v) as DatePoint | undefined;
  return p && typeof p.year === "number" ? p : null;
}

/** Whole years from `a` to `b`; null if unknown (no year, different eras, `b` before `a`).
 * Eras are only compared by name until calendars exist (M14). */
export function yearsBetween(a: DatePoint, b: DatePoint): { years: number; approx: boolean } | null {
  if (typeof a.year !== "number" || typeof b.year !== "number") return null;
  const era = (p: DatePoint) => (p.era ?? "").trim().toLowerCase();
  if (era(a) && era(b) && era(a) !== era(b)) return null;
  let years = b.year - a.year;
  if (a.month && b.month && (b.month < a.month || (b.month === a.month && a.day && b.day && b.day < a.day))) years--;
  return years < 0 ? null : { years, approx: !!(a.qualifier || b.qualifier) };
}

/**
 * Ages shown after dates: "(age 9)" after the birth date while no death date
 * is filled in (counted to the project's present day), "(aged 69)" after the
 * death date. An age that comes from a birth date hidden as a spoiler is
 * hidden too.
 */
export function agesFor(ib: Infobox, presentDay: unknown): Map<Field, string> {
  const out = new Map<Field, string>();
  const birth = ib.fields.find((f) => ageRole(f) === "birth" && fieldDate(f));
  if (!birth) return out;
  // A death field with anything in it (even a place only) means no age "now".
  const death = ib.fields.find((f) => ageRole(f) === "death" && fieldHasValue(f));
  const show = (y: { years: number; approx: boolean } | null, word: string) =>
    y ? `<span class="infobox-age">(${word} ${y.approx ? "c. " : ""}${y.years})</span>` : "";
  if (death) {
    const end = fieldDate(death);
    const html = end ? show(yearsBetween(fieldDate(birth)!, end), "aged") : "";
    if (html) out.set(death, birth.spoiler && !death.spoiler ? spoilerHtml(html) : html);
  } else if (presentDay && typeof presentDay === "object") {
    const html = show(yearsBetween(fieldDate(birth)!, presentDay as DatePoint), "age");
    if (html) out.set(birth, html);
  }
  return out;
}

/** "c. 250 AC", "283 – 298 AC", "283 AC – present". */
export function formatDate(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  if (!isRange(v)) return pointText(v as DatePoint, true);
  const start = v.start ?? {};
  if (v.end === "present") {
    const s = pointText(start, true);
    return s ? `${s} – present` : "";
  }
  const end = v.end ?? {};
  const sameEra = (start.era ?? "").trim() === (end.era ?? "").trim();
  const s = pointText(start, !sameEra || end.year === undefined);
  const e = pointText(end, true);
  if (s && e) return `${s} – ${e}`;
  return s || (e ? `until ${e}` : "");
}

// ---- infoboxes ----

/** A new page infobox copied from template `t` (as create_page does in Rust). */
export function instantiate(t: Template): Infobox {
  return {
    template: t.id,
    color: t.color ?? null,
    fields: t.fields.map(({ value: _v, ...f }) => ({ ...f })),
  };
}

/**
 * Switches a page's infobox to template `t`: fields with the same label (as
 * a template field) keep their values; the values of every other field
 * become hidden values. The page keeps its own colour if it chose one.
 */
export function changeTemplate(ib: Infobox, t: Template): Infobox {
  const next = instantiate(t);
  const hidden = [...(ib.hidden ?? [])];
  const used = new Set<Field>();
  next.fields = next.fields.map((tf) => {
    if (!hasValue(tf.type)) return tf;
    const old = ib.fields.find((f) => !used.has(f) && hasValue(f.type) && norm(f.label) === norm(tf.label));
    if (!old) return tf;
    used.add(old);
    return { ...tf, value: old.type === tf.type ? old.value : convertValue(old.value, tf.type) };
  });
  for (const f of ib.fields) {
    if (!used.has(f) && fieldHasValue(f)) {
      const { key: _k, ...rest } = f;
      hidden.push(rest);
    }
  }
  return {
    ...ib,
    template: t.id,
    color: ib.ownColor ? ib.color : (t.color ?? null),
    fields: next.fields,
    hidden: hidden.length ? hidden : undefined,
  };
}

/** Black or white text, whichever reads better on `color` ("#rrggbb"). */
export function contrastText(color: string): string {
  return readableOn(color) ?? "#202122";
}

export const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c.trim());

/** Inline style that gives the box its own colour (title bar and section headings). */
export function colorStyle(color: string | null | undefined): string {
  if (!isColor(color)) return "";
  return `--infobox-header-bg:${color};--infobox-header-text:${contrastText(color)}`;
}

/** URL of an image in assets/. With `width` (CSS pixels): a smaller copy
 * about that wide (sharp on high-resolution screens), made once and kept in .cache/. */
export function imageUrl(project: string, file: string, width?: number): string {
  const url = convertFileSrc(`${project}/${file}`, "wikiasset");
  return width ? `${url}?w=${Math.ceil(width * 2)}` : url;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export interface BoxContext {
  project: string;
  title: string;
  links: LinkContext;
  /** What other pages' fields add to this page (Linked from, two-way). */
  relations?: Relations;
  /** Template preview: show every field, with placeholders for missing values. */
  placeholders?: boolean;
  /** Editor preview: show the box (title bar and a note) even without values. */
  showEmpty?: boolean;
  /** The frame every image sits in (filled and cropped). */
  frame?: Frame;
  /** The project's present day, for ages after birth dates. */
  presentDay?: unknown;
}

/** An Image field's value. `crop`: how the picture sits in the frame.
 * `x`, `y`: percent from left / top (50/50 = the middle). `zoom`: 1 = the
 * picture just fills the frame, smaller shows more of it (down to the whole
 * picture), larger shows less; `aspect` is the picture's width / height,
 * stored with the zoom so the page can place it without loading it first. */
export interface ImageValue {
  file?: string;
  caption?: string;
  crop?: Crop;
}

export interface Crop {
  x: number;
  y: number;
  zoom?: number;
  aspect?: number;
}

export const MAX_ZOOM = 4;

const clampPct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50);

/** CSS object-position for an image value's crop (pictures without a zoom). */
export function cropPosition(v: ImageValue | undefined): string {
  return `${clampPct(v?.crop?.x)}% ${clampPct(v?.crop?.y)}%`;
}

/** The smallest zoom: the whole picture fits in the frame. */
export function minZoom(aspect: number, frame: Frame): number {
  const f = frame.width / frame.height;
  return Math.min(aspect / f, f / aspect);
}

/** Where a zoomed picture sits in the frame, in percent of the frame: size and
 * top-left corner. Null for pictures without a zoom (they simply fill it). */
export function placement(crop: Crop | undefined, frame: Frame): { width: number; height: number; left: number; top: number } | null {
  const aspect = crop?.aspect;
  if (!crop || typeof crop.zoom !== "number" || typeof aspect !== "number" || !(aspect > 0)) return null;
  const f = frame.width / frame.height;
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(aspect, frame), crop.zoom));
  const width = Math.max(1, aspect / f) * 100 * zoom;
  const height = Math.max(1, f / aspect) * 100 * zoom;
  return { width, height, left: ((100 - width) * clampPct(crop.x)) / 100 + 0, top: ((100 - height) * clampPct(crop.y)) / 100 + 0 };
}

/** Inline style for the picture in its frame. */
export function pictureStyle(crop: Crop | undefined, frame: Frame): string {
  const p = placement(crop, frame);
  if (!p) return `object-position:${clampPct(crop?.x)}% ${clampPct(crop?.y)}%`;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `position:absolute;max-width:none;max-height:none;width:${r(p.width)}%;height:${r(p.height)}%;left:${r(p.left)}%;top:${r(p.top)}%`;
}

const frameStyle = (f: Frame) => `width:${f.width}px;aspect-ratio:${f.width} / ${f.height}`;

/** A page name as a [[link]], so it renders like links in the text. */
function linkHtml(name: string, ctx: BoxContext): string {
  return renderInline(`[[${name.replace(/[[\]|\n]/g, "").trim()}]]`, ctx.links);
}

/** Entries as links, one per line; entries from spoiler fields stay hidden
 * (unless the whole field is a spoiler: one click shows it all). Names typed
 * into a Linked from field show their notes. */
function entriesHtml(entries: RelationEntry[], f: Field, ctx: BoxContext): string {
  const typed = f.type === "linkedfrom" ? stringList(f.value).map((t) => norm(t.split("#")[0])) : [];
  return entries
    .map((e) => {
      const html = e.spoiler && !f.spoiler ? spoilerHtml(linkHtml(e.name, ctx)) : linkHtml(e.name, ctx);
      const at = e.typed ? typed.indexOf(norm(e.name)) : -1;
      return at < 0 ? html : noted(f, at, html, ctx);
    })
    .join("<br>");
}

/** An entry's HTML with its note (M13). */
function noted(f: Field, i: number, html: string, ctx: BoxContext): string {
  const n = noteAt(f, i);
  return n ? withNoteHtml(html, renderInline(n.text, ctx.links), n.before) : html;
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

/** The value cell's HTML, or "" when there's nothing to show. `age`: shown after the date. */
function valueHtml(f: Field, ctx: BoxContext, age = ""): string {
  const v = f.value;
  if (f.type === "linkedfrom" && !valueProblem(f)) return entriesHtml(reverseEntries(f, ctx.relations, ctx.links.resolve), f, ctx);
  const extra = f.type === "link" || f.type === "links" ? twoWayExtras(f, ctx.relations, ctx.links.resolve) : [];
  if (isEmptyValue(v) && !extra.length) return "";
  if (valueProblem(f) && !extra.length) return escapeHtml(rawValueText(v));
  switch (f.type) {
    case "text":
    case "choice":
      return noted(f, 0, renderInline(String(v), ctx.links), ctx);
    case "longtext":
      return noted(f, 0, renderPage(String(v), { tocBox: false, links: ctx.links }).html, ctx);
    case "number":
      return noted(f, 0, escapeHtml(typeof v === "number" ? v.toLocaleString("en") : String(v)), ctx);
    case "yesno":
      return noted(f, 0, v ? "Yes" : "No", ctx);
    case "list":
      return (v as string[])
        .filter((x) => !isEmptyValue(x))
        .map((x, i) => noted(f, i, renderInline(x, ctx.links), ctx))
        .join("<br>");
    case "link":
    case "links": {
      const own = (typeof v === "string" ? [v] : isStringArray(v) ? v : []).filter((x) => x.trim());
      // Entries with words around the link ("Lord [[Page A]]") show them, the link stays a link.
      const ownHtml = own.map((n, i) => noted(f, i, hasWords(n) ? renderInline(n, ctx.links) : linkHtml(n, ctx), ctx));
      return [ownHtml.join("<br>"), entriesHtml(extra, f, ctx)].filter(Boolean).join("<br>");
    }
    case "date":
      return noted(f, 0, escapeHtml(formatDate(v)) + (age && ` ${age}`), ctx);
    case "dateplace":
    case "datetext":
      return dateEntries(v)
        .map((e, i) => {
          const date = noted(f, i, escapeHtml(formatDate(e.date)) + (age && i === 0 ? ` ${age}` : ""), ctx);
          const text = e.text?.trim() ? renderInline(e.text, ctx.links) : "";
          // The place goes on its own line under the date.
          if (f.type === "dateplace") return [date, text].filter(Boolean).join("<br>");
          return [date, text && `<span class="infobox-date-note">${text}</span>`].filter(Boolean).join(" ");
        })
        .filter(Boolean)
        .join("<br>");
    default:
      return escapeHtml(rawValueText(v));
  }
}

const PLACEHOLDER = '<span class="infobox-placeholder">…</span>';

/**
 * The infobox as HTML (floats right of the text). Empty fields aren't shown,
 * nor sections without values; with nothing to show at all the result is "".
 */
export function infoboxHtml(ib: Infobox | null | undefined, ctx: BoxContext): string {
  if (!ib) return "";
  const rows: { html: string; heading?: boolean; divider?: boolean }[] = [];
  const title = titleArea(ib, ctx);
  const ages = agesFor(ib, ctx.presentDay);
  for (const f of ib.fields) {
    if (titlePlace(f) && !alsoInBox(f)) continue;
    // A Linked from field shown as a list at the bottom of the page (src/pageLists.ts).
    if (f.type === "linkedfrom" && f.options?.show === "list") continue;
    if (f.type === "heading") {
      rows.push({ heading: true, html: `<tr><th colspan="2" class="infobox-heading">${escapeHtml(f.label)}</th></tr>` });
      continue;
    }
    if (f.type === "divider") {
      const label = f.label.trim() ? `<span>${escapeHtml(f.label.trim())}</span>` : "";
      rows.push({ divider: true, html: `<tr><td colspan="2" class="infobox-divider">${label}</td></tr>` });
      continue;
    }
    if (f.type === "image") {
      const img = f.value as ImageValue | undefined;
      const frame = ctx.frame;
      if (img?.file && !valueProblem(f)) {
        const caption = img.caption?.trim()
          ? `<div class="infobox-caption">${renderInline(img.caption, ctx.links)}</div>`
          : "";
        const src = escapeHtml(imageUrl(ctx.project, img.file, frame?.width ?? 280));
        const full = escapeHtml(imageUrl(ctx.project, img.file));
        const alt = escapeHtml(img.caption ?? "");
        const picture = frame
          ? `<span class="infobox-frame" style="${frameStyle(frame)}"><img src="${src}" data-full="${full}" alt="${alt}" style="${pictureStyle(img.crop, frame)}"></span>`
          : `<img src="${src}" data-full="${full}" alt="${alt}">`;
        const inner = f.spoiler ? `<div class="spoiler spoiler-media" title="Spoiler: click to show">${picture}${caption}</div>` : picture + caption;
        rows.push({
          html: `<tr><td colspan="2" class="infobox-image" data-file="${escapeHtml(img.file)}">${inner}</td></tr>`,
        });
      } else if (ctx.placeholders) {
        const style = frame ? ` style="${frameStyle(frame)}"` : "";
        rows.push({
          html: `<tr><td colspan="2" class="infobox-image"><div class="infobox-image-placeholder"${style}>${escapeHtml(f.label || "Image")}</div></td></tr>`,
        });
      }
      continue;
    }
    let value = valueHtml(f, ctx, ages.get(f));
    if (!value && ctx.placeholders) value = PLACEHOLDER;
    if (!value) continue;
    if (f.spoiler && value !== PLACEHOLDER) value = spoilerHtml(value, f.type === "longtext");
    rows.push({
      html: `<tr><th scope="row" class="infobox-label">${escapeHtml(f.label)}</th><td class="infobox-value">${value}</td></tr>`,
    });
  }
  // Drop headings with nothing after them (up to the next heading), and
  // dividers at the top, the bottom, or next to a heading or another divider.
  const withHeadings = rows.filter((r, i) => !r.heading || (rows[i + 1] && !rows[i + 1].heading));
  const shown = ctx.placeholders
    ? withHeadings
    : withHeadings.filter((r, i, all) => {
        if (!r.divider) return true;
        const prev = all[i - 1];
        const next = all[i + 1];
        return !!prev && !!next && !prev.heading && !prev.divider && !next.heading && !next.divider;
      });
  const isValue = (r: (typeof rows)[number]) => !r.heading && !r.divider;
  if (!shown.some(isValue) && !title.extra && !ctx.placeholders) {
    if (!ctx.showEmpty) return "";
    shown.length = 0;
    shown.push({ html: `<tr><td colspan="2" class="infobox-empty">Fill in values in the Infobox tab.</td></tr>` });
  }
  const style = [colorStyle(ib.color), ctx.frame ? `--frame-width:${ctx.frame.width}px` : ""].filter(Boolean).join(";");
  return (
    `<div class="infobox"${style ? ` style="${style}"` : ""}><table><tbody>` +
    `<tr><th colspan="2" class="infobox-title">${title.html}</th></tr>` +
    shown.map((r) => r.html).join("") +
    `</tbody></table></div>`
  );
}

/** The title cell's content: the title, with lines above and below it and
 * pictures beside it from fields placed there. `extra`: any of those shows. */
function titleArea(ib: Infobox, ctx: BoxContext): { html: string; extra: boolean } {
  const lines: Record<"above" | "below", string[]> = { above: [], below: [] };
  const pictures: string[] = [];
  for (const f of ib.fields) {
    const place = titlePlace(f);
    if (!place) continue;
    if (place === "beside") {
      const img = f.value as ImageValue | undefined;
      if (img?.file && !valueProblem(f)) {
        const pic =
          `<img class="infobox-title-picture" src="${escapeHtml(imageUrl(ctx.project, img.file, 60))}" ` +
          `data-full="${escapeHtml(imageUrl(ctx.project, img.file))}" alt="${escapeHtml(img.caption || f.label)}">`;
        pictures.push(f.spoiler ? `<span class="spoiler spoiler-media" title="Spoiler: click to show">${pic}</span>` : pic);
      } else if (ctx.placeholders) {
        pictures.push(`<span class="infobox-title-picture infobox-image-placeholder"></span>`);
      }
      continue;
    }
    let value = valueHtml(f, ctx);
    if (!value && ctx.placeholders) value = PLACEHOLDER;
    if (!value) continue;
    if (f.spoiler && value !== PLACEHOLDER) value = spoilerHtml(value);
    lines[place].push(`<div class="infobox-title-${place}">${value}</div>`);
  }
  const name = escapeHtml(ctx.title);
  if (!lines.above.length && !lines.below.length && !pictures.length) return { html: name, extra: false };
  // One picture shows on both sides (the copy is skipped by the image viewer); two go left and right.
  const [left, right] = pictures.length === 1 ? [pictures[0], pictures[0].replace('class="infobox-title-picture"', 'class="infobox-title-picture infobox-title-copy"')] : pictures;
  const side = (pic: string | undefined) => (pic ? `<span class="infobox-title-side">${pic}</span>` : "");
  return {
    html:
      `<div class="infobox-title-row">${side(left)}<div class="infobox-title-text">` +
      `${lines.above.join("")}<div class="infobox-title-name">${name}</div>${lines.below.join("")}` +
      `</div>${side(right)}</div>`,
    extra: true,
  };
}
