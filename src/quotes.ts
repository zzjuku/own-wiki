// Quote boxes (AWOIAF style): the quote centred between large quotation
// marks, "— By, Source" underneath. Stored as a block in the page text:
//
//   <quote>
//   The quote (bold, italic, [[links]], ||spoilers||; blank lines = paragraphs)
//   <by>[[Page A]]</by>
//   <source>Example source</source>
//   </quote>
//
// Nobody types this: the Quote button's dialog writes it, and clicking a quote
// box in the source reopens the dialog. `<by>` and `<source>` are optional.
// The Rust side (src-tauri/src/wikilinks.rs) leaves quote boxes out of hover
// previews; links in them count like any other.

export interface Quote {
  /** Markdown, may have several lines. */
  text: string;
  /** One line of Markdown: a name or a [[link]]. */
  by: string;
  source: string;
}

/** A whole quote box at the start of the text. */
export const QUOTE_BLOCK = /^ {0,3}<quote>[ \t]*(?:\n([\s\S]*?))?\n {0,3}<\/quote>[ \t]*(?:\n+|$)/i;
export const QUOTE_OPEN = /^ {0,3}<quote>[ \t]*$/i;
export const QUOTE_CLOSE = /^ {0,3}<\/quote>[ \t]*$/i;
const CREDIT = /^[ \t]*<(by|source)>(.*)<\/\1>[ \t]*$/i;

/** A quote box's parts, from its whole source (tags included) or the lines between its tags. */
export function parseQuote(source: string | string[]): Quote {
  const lines = typeof source === "string" ? source.replace(/\n+$/, "").split("\n") : source;
  const inner = typeof source === "string" ? lines.slice(1, -1) : lines;
  const q: Quote = { text: "", by: "", source: "" };
  const text: string[] = [];
  for (const line of inner) {
    const m = CREDIT.exec(line);
    if (m) q[m[1].toLowerCase() as "by" | "source"] = m[2].trim();
    else text.push(line);
  }
  q.text = text.join("\n").trim();
  return q;
}

const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, " ").trim();

/** The source of a quote box. */
export function quoteSource(q: Quote): string {
  // A text line that looks like the box's own tags would end it early.
  const text = q.text
    .trim()
    .split("\n")
    .map((l) => (QUOTE_CLOSE.test(l) || QUOTE_OPEN.test(l) || CREDIT.test(l) ? l.replace("<", "&lt;") : l));
  const lines = ["<quote>", ...text];
  if (oneLine(q.by)) lines.push(`<by>${oneLine(q.by)}</by>`);
  if (oneLine(q.source)) lines.push(`<source>${oneLine(q.source)}</source>`);
  lines.push("</quote>");
  return lines.join("\n");
}

/** The block (between `open` and `close` lines) whose lines include line `n`
 * (0-based) of `lines`: its first and last line. */
export function blockAround(lines: string[], n: number, open: RegExp, close: RegExp): { start: number; end: number } | null {
  let start = -1;
  for (let i = n; i >= 0; i--) {
    if (close.test(lines[i]) && i !== n) return null;
    if (open.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (open.test(lines[i])) return null;
    if (close.test(lines[i])) return i >= n ? { start, end: i } : null;
  }
  return null;
}

export const quoteAround = (lines: string[], n: number) => blockAround(lines, n, QUOTE_OPEN, QUOTE_CLOSE);
