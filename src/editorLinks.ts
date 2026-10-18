// Page links in the Markdown source editor: the [[link]] syntax for the
// parser, colouring (red for missing pages), Cmd/Ctrl+click to follow,
// `[[` autocomplete, and inserting links from the Link button.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import type { Heading } from "./api";
import { CATEGORY_PREFIX, categoryOf, type CategoryIndex } from "./categories";
import type { NameIndex } from "./names";
import { IS_MAC } from "./QuickOpen";
import { imageAtStart, parseImage, type TextImage } from "./images";
import { displayGroup } from "./tree";
import { linkAtStart, norm, type WikiLink } from "./wikilinks";

const OPEN = 91; // [
const CLOSE = 93; // ]
const NEWLINE = 10;

/** Teaches the Markdown parser about [[links]], so they aren't read as
 * ordinary [links] and code stays code. */
export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: [{ name: "WikiLink", style: tags.link }, { name: "WikiImage" }],
  parseInline: [
    {
      // [[File:Name.png|…|Caption]]; links in the caption are WikiLink children.
      name: "WikiImage",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== OPEN) return -1;
        const m = imageAtStart(cx.slice(pos, cx.end));
        if (!m) return -1;
        const children = [];
        const text = cx.slice(pos, pos + m.length);
        for (let i = 2; i < m.length - 2; i++) {
          if (text.startsWith("[[", i)) {
            const l = linkAtStart(text.slice(i));
            if (l) {
              children.push(cx.elt("WikiLink", pos + i, pos + i + l.length));
              i += l.length - 1;
            }
          }
        }
        return cx.addElement(cx.elt("WikiImage", pos, pos + m.length, children));
      },
    },
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== OPEN) return -1;
        let end = -1;
        for (let i = pos + 2; i < cx.end - 1; i++) {
          const c = cx.char(i);
          if (c === NEWLINE || c === OPEN) return -1;
          if (c === CLOSE) {
            if (cx.char(i + 1) !== CLOSE) return -1;
            end = i + 2;
            break;
          }
        }
        if (end < 0) return -1;
        const text = cx.slice(pos, Math.min(cx.end, end + 200));
        const m = linkAtStart(text);
        if (!m) return -1;
        return cx.addElement(cx.elt("WikiLink", pos, pos + m.length));
      },
    },
  ],
};

/** What the editor needs from the project; replaced when pages change. */
export interface LinkEnv {
  names: NameIndex;
  categories: CategoryIndex;
  /** Follow a link (Cmd/Ctrl+click). */
  open: (link: WikiLink) => void;
  /** Headings of a page, for `[[Page#` suggestions. */
  sections: (pageId: string) => Promise<Heading[]>;
}

export const setLinkEnv = StateEffect.define<LinkEnv>();

export const linkEnv = StateField.define<LinkEnv | null>({
  create: () => null,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setLinkEnv)) return e.value;
    return value;
  },
});

/** The link whose text covers `pos` (with where it is), if any. */
export function linkRangeAt(state: EditorState, pos: number, side: -1 | 1 = 1): { from: number; to: number; link: WikiLink } | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
    if (n.name === "WikiLink") {
      const link = linkAtStart(state.sliceDoc(n.from, n.to))?.link;
      return link ? { from: n.from, to: n.to, link } : null;
    }
  }
  return null;
}

/** The image whose source covers `pos` (with where it is), if any. */
export function imageRangeAt(state: EditorState, pos: number): { from: number; to: number; image: TextImage } | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "WikiImage") {
      const m = imageAtStart(state.sliceDoc(n.from, n.to));
      return m ? { from: n.from, to: n.to, image: parseImage(m.inner) } : null;
    }
  }
  return null;
}

function linkAt(state: EditorState, pos: number): WikiLink | null {
  return linkRangeAt(state, pos)?.link ?? null;
}

const plainLink = Decoration.mark({ class: "cm-wikilink" });
const imageMark = Decoration.mark({ class: "cm-wikiimage", attributes: { title: "Image — click to change it" } });
const IS_MOD = IS_MAC ? "⌘" : "Ctrl+";

function decorate(view: EditorView): DecorationSet {
  const env = view.state.field(linkEnv);
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === "WikiImage") {
          marks.push(imageMark.range(node.from, node.to));
          return;
        }
        if (node.name !== "WikiLink") return;
        const link = linkAtStart(view.state.sliceDoc(node.from, node.to))?.link;
        if (!link) return;
        const cat = categoryOf(link.page);
        const missing = env && link.page && (cat !== null ? !env.categories.resolve(cat) : !env.names.resolve(link.page));
        marks.push(
          (missing
            ? Decoration.mark({
                class: "cm-wikilink cm-wikilink-new",
                attributes: {
                  title:
                    cat !== null
                      ? `Category “${cat}” doesn't exist yet — ${IS_MOD}click to create it`
                      : `“${link.page}” doesn't exist yet — ${IS_MOD}click to create it`,
                },
              })
            : plainLink
          ).range(node.from, node.to),
        );
      },
    });
  }
  return Decoration.set(marks, true);
}

const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(u: ViewUpdate) {
      const envChanged = u.transactions.some((t) => t.effects.some((e) => e.is(setLinkEnv)));
      if (u.docChanged || u.viewportChanged || envChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = decorate(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Cmd+click (Ctrl+click on Windows) on a link follows it. */
const followOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const link = linkAt(view.state, pos);
    const env = view.state.field(linkEnv);
    if (!link || !env) return false;
    event.preventDefault();
    env.open(link);
    return true;
  },
});

/** Holding Cmd/Ctrl shows a hand over links. */
const modClass = EditorView.domEventHandlers({
  keydown(e, view) {
    if (e.key === (IS_MAC ? "Meta" : "Control")) view.dom.classList.add("cm-mod-held");
    return false;
  },
  keyup(e, view) {
    if (e.key === (IS_MAC ? "Meta" : "Control")) view.dom.classList.remove("cm-mod-held");
    return false;
  },
  blur(_e, view) {
    view.dom.classList.remove("cm-mod-held");
    return false;
  },
});

/** Inserts `text]]` for a completion, unless `]]` already follows. */
function closeLink(text: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const closed = view.state.sliceDoc(to, to + 2) === "]]";
    const insert = closed ? text : text + "]]";
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.cursor(from + text.length + 2),
      userEvent: "input.complete",
      scrollIntoView: true,
    });
  };
}

/** Suggestions after `[[` (page titles and aliases) and after `[[Page#` (its sections). */
export async function linkCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
  const env = ctx.state.field(linkEnv, false);
  if (!env) return null;
  const inCode = (() => {
    for (let n: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); n; n = n.parent)
      if (/Code|CodeText|CodeBlock/.test(n.name)) return true;
    return false;
  })();
  if (inCode) return null;

  const sec = ctx.matchBefore(/\[\[([^[\]|#\n]+)#([^[\]|\n]*)$/);
  if (sec) {
    const hash = sec.text.indexOf("#");
    const target = env.names.resolve(sec.text.slice(2, hash));
    if (!target) return null;
    const headings = await env.sections(target.page.id).catch(() => [] as Heading[]);
    const q = norm(sec.text.slice(hash + 1));
    const seen = new Map<string, number>();
    const options: Completion[] = [];
    for (const h of headings) {
      const key = norm(h.text);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (q && !norm(h.text).includes(q)) continue;
      // A repeated heading is linked by its anchor ("early-life-2").
      const insert = (seen.get(key) ?? 0) > 1 ? h.anchor : h.text;
      options.push({ label: h.text || h.anchor, detail: h.level > 2 ? "subsection" : undefined, apply: closeLink(insert) });
    }
    return { from: sec.from + hash + 1, options, filter: false };
  }

  const m = ctx.matchBefore(/\[\[[^[\]|#\n]*$/);
  if (!m) return null;
  const query = m.text.slice(2);
  // [[Category: → category names.
  const catQuery = categoryOf(query);
  if (catQuery !== null) {
    const options: Completion[] = env.categories.search(catQuery, 50).map((c, i) => ({
      label: c.name,
      detail: c.pages === 1 ? "1 page" : `${c.pages} pages`,
      apply: closeLink(`${CATEGORY_PREFIX}${c.name}`),
      boost: -i,
    }));
    return { from: m.from + 2, options, filter: false };
  }
  const options: Completion[] = env.names.search(query, 50).map((e, i) => ({
    label: e.name,
    detail: [e.alias ? `→ ${e.page.title}` : "", displayGroup(e.page.group)].filter(Boolean).join("  ·  "),
    apply: closeLink(e.name),
    boost: -i,
  }));
  return { from: m.from + 2, options, filter: false };
}

/** Inserts a link to `name` at the cursor; selected text becomes the shown text. */
export function insertLink(view: EditorView, name: string) {
  const { state } = view;
  const sel = state.selection.main;
  const text = state.sliceDoc(sel.from, sel.to).replace(/\s+/g, " ").trim();
  const inTable = /^\s*\|/.test(state.doc.lineAt(sel.from).text);
  const pipe = inTable ? "\\|" : "|";
  const insert = !text ? `[[${name}]]` : norm(text) === norm(name) ? `[[${text}]]` : `[[${name}${pipe}${text}]]`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: EditorSelection.cursor(sel.from + insert.length),
    userEvent: "input.link",
    scrollIntoView: true,
  });
}

/** The extensions for links in the editor. */
export const editorLinks = [linkEnv, linkDecorations, followOnClick, modClass];
