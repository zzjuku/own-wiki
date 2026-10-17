import DOMPurify from "dompurify";
import { Marked, type Token, type Tokens, type TokensList } from "marked";

// One Enter in the source is a line break on the page; an empty line starts
// a new paragraph.
const OPTIONS = { async: false, gfm: true, breaks: true } as const;

export interface TocEntry {
  id: string;
  /** "1", "1.1", … */
  number: string;
  text: string;
  /** Nesting depth, 0 = top. */
  depth: number;
}

export interface Rendered {
  html: string;
  toc: TocEntry[];
}

/** The table of contents appears once a page has this many headings. */
export const TOC_MIN_HEADINGS = 3;
export const NOTES_HEADING = "Notes";

// ---- per-render state (rendering is synchronous, so one at a time) ----

interface Heading {
  id: string;
  level: number;
  text: string;
}

interface RenderState {
  usedIds: Map<string, number>;
  headings: Heading[];
  /** Footnote labels defined anywhere on the page. */
  defined: Set<string>;
  /** Footnote label -> number, in order of first reference. */
  numbers: Map<string, number>;
  refCount: Map<string, number>;
  notes: Map<string, string>;
}

let state: RenderState = freshState(new Set());

function freshState(defined: Set<string>): RenderState {
  return { usedIds: new Map(), headings: [], defined, numbers: new Map(), refCount: new Map(), notes: new Map() };
}

/** Section anchor: lower-case, spaces -> "-", repeats get "-2", "-3"… These
 * ids are what `[[Page#Section]]` links will point at, so keep them stable. */
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "-") || "section";
}

function uniqueId(base: string): string {
  const n = (state.usedIds.get(base) ?? 0) + 1;
  state.usedIds.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Plain text of inline tokens (no Markdown symbols). */
function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens
    .map((t) => {
      if (t.type === "footnoteRef" || t.type === "html") return "";
      if ("tokens" in t && t.tokens?.length) return inlineText(t.tokens);
      if (t.type === "br") return " ";
      return "text" in t && typeof t.text === "string" ? t.text : "";
    })
    .join("");
}

const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;

const md = new Marked(OPTIONS);
md.use({
  renderer: {
    heading(token: Tokens.Heading) {
      const text = inlineText(token.tokens).trim();
      const id = uniqueId(slugify(text));
      state.headings.push({ id, level: token.depth, text });
      return `<h${token.depth} id="${escapeHtml(id)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
    },
  },
  extensions: [
    {
      // [^label]: note text (following lines indented by 2+ spaces belong to it)
      name: "footnoteDef",
      level: "block",
      start: (src: string) => src.match(/^\[\^[^\]\s]+\]:/m)?.index,
      tokenizer(src: string) {
        const m = FOOTNOTE_DEF.exec(src);
        if (!m) return undefined;
        const text = m[2].replace(/\n[ \t]+/g, "\n").trim();
        return { type: "footnoteDef", raw: m[0], label: m[1], tokens: this.lexer.inlineTokens(text) };
      },
      renderer(token) {
        if (!state.notes.has(token.label)) state.notes.set(token.label, this.parser.parseInline(token.tokens!));
        return "";
      },
    },
    {
      // [^label] in the text
      name: "footnoteRef",
      level: "inline",
      start: (src: string) => {
        const i = src.indexOf("[^");
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = FOOTNOTE_REF.exec(src);
        if (!m || !state.defined.has(m[1])) return undefined;
        return { type: "footnoteRef", raw: m[0], label: m[1] };
      },
      renderer(token) {
        let n = state.numbers.get(token.label);
        if (n === undefined) {
          n = state.numbers.size + 1;
          state.numbers.set(token.label, n);
        }
        const count = (state.refCount.get(token.label) ?? 0) + 1;
        state.refCount.set(token.label, count);
        const id = count === 1 ? `cite-ref-${n}` : `cite-ref-${n}-${count}`;
        return `<sup class="footnote-ref" id="${id}"><a href="#cite-note-${n}">[${n}]</a></sup>`;
      },
    },
  ],
});

const TOC_MARK = "<!--own-wiki-toc-->";

function definedLabels(source: string): Set<string> {
  const set = new Set<string>();
  for (const m of source.matchAll(/^\[\^([^\]\s]+)\]:/gm)) set.add(m[1]);
  return set;
}

/**
 * Markdown -> safe HTML for a page, plus its table of contents.
 * With `lineAnchors`, an empty `<div data-line="N">` (N = 0-based source
 * line) goes before every top-level block, so the editor preview can scroll
 * along with the source.
 */
export function renderPage(source: string, { lineAnchors = false } = {}): Rendered {
  state = freshState(definedLabels(source));
  const tokens = md.lexer(source);
  const out = [] as unknown as TokensList;
  out.links = tokens.links;
  const firstHeading = tokens.findIndex((t) => t.type === "heading");
  let pos = 0;
  let line = 0;
  tokens.forEach((token, i) => {
    if (i === firstHeading) out.push(htmlToken(TOC_MARK));
    if (lineAnchors) {
      // Find where the token starts; fall back to the running position if
      // the lexer changed the text (it normalizes tabs and line endings).
      const at = token.raw ? source.indexOf(token.raw, pos) : -1;
      const start = at >= 0 ? at : pos;
      line += countLines(source, pos, start);
      if (token.type !== "space") out.push(htmlToken(`<div data-line="${line}"></div>`));
      const end = at >= 0 ? at + token.raw.length : start + token.raw.length;
      line += countLines(source, start, end);
      pos = end;
    }
    out.push(token);
  });
  let html = md.parser(out);

  // Notes: referenced ones in order of first reference, then any others.
  if (state.notes.size) {
    for (const label of state.notes.keys()) {
      if (!state.numbers.has(label)) state.numbers.set(label, state.numbers.size + 1);
    }
    const id = uniqueId(slugify(NOTES_HEADING));
    state.headings.push({ id, level: 2, text: NOTES_HEADING });
    const items = [...state.numbers]
      .filter(([label]) => state.notes.has(label))
      .sort((a, b) => a[1] - b[1])
      .map(([label, n]) => {
        const back = state.refCount.has(label)
          ? `<a class="footnote-back" href="#cite-ref-${n}" aria-label="Back to the text">↑</a> `
          : "";
        return `<li id="cite-note-${n}" value="${n}">${back}${state.notes.get(label)}</li>`;
      });
    html += `<h2 id="${escapeHtml(id)}">${NOTES_HEADING}</h2>\n<ol class="footnotes">${items.join("")}</ol>\n`;
  }

  const toc = state.headings.length >= TOC_MIN_HEADINGS ? buildToc(state.headings) : [];
  html = html.replace(TOC_MARK, toc.length ? tocBox(toc) : "");
  // SANITIZE_DOM would drop heading ids such as "title" or "links".
  return { html: DOMPurify.sanitize(html, { SANITIZE_DOM: false }), toc };
}

/** Markdown -> safe HTML. */
export function renderMarkdown(source: string): string {
  return renderPage(source).html;
}

function htmlToken(text: string): Token {
  return { type: "html", block: true, pre: false, raw: "", text } as Token;
}

function countLines(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = s.indexOf("\n", from); i >= 0 && i < to; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

/** Numbers headings 1, 1.1, 1.1.1… by level; skipped levels nest one step. */
export function buildToc(headings: Heading[]): TocEntry[] {
  const stack: { level: number; n: number }[] = [];
  return headings.map((h) => {
    while (stack.length && stack[stack.length - 1].level > h.level) stack.pop();
    const top = stack[stack.length - 1];
    if (top && top.level === h.level) top.n++;
    else stack.push({ level: h.level, n: 1 });
    return { id: h.id, text: h.text, number: stack.map((s) => s.n).join("."), depth: stack.length - 1 };
  });
}

function tocBox(toc: TocEntry[]): string {
  const items = toc
    .map(
      (e) =>
        `<li class="toc-depth-${Math.min(e.depth, 5)}"><a href="#${encodeURIComponent(e.id)}">` +
        `<span class="toc-number">${e.number}</span> ${escapeHtml(e.text)}</a></li>`,
    )
    .join("");
  return `<details class="toc" open><summary>Contents</summary><ol>${items}</ol></details>\n`;
}

/** The page's visible text, without Markdown symbols (for the word count). */
export function plainText(source: string): string {
  const parts: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "html" || t.type === "space" || t.type === "hr" || t.type === "def" || t.type === "footnoteRef")
        continue;
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
      if (t.type === "br" || t.type === "paragraph" || t.type === "heading" || t.type === "footnoteDef") parts.push(" ");
    }
  };
  state = freshState(definedLabels(source));
  walk(md.lexer(source));
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
}
