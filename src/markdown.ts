import DOMPurify from "dompurify";
import { marked, type Token, type TokensList } from "marked";

// One Enter in the source is a line break on the page; an empty line starts
// a new paragraph.
const OPTIONS = { async: false, gfm: true, breaks: true } as const;

/** Markdown -> safe HTML for the page view. */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, OPTIONS));
}

/** Like renderMarkdown, but puts an empty `<div data-line="N">` (N = 0-based
 * source line) before every top-level block, so the preview can scroll along
 * with the editor. */
export function renderWithLineAnchors(source: string): string {
  const tokens = marked.lexer(source, OPTIONS);
  const out = [] as unknown as TokensList;
  out.links = tokens.links;
  let pos = 0;
  let line = 0;
  for (const token of tokens) {
    // Find where the token starts; fall back to the running position if the
    // lexer changed the text (it normalizes tabs and line endings).
    const at = token.raw ? source.indexOf(token.raw, pos) : -1;
    const start = at >= 0 ? at : pos;
    line += countLines(source, pos, start);
    if (token.type !== "space") {
      out.push({ type: "html", block: true, pre: false, raw: "", text: `<div data-line="${line}"></div>` } as Token);
    }
    out.push(token);
    const end = at >= 0 ? at + token.raw.length : start + token.raw.length;
    line += countLines(source, start, end);
    pos = end;
  }
  return DOMPurify.sanitize(marked.parser(out, OPTIONS));
}

function countLines(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = s.indexOf("\n", from); i >= 0 && i < to; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

/** The page's visible text, without Markdown symbols (for the word count). */
export function plainText(source: string): string {
  const parts: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "html" || t.type === "space" || t.type === "hr" || t.type === "def") continue;
      if (t.type === "table") {
        for (const cell of [...t.header, ...t.rows.flat()]) {
          walk(cell.tokens);
          parts.push(" ");
        }
      } else if (t.type === "list") {
        for (const item of t.items) {
          walk(item.tokens);
          parts.push(" ");
        }
      } else if ("tokens" in t && t.tokens?.length) {
        walk(t.tokens);
      } else if ("text" in t && typeof t.text === "string") {
        parts.push(t.text);
      }
      if (t.type === "br" || t.type === "paragraph" || t.type === "heading") parts.push(" ");
    }
  };
  walk(marked.lexer(source, OPTIONS));
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
}
