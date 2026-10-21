// Automatic page lists (M9): the pages whose fields point to a page, as a
// list. Two kinds:
//   - a Linked from field set to "Show: as a list at the bottom of the page"
//     (a heading, which is in Contents, and the list after the page text);
//   - a line in the page text, placed anywhere, written by the Page list dialog:
//       <pagelist from="Location, Setting" templates="Template A" sort="Chapter no.">
//     `from`: the fields that point here (names, comma-separated); `templates`:
//     only pages from these templates (names); `sort`: a number or date field
//     (none: by title). A list in an embedded page lists what points to that page.
// An empty list shows nothing. Entries from spoiler fields stay hidden.
import type { Field, Infobox, Relations, Template } from "./api";
import { spoilerHtml, wikiLinkHtml, type LinkContext } from "./markdown";
import { reverseEntries, type RelationEntry } from "./relations";
import { norm } from "./wikilinks";

export interface PageListCall {
  /** Field names that point here. */
  from: string[];
  /** Template names (only pages from these); none = any page. */
  templates: string[];
  sortBy?: string;
  /** Internal: the list of the infobox's field number `field` (bottom-of-page lists). */
  field?: number;
}

export const PAGELIST_LINE = /^ {0,3}<pagelist\b([^>\n]*)>[ \t]*$/i;
/** A page list line at the start of `src` (with its line break). */
export const PAGELIST_BLOCK = /^ {0,3}<pagelist\b([^>\n]*)>[ \t]*(?:\n+|$)/i;

const unquote = (s: string) => s.replace(/&quot;/g, '"');
const quote = (s: string) => s.replace(/"/g, "&quot;").replace(/[<>\n]/g, "");
const list = (s: string | undefined) => (s ?? "").split(",").map((x) => unquote(x).trim()).filter(Boolean);

/** The call in a `<pagelist …>` line's attributes. */
export function parsePageListAttrs(attrs: string): PageListCall {
  const a: Record<string, string> = {};
  for (const m of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) a[m[1].toLowerCase()] = m[2];
  const field = a.field !== undefined && /^\d+$/.test(a.field) ? Number(a.field) : undefined;
  return { from: list(a.from), templates: list(a.templates), sortBy: a.sort ? unquote(a.sort).trim() || undefined : undefined, field };
}

/** The page list on line `line`, if it is one. */
export function pageListOnLine(line: string): PageListCall | null {
  const m = PAGELIST_LINE.exec(line);
  return m ? parsePageListAttrs(m[1]) : null;
}

/** The `<pagelist …>` line for a call. */
export function pageListSource(c: PageListCall): string {
  const parts = [`from="${c.from.map(quote).join(", ")}"`];
  if (c.templates.length) parts.push(`templates="${c.templates.map(quote).join(", ")}"`);
  if (c.sortBy?.trim()) parts.push(`sort="${quote(c.sortBy.trim())}"`);
  return `<pagelist ${parts.join(" ")}>`;
}

/** What page lists need from the page they're on. */
export interface ListEnv {
  infobox: Infobox | null;
  relations?: Relations;
  templates: Template[];
  /** Editor preview: an empty list says so instead of showing nothing. */
  preview?: boolean;
  /** A category page's text (no page points to a category through fields). */
  category?: boolean;
}

const isBottomList = (f: Field) => f.type === "linkedfrom" && f.options?.show === "list";

/** The entries of a page list. */
function entries(c: PageListCall, env: ListEnv, links: LinkContext): RelationEntry[] {
  if (c.field !== undefined) {
    const f = env.infobox?.fields[c.field];
    return f?.type === "linkedfrom" ? reverseEntries(f, env.relations, links.resolve) : [];
  }
  const ids = c.templates.map((n) => env.templates.find((t) => norm(t.name) === norm(n))?.id ?? `missing:${n}`);
  const field: Field = { label: "", type: "linkedfrom", options: { from: c.from, templates: ids, sortBy: c.sortBy } };
  return reverseEntries(field, env.relations, links.resolve);
}

/** A page list as HTML; "" when empty (the preview says it's empty). */
export function pageListHtml(c: PageListCall, env: ListEnv | null, links: LinkContext): string {
  const list = env && !env.category ? entries(c, env, links) : [];
  if (!list.length) {
    if (!env?.preview) return "";
    const why = env.category ? "Page lists work on pages, not category pages." : "Page list: no page points here yet.";
    return `<p class="pagelist-empty">${why}</p>`;
  }
  const items = list.map((e) => {
    const link = wikiLinkHtml(e.name, links);
    return `<li>${e.spoiler ? spoilerHtml(link) : link}</li>`;
  });
  return `<ul class="page-list">${items.join("")}</ul>`;
}

/** Markdown added after the page text for Linked from fields shown as lists
 * at the bottom: a heading (so it's in Contents) and the list. Lists without
 * entries are left out, heading included. */
export function bottomListsSource(env: ListEnv | null, links: LinkContext): string {
  const ib = env?.infobox;
  if (!ib) return "";
  let out = "";
  ib.fields.forEach((f, i) => {
    if (!isBottomList(f) || !entries({ from: [], templates: [], field: i }, env, links).length) return;
    const heading = (typeof f.options?.listHeading === "string" && f.options.listHeading.trim()) || f.label.trim() || "Pages";
    out += `\n\n## ${heading.replace(/\n/g, " ")}\n\n<pagelist field="${i}">\n`;
  });
  return out;
}
