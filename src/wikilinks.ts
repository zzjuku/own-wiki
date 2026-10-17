// Page link syntax: [[Page]], [[Page|shown]], [[Page#Section]], [[#Section]].
// The Rust side (src-tauri/src/wikilinks.rs) parses the same syntax; both run
// shared-tests/links.json so they can't disagree.

/** A whole link at the start of a string: `[[inner]]` plus letters joined on. */
export const LINK_AT_START = /^\[\[([^[\]\n]+?)\]\](\p{L}*)/u;

export interface WikiLink {
  /** Page as typed (trimmed). "" for `[[#Section]]`. */
  page: string;
  section: string | null;
  /** Text after `|`, trimmed. "" is the pipe trick. */
  label: string | null;
  /** Letters directly after `]]`. */
  suffix: string;
}

/** Splits the inside of `[[…]]`. Null when it isn't a link (`[[ ]]`, `[[|x]]`). */
export function parseInner(inner: string, suffix = ""): WikiLink | null {
  let pagePart = inner;
  let label: string | null = null;
  const pipe = inner.indexOf("|");
  if (pipe >= 0) {
    pagePart = inner.slice(0, pipe);
    // In tables the separator is written `\|`.
    if (pagePart.endsWith("\\")) pagePart = pagePart.slice(0, -1);
    label = inner.slice(pipe + 1).trim();
  }
  let section: string | null = null;
  const hash = pagePart.indexOf("#");
  if (hash >= 0) {
    section = pagePart.slice(hash + 1).trim() || null;
    pagePart = pagePart.slice(0, hash);
  }
  const page = pagePart.trim();
  if (!page && section === null) return null;
  return { page, section, label, suffix };
}

/** Parses a link at the start of `src`; returns it with its length. */
export function linkAtStart(src: string): { link: WikiLink; length: number } | null {
  const m = LINK_AT_START.exec(src);
  if (!m) return null;
  const link = parseInner(m[1], m[2]);
  return link && { link, length: m[0].length };
}

/** `[[Page A (Example)|]]` shows "Page A". */
export function pipeTrick(page: string): string {
  const t = page.trimEnd();
  const m = /^(.*\S)\s*\(([^()]*)\)$/.exec(t);
  return m ? m[1] : t;
}

/** The text a link shows on the page. */
export function shownText(l: WikiLink): string {
  let base: string;
  if (l.label) base = l.label;
  else if (l.label !== null) base = l.page ? pipeTrick(l.page) : (l.section ?? "");
  else if (l.section !== null) base = l.page ? `${l.page} § ${l.section}` : `§ ${l.section}`;
  else base = l.page;
  return base + l.suffix;
}

/** How titles, aliases and link targets are compared: spaces trimmed and
 * collapsed, upper/lower case ignored. */
export function norm(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Characters titles and aliases can't contain, because links use them. */
export const LINK_CHARS = /[[\]|#]/;
