// Templates and infoboxes in the page view: field types, values, and the
// AWOIAF-style box (HTML) for the read view and the editor preview.
// The file format is described in src-tauri/src/infobox.rs.
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Field, FieldKind, IncomingField, Infobox, Template } from "./api";
import { renderInline, renderPage, slugify, type LinkContext } from "./markdown";
import { norm } from "./wikilinks";

export interface KindInfo {
  kind: FieldKind;
  label: string;
  /** Has a value (headings and Linked from don't). */
  hasValue: boolean;
}

export const KINDS: KindInfo[] = [
  { kind: "text", label: "Text", hasValue: true },
  { kind: "longtext", label: "Long text", hasValue: true },
  { kind: "number", label: "Number", hasValue: true },
  { kind: "yesno", label: "Yes/No", hasValue: true },
  { kind: "choice", label: "Choice", hasValue: true },
  { kind: "list", label: "List", hasValue: true },
  { kind: "link", label: "Page link", hasValue: true },
  { kind: "links", label: "Page links", hasValue: true },
  { kind: "linkedfrom", label: "Linked from", hasValue: false },
  { kind: "date", label: "Date", hasValue: true },
  { kind: "image", label: "Image", hasValue: true },
  { kind: "heading", label: "Section heading", hasValue: false },
];

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
      return isStringArray(v) ? null : "This value doesn't fit a " + kindLabel(f.type) + " field.";
    case "date":
      return typeof v === "object" && !Array.isArray(v) ? null : "This isn't a date.";
    case "image":
      return typeof v === "object" && !Array.isArray(v) && typeof (v as { file?: unknown }).file === "string"
        ? null
        : "This isn't an image.";
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
    if (f.type === "image") return (v as { file?: string })?.file ?? "";
  }
  return rawValueText(v);
}

const STRING_KINDS = ["text", "longtext", "choice", "link"];
const LIST_KINDS = ["list", "links"];

/** A value moved to another field type, converted where nothing is lost
 * (same rules as convert_value in src-tauri/src/infobox.rs). */
export function convertValue(v: unknown, to: string): unknown {
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
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return "#202122";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#202122" : "#ffffff";
}

export const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c.trim());

/** Inline style that gives the box its own colour (title bar and section headings). */
export function colorStyle(color: string | null | undefined): string {
  if (!isColor(color)) return "";
  return `--infobox-header-bg:${color};--infobox-header-text:${contrastText(color)}`;
}

export function imageUrl(project: string, file: string): string {
  return convertFileSrc(`${project}/${file}`, "wikiasset");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export interface BoxContext {
  project: string;
  title: string;
  links: LinkContext;
  /** Links from other pages' fields to this page (Linked from, two-way). */
  incoming?: IncomingField[];
  /** Template preview: show every field, with placeholders for missing values. */
  placeholders?: boolean;
  /** Editor preview: show the box (title bar and a note) even without values. */
  showEmpty?: boolean;
}

/** A page name as a [[link]], so it renders like links in the text. */
function linkHtml(name: string, ctx: BoxContext): string {
  return renderInline(`[[${name.replace(/[[\]|\n]/g, "").trim()}]]`, ctx.links);
}

/** Entries other pages add to this field: Linked from, and two-way link fields. */
export function incomingFor(f: Field, incoming: IncomingField[] | undefined): IncomingField[] {
  if (!incoming?.length) return [];
  if (f.type === "linkedfrom") {
    const from = (f.options?.from ?? []).map(norm);
    return incoming.filter((i) => from.includes(norm(i.field)));
  }
  if ((f.type === "link" || f.type === "links") && f.options?.twoWay) {
    return incoming.filter((i) => i.twoWay && norm(i.field) === norm(f.label));
  }
  return [];
}

/** The value cell's HTML, or "" when there's nothing to show. */
function valueHtml(f: Field, ctx: BoxContext): string {
  const v = f.value;
  const extra = incomingFor(f, ctx.incoming);
  if (f.type === "linkedfrom") return extra.map((i) => linkHtml(i.title, ctx)).join("<br>");
  if (isEmptyValue(v) && !extra.length) return "";
  if (valueProblem(f) && !extra.length) return escapeHtml(rawValueText(v));
  switch (f.type) {
    case "text":
    case "choice":
      return renderInline(String(v), ctx.links);
    case "longtext":
      return renderPage(String(v), { tocBox: false, links: ctx.links }).html;
    case "number":
      return escapeHtml(typeof v === "number" ? v.toLocaleString("en") : String(v));
    case "yesno":
      return v ? "Yes" : "No";
    case "list":
      return (v as string[]).filter((x) => !isEmptyValue(x)).map((x) => renderInline(x, ctx.links)).join("<br>");
    case "link":
    case "links": {
      const own = (typeof v === "string" ? [v] : isStringArray(v) ? v : []).filter((x) => x.trim());
      const names = [...own];
      for (const i of extra) {
        const target = ctx.links.resolve(i.title);
        if (!own.some((o) => ctx.links.resolve(o)?.page.id === target?.page.id)) names.push(i.title);
      }
      return names.map((n) => linkHtml(n, ctx)).join("<br>");
    }
    case "date":
      return escapeHtml(formatDate(v));
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
  const rows: { html: string; heading?: boolean }[] = [];
  for (const f of ib.fields) {
    if (f.type === "heading") {
      rows.push({ heading: true, html: `<tr><th colspan="2" class="infobox-heading">${escapeHtml(f.label)}</th></tr>` });
      continue;
    }
    if (f.type === "image") {
      const img = f.value as { file?: string; caption?: string } | undefined;
      if (img?.file && !valueProblem(f)) {
        const caption = img.caption?.trim()
          ? `<div class="infobox-caption">${renderInline(img.caption, ctx.links)}</div>`
          : "";
        rows.push({
          html:
            `<tr><td colspan="2" class="infobox-image"><img src="${escapeHtml(imageUrl(ctx.project, img.file))}" alt="${escapeHtml(img.caption ?? "")}">` +
            `${caption}</td></tr>`,
        });
      } else if (ctx.placeholders) {
        rows.push({ html: `<tr><td colspan="2" class="infobox-image"><div class="infobox-image-placeholder">${escapeHtml(f.label || "Image")}</div></td></tr>` });
      }
      continue;
    }
    let value = valueHtml(f, ctx);
    if (!value && ctx.placeholders) value = PLACEHOLDER;
    if (!value) continue;
    rows.push({
      html: `<tr><th scope="row" class="infobox-label">${escapeHtml(f.label)}</th><td class="infobox-value">${value}</td></tr>`,
    });
  }
  // Drop headings with nothing after them (up to the next heading).
  const shown = rows.filter((r, i) => !r.heading || (rows[i + 1] && !rows[i + 1].heading));
  if (!shown.some((r) => !r.heading) && !ctx.placeholders) {
    if (!ctx.showEmpty) return "";
    shown.length = 0;
    shown.push({ html: `<tr><td colspan="2" class="infobox-empty">Fill in values in the Infobox tab.</td></tr>` });
  }
  const style = colorStyle(ib.color);
  return (
    `<div class="infobox"${style ? ` style="${style}"` : ""}><table><tbody>` +
    `<tr><th colspan="2" class="infobox-title">${escapeHtml(ctx.title)}</th></tr>` +
    shown.map((r) => r.html).join("") +
    `</tbody></table></div>`
  );
}
