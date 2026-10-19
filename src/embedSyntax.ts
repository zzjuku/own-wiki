// Embed syntax: a line holding only `{{Page}}` (the whole page: infobox and
// text), `{{Page#Section}}` (one section) or `{{Page|infobox}}` (only the
// infobox). `[[ ]]` stays for links. Nobody types this: the Embed button and
// the embed popup write it. The Rust side (src-tauri/src/wikilinks.rs,
// `embed_line`) reads the same lines for the link index and renames.
import { categoryOf } from "./categories";
import { isFileName } from "./wikilinks";

export interface EmbedCall {
  /** Page as typed (trimmed). */
  page: string;
  section: string | null;
  /** Only the infobox. */
  infobox: boolean;
}

/** A whole embed line at the start of the text (m[1]: what's inside the braces). */
export const EMBED_BLOCK = /^ {0,3}\{\{([^{}\n]+)\}\}[ \t]*(?:\n+|$)/;
/** A source line that is an embed. */
export const EMBED_LINE = /^ {0,3}\{\{([^{}\n]+)\}\}[ \t]*$/;

/** The inside of `{{…}}`; null when it isn't an embed. */
export function parseEmbed(inner: string): EmbedCall | null {
  const bar = inner.indexOf("|");
  const target = bar < 0 ? inner : inner.slice(0, bar);
  const option = bar < 0 ? null : inner.slice(bar + 1).trim().toLowerCase();
  if (option !== null && option !== "infobox") return null;
  const hash = target.indexOf("#");
  const page = (hash < 0 ? target : target.slice(0, hash)).trim();
  const section = hash < 0 ? null : target.slice(hash + 1).trim() || null;
  if (!page || isFileName(page) || categoryOf(page) !== null) return null;
  return { page, section, infobox: option === "infobox" };
}

/** The embed on a source line, if it is one. */
export function embedOnLine(line: string): EmbedCall | null {
  const m = EMBED_LINE.exec(line);
  return m ? parseEmbed(m[1]) : null;
}

/** The source of an embed. */
export function embedSource(e: EmbedCall): string {
  const page = e.page.replace(/[{}|#\n]/g, "").trim();
  if (e.infobox) return `{{${page}|infobox}}`;
  return e.section ? `{{${page}#${e.section.replace(/[{}|\n]/g, "").trim()}}}` : `{{${page}}}`;
}

/** Pages a text embeds (as typed), skipping fenced code. */
export function embedTargets(text: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f.index + f[0].length).trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const e = embedOnLine(line);
    if (e) out.push(e.page);
  }
  return out;
}
