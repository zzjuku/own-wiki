import DOMPurify from "dompurify";
import { Marked, type Token, type Tokens, type TokensList } from "marked";
import type { LinkTarget } from "./names";
import { categoryOf } from "./categories";
import { FULL_PX, GALLERY, GALLERY_PX, imageAtStart, parseGallery, parseImage, SIZE_PX, type TextImage } from "./images";
import { EMBED_BLOCK, parseEmbed, type EmbedCall } from "./embedSyntax";
import { parseQuote, QUOTE_BLOCK } from "./quotes";
import { PAGELIST_BLOCK, parsePageListAttrs, type PageListCall } from "./pageLists";
import { FAMILYTREE_BLOCK, parseTreeAttrs, type TreeLineCall } from "./family/treeLine";
import { SPOILER_AT_START } from "./spoilers";
import { linkAtStart, shownText, type WikiLink } from "./wikilinks";

// One Enter in the source is a line break on the page; an empty line starts
// a new paragraph.
const OPTIONS = { async: false, gfm: true, breaks: true } as const;

/** A piece of heading text; `spoiler` pieces stay hidden until clicked. */
export interface TextPart {
  text: string;
  spoiler: boolean;
}

export interface TocEntry {
  id: string;
  /** "1", "1.1", … */
  number: string;
  text: string;
  parts: TextPart[];
  /** Nesting depth, 0 = top. */
  depth: number;
}

export interface Rendered {
  html: string;
  toc: TocEntry[];
  /** Embeds in the text, in order: `<div class="embed-slot" data-slot="N">`
   * marks where embed N goes (filled in by src/embeds.ts). */
  embeds: EmbedCall[];
  /** Page lists, in order: `<div class="pagelist-slot" data-slot="N">` marks
   * where list N goes (filled in by src/embeds.ts with src/pageLists.ts). */
  pageLists: PageListCall[];
}

/** Markdown of a single paragraph or line (hover cards, "What links here"). */
export function renderSnippet(source: string, links: LinkContext | null = null): string {
  // Footnote markers mean nothing without their notes.
  return renderPage(source.replace(/\[\^[^\]\s]+\]/g, ""), { tocBox: false, links }).html;
}

/** The table of contents appears once a page has this many headings. */
export const TOC_MIN_HEADINGS = 3;
export const NOTES_HEADING = "Notes";

/** How page links are resolved while rendering. */
export interface LinkContext {
  resolve: (name: string) => LinkTarget | null;
  /** The page being rendered: links to it show as bold text. */
  currentId?: string;
  /** URL of an image in assets/; with `width` (CSS pixels) a copy about that wide. */
  image?: (file: string, width?: number) => string;
  /** Does this category exist? (`[[Category:Name]]` links.) Absent: none do. */
  category?: (name: string) => boolean;
  /** The category page being rendered: links to it show as bold text. */
  currentCategory?: string;
}

/** Lets image URLs of the app's own `wikiasset:` scheme through, and lazy loading. */
const PURIFY = {
  SANITIZE_DOM: false,
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|wikiasset):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  ADD_ATTR: ["loading", "decoding"],
};

// ---- per-render state (rendering is synchronous, so one at a time) ----

interface Heading {
  id: string;
  level: number;
  text: string;
  parts: TextPart[];
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
  links: LinkContext | null;
  /** The heading being rendered: its spoilers share keys with its Contents entry. */
  heading: { id: string; n: number } | null;
  embeds: EmbedCall[];
  pageLists: PageListCall[];
}

let state: RenderState = freshState(new Set());

function freshState(defined: Set<string>, links: LinkContext | null = null): RenderState {
  return { usedIds: new Map(), headings: [], defined, numbers: new Map(), refCount: new Map(), notes: new Map(), links, heading: null, embeds: [], pageLists: [] };
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

/** Heading text in pieces, spoilers apart (for the Contents). */
function inlineParts(tokens: Token[] | undefined, spoiler = false, out: TextPart[] = []): TextPart[] {
  for (const t of tokens ?? []) {
    if (t.type === "spoiler") inlineParts(t.tokens, true, out);
    else if (t.type === "footnoteRef" || t.type === "html") continue;
    else if ("tokens" in t && t.tokens?.length) inlineParts(t.tokens, spoiler, out);
    else {
      const text = t.type === "br" ? " " : "text" in t && typeof t.text === "string" ? t.text : "";
      const last = out[out.length - 1];
      if (last && last.spoiler === spoiler) last.text += text;
      else if (text) out.push({ text, spoiler });
    }
  }
  return out;
}

/** Trims the pieces like the heading text is trimmed. */
function trimParts(parts: TextPart[]): TextPart[] {
  const out = parts.map((p) => ({ ...p }));
  if (out.length) out[0].text = out[0].text.trimStart();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  return out.filter((p) => p.text);
}

/** A spoiler as HTML (`block`: around block content such as a long text). */
export function spoilerHtml(inner: string, block = false, key?: string): string {
  const tag = block ? "div" : "span";
  return `<${tag} class="spoiler${block ? " spoiler-block" : ""}"${key ? ` data-sp="${escapeHtml(key)}"` : ""} title="Spoiler: click to show">${inner}</${tag}>`;
}

/**
 * A page link as HTML. Every link carries `data-target` (page as typed) and
 * `data-section`; links to existing pages also `data-page` (the page id) and
 * `data-via` (the alias used); links to missing pages have the class `new`.
 */
function renderWikiLink(link: WikiLink, text: string): string {
  const ctx = state.links;
  const attrs = [`data-target="${escapeHtml(link.page)}"`];
  if (link.section !== null) attrs.push(`data-section="${escapeHtml(link.section)}"`);
  const label = escapeHtml(text);
  const cat = categoryOf(link.page);
  if (cat !== null) {
    // [[Category:Name]]: a link to the category page.
    if (ctx?.currentCategory && cat.toLowerCase() === ctx.currentCategory.toLowerCase()) return `<strong class="selflink">${label}</strong>`;
    const missing = !ctx?.category?.(cat);
    return `<a class="wikilink catlink${missing ? " new" : ""}" href="#" data-category="${escapeHtml(cat)}" ${attrs.join(" ")}>${label}</a>`;
  }
  if (!link.page) {
    // [[#Section]]: a section of this page.
    if (ctx?.currentId) attrs.push(`data-page="${escapeHtml(ctx.currentId)}"`);
    return `<a class="wikilink" href="#${escapeHtml(slugify(link.section ?? ""))}" ${attrs.join(" ")}>${label}</a>`;
  }
  const target = ctx?.resolve(link.page);
  if (!target) return `<a class="wikilink new" href="#" ${attrs.join(" ")}>${label}</a>`;
  if (target.page.id === ctx?.currentId && link.section === null) return `<strong class="selflink">${label}</strong>`;
  attrs.push(`data-page="${escapeHtml(target.page.id)}"`);
  if (target.via) attrs.push(`data-via="${escapeHtml(target.via)}"`);
  return `<a class="wikilink" href="#" ${attrs.join(" ")}>${label}</a>`;
}

function imageSrc(file: string, width?: number): string {
  return state.links?.image ? state.links.image(file, width) : file;
}

/** An image in the text: a frame with the picture and its caption. */
function renderImage(img: TextImage, captionHtml: string, captionText: string): string {
  const width = img.pos === "full" ? FULL_PX : SIZE_PX[img.size];
  const cls = `wiki-image pos-${img.pos}${img.pos === "full" ? "" : ` size-${img.size}`}${img.spoiler ? " spoiler spoiler-media" : ""}`;
  const alt = escapeHtml(captionText || img.file);
  return (
    IMG_START +
    `<span class="${cls}" data-file="${escapeHtml(img.file)}">` +
    `<img src="${escapeHtml(imageSrc(img.file, width))}" data-full="${escapeHtml(imageSrc(img.file))}" alt="${alt}" loading="lazy" decoding="async">` +
    (captionHtml ? `<span class="wiki-caption">${captionHtml}</span>` : "") +
    `</span>` +
    IMG_END
  );
}

const IMG_START = "<!--img-->";
const IMG_END = "<!--/img-->";

/** An image on a line of its own floats beside the text that follows: the
 * line break after it would only leave an empty line. */
function dropBreaksAfterImages(html: string): string {
  return html
    .replace(/(?<=<p>|<br>\n?)<!--img-->([\s\S]*?)<!--\/img--><br>\n?/g, "$1")
    .replace(/<!--\/?img-->/g, "");
}

const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;

const md = new Marked(OPTIONS);
md.use({
  renderer: {
    heading(token: Tokens.Heading) {
      const text = inlineText(token.tokens).trim();
      const id = uniqueId(slugify(text));
      state.headings.push({ id, level: token.depth, text, parts: trimParts(inlineParts(token.tokens)) });
      state.heading = { id, n: 0 };
      const inner = this.parser.parseInline(token.tokens);
      state.heading = null;
      return `<h${token.depth} id="${escapeHtml(id)}">${inner}</h${token.depth}>\n`;
    },
  },
  extensions: [
    {
      // [[File:Name.png|right|medium|Caption]] (before page links: it starts the same way)
      name: "wikiImage",
      level: "inline",
      start: (src: string) => {
        const m = /\[\[file:/i.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        const m = imageAtStart(src);
        if (!m) return undefined;
        const image = parseImage(m.inner);
        return { type: "wikiImage", raw: src.slice(0, m.length), image, tokens: this.lexer.inlineTokens(image.caption) };
      },
      renderer(token) {
        return renderImage(token.image as TextImage, this.parser.parseInline(token.tokens!), inlineText(token.tokens));
      },
    },
    {
      // <gallery> … File|Caption lines … </gallery>
      name: "gallery",
      level: "block",
      start: (src: string) => src.match(/^ {0,3}<gallery[\s>]/im)?.index,
      tokenizer(src: string) {
        const m = GALLERY.exec(src);
        if (!m) return undefined;
        const items = parseGallery((m[2] ?? "").split("\n")).map((i) => ({ ...i, tokens: this.lexer.inlineTokens(i.caption) }));
        return { type: "gallery", raw: m[0], items, spoiler: !!m[1] };
      },
      renderer(token) {
        const items = (token.items as { file: string; caption: string; tokens: Token[] }[]).map((i) => {
          const caption = this.parser.parseInline(i.tokens);
          const alt = escapeHtml(inlineText(i.tokens) || i.file);
          return (
            `<figure class="gallery-item" data-file="${escapeHtml(i.file)}"><span class="gallery-frame">` +
            `<img src="${escapeHtml(imageSrc(i.file, GALLERY_PX))}" data-full="${escapeHtml(imageSrc(i.file))}" alt="${alt}" loading="lazy" decoding="async">` +
            `</span>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`
          );
        });
        return `<div class="wiki-gallery${token.spoiler ? " spoiler spoiler-media" : ""}">${items.join("")}</div>\n`;
      },
    },
    {
      // <quote by="…" source="…"> quote text </quote>
      name: "quoteBox",
      level: "block",
      start: (src: string) => src.match(/^ {0,3}<quote[\s>]/im)?.index,
      tokenizer(src: string) {
        const m = QUOTE_BLOCK.exec(src);
        if (!m) return undefined;
        const q = parseQuote(m[0]);
        const paras = q.text.split(/\n[ \t]*\n/).map((p) => this.lexer.inlineTokens(p.trim())).filter((p) => p.length);
        return { type: "quoteBox", raw: m[0], paras, by: this.lexer.inlineTokens(q.by), source: this.lexer.inlineTokens(q.source) };
      },
      renderer(token) {
        const paras = (token.paras as Token[][]).map((p) => `<p>${this.parser.parseInline(p)}</p>`).join("");
        const by = this.parser.parseInline(token.by as Token[]);
        const source = this.parser.parseInline(token.source as Token[]);
        const credit = [by, source && `<cite>${source}</cite>`].filter(Boolean).join(", ");
        return (
          `<figure class="quote-box"><blockquote class="quote-text">${paras}</blockquote>` +
          (credit ? `<figcaption class="quote-by">— ${credit}</figcaption>` : "") +
          `</figure>\n`
        );
      },
    },
    {
      // {{Page}}, {{Page#Section}}, {{Page|infobox}} on a line of their own
      name: "embed",
      level: "block",
      start: (src: string) => src.match(/^ {0,3}\{\{/m)?.index,
      tokenizer(src: string) {
        const m = EMBED_BLOCK.exec(src);
        const call = m && parseEmbed(m[1]);
        if (!call) return undefined;
        return { type: "embed", raw: m![0], call };
      },
      renderer(token) {
        state.embeds.push(token.call as EmbedCall);
        return `<div class="embed-slot" data-slot="${state.embeds.length - 1}"></div>\n`;
      },
    },
    {
      // <pagelist from="…" templates="…" sort="…"> on a line of its own
      name: "pageList",
      level: "block",
      start: (src: string) => src.match(/^ {0,3}<pagelist\b/im)?.index,
      tokenizer(src: string) {
        const m = PAGELIST_BLOCK.exec(src);
        if (!m) return undefined;
        return { type: "pageList", raw: m[0], call: parsePageListAttrs(m[1]) };
      },
      renderer(token) {
        state.pageLists.push(token.call as PageListCall);
        return `<div class="pagelist-slot" data-slot="${state.pageLists.length - 1}"></div>\n`;
      },
    },
    {
      // <familytree root="…" up="1" down="3"> on a line of its own (drawn by src/family/PageTrees.tsx)
      name: "familyTree",
      level: "block",
      start: (src: string) => src.match(/^ {0,3}<familytree\b/im)?.index,
      tokenizer(src: string) {
        const m = FAMILYTREE_BLOCK.exec(src);
        if (!m) return undefined;
        return { type: "familyTree", raw: m[0], call: parseTreeAttrs(m[1]) };
      },
      renderer(token) {
        const c = token.call as TreeLineCall;
        return `<div class="familytree-slot" data-root="${escapeHtml(c.root)}" data-up="${c.up}" data-down="${c.down}"></div>\n`;
      },
    },
    {
      // ||hidden text||
      name: "spoiler",
      level: "inline",
      start: (src: string) => {
        const i = src.indexOf("||");
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = SPOILER_AT_START.exec(src);
        if (!m) return undefined;
        return { type: "spoiler", raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(token) {
        const key = state.heading ? `h:${state.heading.id}:${state.heading.n++}` : undefined;
        return spoilerHtml(this.parser.parseInline(token.tokens!), false, key);
      },
    },
    {
      // [[Page]], [[Page|shown]], [[Page#Section]], [[#Section]]
      name: "wikiLink",
      level: "inline",
      start: (src: string) => {
        const i = src.indexOf("[[");
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = linkAtStart(src);
        if (!m) return undefined;
        return { type: "wikiLink", raw: src.slice(0, m.length), text: shownText(m.link), link: m.link };
      },
      renderer(token) {
        return renderWikiLink(token.link as WikiLink, token.text as string);
      },
    },
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
 * along with the source. `tocBox: false` leaves the contents box out of the
 * text (the read view shows the contents in a side panel instead).
 */
export function renderPage(
  source: string,
  {
    lineAnchors = false,
    tocBox: withBox = true,
    links = null,
  }: { lineAnchors?: boolean; tocBox?: boolean; links?: LinkContext | null } = {},
): Rendered {
  state = freshState(definedLabels(source), links);
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
  let html = dropBreaksAfterImages(md.parser(out));

  // Notes: referenced ones in order of first reference, then any others.
  if (state.notes.size) {
    for (const label of state.notes.keys()) {
      if (!state.numbers.has(label)) state.numbers.set(label, state.numbers.size + 1);
    }
    const id = uniqueId(slugify(NOTES_HEADING));
    state.headings.push({ id, level: 2, text: NOTES_HEADING, parts: [{ text: NOTES_HEADING, spoiler: false }] });
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
  html = html.replace(TOC_MARK, withBox && toc.length ? tocBox(toc) : "");
  // SANITIZE_DOM would drop heading ids such as "title" or "links".
  return { html: DOMPurify.sanitize(html, PURIFY), toc, embeds: state.embeds, pageLists: state.pageLists };
}

/** A link to page `name` (red if it doesn't exist), as links in the text look. */
export function wikiLinkHtml(name: string, links: LinkContext): string {
  const before = state.links;
  state.links = links;
  try {
    return renderWikiLink({ page: name, section: null, label: null, suffix: "" }, name);
  } finally {
    state.links = before;
  }
}

/** One line of Markdown (bold, italic, [[links]]) -> safe inline HTML, for infobox values. */
export function renderInline(source: string, links: LinkContext | null = null): string {
  state = freshState(new Set(), links);
  const html = dropBreaksAfterImages(md.parseInline(source.replace(/\[\^[^\]\s]+\]/g, "")) as string);
  return DOMPurify.sanitize(html, PURIFY);
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
    return { id: h.id, text: h.text, parts: h.parts, number: stack.map((s) => s.n).join("."), depth: stack.length - 1 };
  });
}

/** A Contents entry's text, its spoilers hidden (they share keys with the heading's). */
export function partsHtml(e: TocEntry): string {
  let n = 0;
  return e.parts.map((p) => (p.spoiler ? spoilerHtml(escapeHtml(p.text), false, `h:${e.id}:${n++}`) : escapeHtml(p.text))).join("");
}

function tocBox(toc: TocEntry[]): string {
  const items = toc
    .map(
      (e) =>
        `<li class="toc-depth-${Math.min(e.depth, 5)}"><a href="#${encodeURIComponent(e.id)}">` +
        `<span class="toc-number">${e.number}</span> ${partsHtml(e)}</a></li>`,
    )
    .join("");
  return `<details class="toc" open><summary>Contents</summary><ol>${items}</ol></details>\n`;
}

/** The page's visible text, without Markdown symbols (for the word count). */
export function plainText(source: string): string {
  const parts: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (["html", "space", "hr", "def", "footnoteRef", "wikiImage", "gallery", "embed", "pageList"].includes(t.type)) continue;
      if (t.type === "quoteBox") {
        for (const p of [...(t.paras as Token[][]), t.by as Token[], t.source as Token[]]) {
          walk(p);
          parts.push(" ");
        }
      } else if (t.type === "table") {
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

/**
 * The Markdown of one section of `source` (found like `[[Page#Section]]`
 * finds it): what follows its heading up to the next heading of the same or a
 * higher level, plus the notes it uses. Null if there's no such section.
 */
export function sectionSource(source: string, section: string): string | null {
  state = freshState(definedLabels(source));
  const tokens = md.lexer(source);
  const want = slugify(section);
  let start = -1;
  let level = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "heading") continue;
    if (start >= 0 && t.depth <= level) return withNotes(tokens.slice(start, i));
    if (start < 0 && uniqueId(slugify(inlineText(t.tokens).trim())) === want) {
      start = i + 1;
      level = t.depth;
    }
  }
  return start < 0 ? null : withNotes(tokens.slice(start));

  function withNotes(part: Token[]): string {
    const text = part.filter((t) => t.type !== "footnoteDef").map((t) => t.raw).join("").replace(/^\s+/, "");
    const used = new Set([...text.matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => m[1]));
    const notes = tokens.filter((t) => t.type === "footnoteDef" && used.has(t.label as string)).map((t) => t.raw.trimEnd());
    return notes.length ? `${text.trimEnd()}\n\n${notes.join("\n")}\n` : text;
  }
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
}
