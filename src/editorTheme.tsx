// Look of the Markdown editors (page editor and the small field editors):
// syntax colours, editor and popup styling, spoiler marks, toolbar icons.
import type { ReactNode } from "react";
import { HighlightStyle } from "@codemirror/language";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.55em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.4em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.22em", fontWeight: "700" },
  { tag: t.heading4, fontSize: "1.1em", fontWeight: "700" },
  { tag: [t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--link)" },
  { tag: t.quote, color: "var(--editor-quote)" },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--editor-mark)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)" },
]);

export const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-font-size)", color: "var(--text)", backgroundColor: "var(--bg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-body)", lineHeight: "1.6" },
  ".cm-content": { padding: "var(--editor-padding)", caretColor: "var(--text)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-placeholder": { color: "var(--muted)" },
});

/** Link suggestions (also used by the small field editors). */
export const popupTheme = EditorView.theme({
  // Link suggestions
  ".cm-tooltip": {
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-md)",
    maxHeight: "18em",
    minWidth: "260px",
    maxWidth: "min(560px, 80vw)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 10px", lineHeight: "1.4" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-text)",
  },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "1.2em", fontSize: "var(--text-sm)" },
  ".cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail": { color: "inherit", opacity: "0.8" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
});

/** `||spoilers||` in the source get a dotted background, so they're easy to spot. */
const spoilerMatcher = new MatchDecorator({
  regexp: /\\\|\\\|(?:(?!\\\|\\\|)[^\n])+?\\\|\\\||\|\|[^|\s](?:[^\n]*?[^\\\n])??\|\|/g,
  decoration: Decoration.mark({ class: "cm-spoiler" }),
});

/** Marks text matching `matcher` in the editor. */
const marksOf = (matcher: MatchDecorator) =>
  ViewPlugin.fromClass(
    class {
      marks: DecorationSet;
      constructor(view: EditorView) {
        this.marks = matcher.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.marks = matcher.updateDeco(u, this.marks);
      }
    },
    { decorations: (v) => v.marks },
  );

export const spoilerMarks = marksOf(spoilerMatcher);

/** Embed lines (`{{Page}}`) look like a chip, so they stand out from the text. */
export const embedMarks = marksOf(
  new MatchDecorator({ regexp: /^ {0,3}\{\{[^{}\n]+\}\}[ \t]*$/g, decoration: Decoration.mark({ class: "cm-embed" }) }),
);

const ICONS: Record<string, ReactNode> = {
  bullet: (
    <>
      <circle cx="3" cy="4" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="3" cy="12" r="1.3" />
      <path d="M6.5 4h8M6.5 8h8M6.5 12h8" className="stroke" />
    </>
  ),
  ordered: (
    <>
      <text x="0.6" y="5.6" fontSize="5.4" fontWeight="700">1</text>
      <text x="0.6" y="13.6" fontSize="5.4" fontWeight="700">2</text>
      <path d="M6.5 4h8M6.5 8h8M6.5 12h8" className="stroke" />
    </>
  ),
  spoiler: (
    <>
      <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z" className="stroke thin" />
      <circle cx="8" cy="8" r="2" className="stroke thin" />
      <path d="M2.5 13.5 13.5 2.5" className="stroke thin" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z" className="stroke thin" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  embed: (
    <>
      <path d="M1.5 2.5h13v11h-13z" className="stroke thin" />
      <path d="M4 5.5h8M4 8h8M4 10.5h5" className="stroke thin" />
    </>
  ),
  pagelist: (
    <>
      <path d="M1.5 2.5h13v11h-13z" className="stroke thin" />
      <circle cx="4.5" cy="6" r="0.9" />
      <circle cx="4.5" cy="10" r="0.9" />
      <path d="M6.5 6h5M6.5 10h5" className="stroke thin" />
    </>
  ),
  quotebox: (
    <>
      <path d="M1.5 2.5h13v11h-13z" className="stroke thin" />
      <path d="M4.5 8.5c0-1.8.7-2.9 2-3.2M4.5 8.5h1.8v1.8H4.5zM8.6 8.5c0-1.8.7-2.9 2-3.2M8.6 8.5h1.8v1.8H8.6z" className="stroke thin" />
    </>
  ),
  quote: <path d="M2.5 9.5c0-3 1.3-5 4-5.5M2.5 9.5h3v3h-3zM9 9.5c0-3 1.3-5 4-5.5M9 9.5h3v3H9z" className="stroke" />,
  divider: <path d="M1.5 8h13M4 4h8M4 12h8" className="stroke thin" />,
  table: (
    <path
      d="M2 3h12v10H2zM2 6.4h12M2 9.7h12M6 3v10M10 3v10"
      className="stroke thin"
    />
  ),
  footnote: (
    <>
      <path d="M2 12.5h7" className="stroke thin" />
      <text x="9.6" y="7.4" fontSize="7" fontWeight="700">1</text>
      <path d="M2 9h5" className="stroke thin" />
    </>
  ),
  link: (
    <path
      d="M6.8 9.2a3 3 0 0 0 4.3 0l2.2-2.2a3 3 0 0 0-4.3-4.3l-1 1M9.2 6.8a3 3 0 0 0-4.3 0L2.7 9a3 3 0 0 0 4.3 4.3l1-1"
      className="stroke"
    />
  ),
  image: (
    <>
      <path d="M2 3h12v10H2z" className="stroke thin" />
      <path d="m2.5 12 3.5-4 2.5 2.5 2-2 3 3.5" className="stroke thin" />
      <circle cx="10.8" cy="5.8" r="1.2" />
    </>
  ),
  gallery: <path d="M1.5 2.5h5.5v5H1.5zM9 2.5h5.5v5H9zM1.5 9h5.5v5H1.5zM9 9h5.5v5H9z" className="stroke thin" />,
  undo: <path d="M5 3.5 2 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7" className="stroke" />,
  redo: <path d="m11 3.5 3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9" className="stroke" />,
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
