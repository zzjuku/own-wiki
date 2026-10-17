// The split editor: Markdown source (CodeMirror) on the left, live preview on
// the right, toolbar on top, word count at the bottom.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorState, Prec, type Extension, type StateCommand } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder, type Command } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  activeFormats,
  indentListItem,
  insertDivider,
  insertFootnote,
  insertTable,
  sameFormats,
  toggleHeading,
  toggleInline,
  toggleList,
  toggleQuote,
  type ActiveFormats,
} from "./formatting";
import { handleContentClick } from "./links";
import { countWords, plainText, renderPage } from "./markdown";
import { htmlToMarkdown } from "./paste";
import { TableDialog } from "./TableDialog";
import { IS_MAC } from "./QuickOpen";

interface Props {
  initial: string;
  onChange: (text: string) => void;
  /** Shown at the right of the status line (save state). */
  status?: ReactNode;
}

const MOD = IS_MAC ? "⌘" : "Ctrl+";
const ALT = IS_MAC ? "⌥" : "Alt+";
const SHIFT = IS_MAC ? "⇧" : "Shift+";

const cmd =
  (c: StateCommand): Command =>
  (view) =>
    c({ state: view.state, dispatch: view.dispatch });

interface Tool {
  id: string;
  label: ReactNode;
  title: string;
  run: Command;
  active?: (f: ActiveFormats) => boolean;
}

const TOOLS: (Tool | "|")[] = [
  { id: "h2", label: "H1", title: `Heading (${MOD}${ALT}1)`, run: cmd(toggleHeading(2)), active: (f) => f.heading === 2 },
  { id: "h3", label: "H2", title: `Subheading (${MOD}${ALT}2)`, run: cmd(toggleHeading(3)), active: (f) => f.heading === 3 },
  { id: "h4", label: "H3", title: `Sub-subheading (${MOD}${ALT}3)`, run: cmd(toggleHeading(4)), active: (f) => f.heading === 4 },
  "|",
  { id: "bold", label: <b>B</b>, title: `Bold (${MOD}B)`, run: cmd(toggleInline("bold")), active: (f) => f.bold },
  { id: "italic", label: <i>I</i>, title: `Italic (${MOD}I)`, run: cmd(toggleInline("italic")), active: (f) => f.italic },
  { id: "strike", label: <s>S</s>, title: `Strikethrough (${MOD}${SHIFT}X)`, run: cmd(toggleInline("strike")), active: (f) => f.strike },
  "|",
  { id: "bullet", label: <Icon name="bullet" />, title: `Bulleted list (${MOD}${SHIFT}8)`, run: cmd(toggleList(false)), active: (f) => f.bullet },
  { id: "ordered", label: <Icon name="ordered" />, title: `Numbered list (${MOD}${SHIFT}7)`, run: cmd(toggleList(true)), active: (f) => f.ordered },
  { id: "quote", label: <Icon name="quote" />, title: "Quote", run: cmd(toggleQuote()), active: (f) => f.quote },
  { id: "divider", label: <Icon name="divider" />, title: "Divider line", run: cmd(insertDivider) },
  "|",
  { id: "table", label: <Icon name="table" />, title: "Insert table", run: () => true },
  { id: "footnote", label: <Icon name="footnote" />, title: "Footnote", run: cmd(insertFootnote) },
];

/** Pastes text without formatting (Cmd+Shift+V / Ctrl+Shift+V). */
const pastePlain: Command = (view) => {
  readText().then(
    (text) => {
      if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
    },
    () => {},
  );
  return true;
};

/** Pasted formatted text (Word, Google Docs, web pages) becomes Markdown. */
const pasteFormatted = EditorView.domEventHandlers({
  paste(event, view) {
    const html = event.clipboardData?.getData("text/html");
    if (!html) return false;
    const md = htmlToMarkdown(html);
    if (md === null) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(md), { userEvent: "input.paste", scrollIntoView: true });
    return true;
  },
});

const formatKeymap = [
  { key: "Mod-b", run: cmd(toggleInline("bold")) },
  { key: "Mod-i", run: cmd(toggleInline("italic")) },
  { key: "Mod-Shift-x", run: cmd(toggleInline("strike")) },
  { key: "Mod-Alt-1", run: cmd(toggleHeading(2)) },
  { key: "Mod-Alt-2", run: cmd(toggleHeading(3)) },
  { key: "Mod-Alt-3", run: cmd(toggleHeading(4)) },
  { key: "Mod-Shift-8", run: cmd(toggleList(false)) },
  { key: "Mod-Shift-7", run: cmd(toggleList(true)) },
  // Redo: Cmd+Shift+Z everywhere, and Ctrl+Y on Windows (from historyKeymap).
  { key: "Mod-Shift-z", run: redo, preventDefault: true },
  { key: "Mod-Shift-v", run: pastePlain, preventDefault: true },
  { key: "Enter", run: cmd(insertNewlineContinueMarkupCommand({ nonTightLists: false })) },
  { key: "Backspace", run: cmd(deleteMarkupBackward) },
  { key: "Tab", run: cmd(indentListItem(false)) },
  { key: "Shift-Tab", run: cmd(indentListItem(true)) },
  // Tab outside a list does nothing (rather than leaving the editor).
  { key: "Tab", run: () => true, shift: () => true },
];

const highlight = HighlightStyle.define([
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

const theme = EditorView.theme({
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

const SPLIT_KEY = "ownwiki.editorSplit";
const PREVIEW_KEY = "ownwiki.previewHidden";

function loadNumber(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering the layout is harmless.
  }
}

/** Long pages re-render the preview a little after typing, short ones at once. */
const previewDelay = (length: number) => Math.min(250, Math.floor(length / 800));

const NO_FORMATS: ActiveFormats = {
  bold: false,
  italic: false,
  strike: false,
  heading: 0,
  bullet: false,
  ordered: false,
  quote: false,
};

export function SplitEditor({ initial, onChange, status }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const anchors = useRef<{ line: number; top: number }[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [text, setText] = useState(initial);
  const [formats, setFormats] = useState<ActiveFormats>(NO_FORMATS);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [split, setSplit] = useState(() => Math.min(0.8, Math.max(0.2, loadNumber(SPLIT_KEY, 0.5))));
  const [tableOpen, setTableOpen] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(() => loadNumber(PREVIEW_KEY, 0) === 1);
  const hiddenRef = useRef(previewHidden);
  hiddenRef.current = previewHidden;

  // Create the editor once; the page component remounts it for another page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
      markdown({ base: markdownLanguage, addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false }),
      syntaxHighlighting(highlight),
      search({ top: true }),
      placeholder("Start writing…"),
      EditorState.phrases.of({
        next: "Next",
        previous: "Previous",
        all: "All",
        "match case": "Match case",
        regexp: "Regular expression",
        "by word": "Whole words",
        replace: "Replace",
        "replace all": "Replace all",
      }),
      theme,
      pasteFormatted,
      Prec.high(keymap.of(formatKeymap)),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const doc = u.state.doc.toString();
          onChangeRef.current(doc);
          clearTimeout(timer);
          const delay = previewDelay(doc.length);
          if (delay) timer = setTimeout(() => setText(doc), delay);
          else setText(doc);
        }
        // Width changes re-wrap lines; keep the preview aligned.
        if (u.geometryChanged) requestAnimationFrame(syncScroll);
        if (u.docChanged || u.selectionSet) {
          const f = activeFormats(u.state);
          setFormats((prev) => (sameFormats(prev, f) ? prev : f));
          setCanUndo(undoDepth(u.state) > 0);
          setCanRedo(redoDepth(u.state) > 0);
        }
      }),
    ];
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({ doc: initial, extensions }),
    });
    viewRef.current = view;
    view.focus();
    const onScroll = () => requestAnimationFrame(syncScroll);
    view.scrollDOM.addEventListener("scroll", onScroll);
    return () => {
      clearTimeout(timer);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // `initial` is only read when the editor is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const html = useMemo(() => renderPage(text, { lineAnchors: true }).html, [text]);
  const counts = useMemo(() => {
    const plain = plainText(text);
    return { words: countWords(plain), chars: plain.length };
  }, [text]);

  /** Scrolls the preview so it shows what the top of the editor shows. */
  function syncScroll() {
    const view = viewRef.current;
    const pv = previewRef.current;
    if (!view || !pv || hiddenRef.current) return;
    const sc = view.scrollDOM;
    if (sc.scrollTop <= 0) return void (pv.scrollTop = 0);
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) return void (pv.scrollTop = pv.scrollHeight);
    const height = sc.getBoundingClientRect().top - view.documentTop;
    const block = view.lineBlockAtHeight(height);
    const line = view.state.doc.lineAt(block.from).number - 1;
    const pos = line + (block.height ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0);
    const list = anchors.current;
    let i = list.length - 1;
    while (i >= 0 && list[i].line > pos) i--;
    const a = i >= 0 ? list[i] : { line: 0, top: 0 };
    const b = list[i + 1] ?? { line: view.state.doc.lines, top: pv.scrollHeight };
    const y = a.top + ((b.top - a.top) * (pos - a.line)) / Math.max(1, b.line - a.line);
    pv.scrollTop = y - 12;
  }

  // After the preview changes, re-measure the line anchors and re-sync.
  useLayoutEffect(() => {
    const pv = previewRef.current;
    if (!pv) return;
    anchors.current = [...pv.querySelectorAll<HTMLElement>("[data-line]")].map((el) => ({
      line: Number(el.dataset.line),
      top: el.offsetTop,
    }));
    syncScroll();
  }, [html, previewHidden, split]);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const box = splitRef.current!.getBoundingClientRect();
    let last = split;
    const move = (ev: PointerEvent) => {
      last = Math.min(0.8, Math.max(0.2, (ev.clientX - box.left) / box.width));
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      store(SPLIT_KEY, String(last));
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function run(c: Command) {
    const view = viewRef.current;
    if (!view) return;
    c(view);
    view.focus();
  }

  function togglePreview() {
    setPreviewHidden((h) => {
      store(PREVIEW_KEY, h ? "0" : "1");
      return !h;
    });
  }

  return (
    <div className="split-editor">
      <div className="toolbar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => e.preventDefault()}>
        {TOOLS.map((tool, i) =>
          tool === "|" ? (
            <span key={i} className="toolbar-sep" />
          ) : (
            <button
              key={tool.id}
              className={`tool ${tool.active?.(formats) ? "active" : ""}`}
              title={tool.title}
              aria-label={tool.title}
              aria-pressed={tool.active ? tool.active(formats) : undefined}
              onClick={() => (tool.id === "table" ? setTableOpen(true) : run(tool.run))}
            >
              {tool.label}
            </button>
          ),
        )}
        <span className="toolbar-sep" />
        <button className="tool" title={`Undo (${MOD}Z)`} aria-label="Undo" disabled={!canUndo} onClick={() => run(undo)}>
          <Icon name="undo" />
        </button>
        <button
          className="tool"
          title={`Redo (${MOD}${SHIFT}Z${IS_MAC ? "" : " or Ctrl+Y"})`}
          aria-label="Redo"
          disabled={!canRedo}
          onClick={() => run(redo)}
        >
          <Icon name="redo" />
        </button>
        <div className="spacer" />
        <button className={`tool wide ${previewHidden ? "" : "active"}`} title="Show or hide the preview" onClick={togglePreview}>
          Preview
        </button>
      </div>

      <div className="split" ref={splitRef}>
        <div className="split-source" style={{ flexBasis: previewHidden ? "100%" : `${split * 100}%` }} ref={hostRef} />
        {!previewHidden && (
          <>
            <div className="split-divider" onPointerDown={startDrag} title="Drag to resize" />
            <div className="split-preview" ref={previewRef}>
              <div
                className="markdown"
                onClick={handleContentClick}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </>
        )}
      </div>

      <div className="status-line">
        <span>
          {counts.words.toLocaleString("en")} {counts.words === 1 ? "word" : "words"} ·{" "}
          {counts.chars.toLocaleString("en")} characters
        </span>
        <div className="spacer" />
        {status}
      </div>

      {tableOpen && (
        <TableDialog
          onInsert={(rows, cols) => {
            setTableOpen(false);
            run(cmd(insertTable(rows, cols)));
          }}
          close={() => {
            setTableOpen(false);
            viewRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

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
