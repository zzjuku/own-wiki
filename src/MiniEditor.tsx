// A small text editor for infobox fields and template starter text: bold,
// italic and [[links]] work as in the page editor (Cmd+B, Cmd+I, Cmd+K, `[[`
// autocomplete). One line for Text fields, several for Long text.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import { EditorState, Prec, type Extension, type StateCommand } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder as placeholderExt, type Command } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { api } from "./api";
import { editorLinks, insertLink, linkCompletions, setLinkEnv, wikiLinkSyntax, type LinkEnv } from "./editorLinks";
import { toggleHeading, toggleInline, toggleList } from "./formatting";
import { PagePicker } from "./QuickOpen";
import { highlight, popupTheme } from "./SplitEditor";
import { useWiki } from "./wiki";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Several lines (Long text, starter text); otherwise Enter does nothing. */
  multiline?: boolean;
  placeholder?: string;
  /** The page being edited (links to it are fine, they just don't go anywhere). */
  pageId?: string;
  /** Heading and list buttons (starter text). */
  toolbar?: boolean;
  label?: string;
  autoFocus?: boolean;
  /** Extra class for the outer box. */
  className?: string;
  children?: ReactNode;
}

const cmd =
  (c: StateCommand): Command =>
  (view) =>
    c({ state: view.state, dispatch: view.dispatch });

const miniTheme = EditorView.theme({
  "&": { fontSize: "var(--text-md)", color: "var(--text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "4px 0", fontFamily: "var(--font-body)", caretColor: "var(--text)" },
  ".cm-scroller": { lineHeight: "1.45", fontFamily: "var(--font-body)" },
  ".cm-line": { padding: "0 7px" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-placeholder": { color: "var(--muted)" },
});

/** One line only: typed or pasted line breaks become spaces. */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
  const text = tr.newDoc.toString().replace(/\s*\r?\n\s*/g, " ");
  return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: text }, sequential: true }];
});

export function MiniEditor({ value, onChange, multiline, placeholder, pageId, toolbar, label, autoFocus, className, children }: Props) {
  const wiki = useWiki();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [picker, setPicker] = useState<{ query: string } | null>(null);
  const openPickerRef = useRef(() => {});
  openPickerRef.current = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    setPicker({ query: view.state.sliceDoc(sel.from, sel.to).replace(/\s+/g, " ").trim().slice(0, 200) });
  };

  useEffect(() => {
    const keys = [
      { key: "Mod-b", run: cmd(toggleInline("bold")) },
      { key: "Mod-i", run: cmd(toggleInline("italic")) },
      { key: "Mod-Shift-x", run: cmd(toggleInline("strike")) },
      { key: "Mod-Shift-z", run: redo, preventDefault: true },
      {
        key: "Mod-k",
        run: () => {
          openPickerRef.current();
          return true;
        },
        preventDefault: true,
      },
      multiline
        ? { key: "Enter", run: cmd(insertNewlineContinueMarkupCommand({ nonTightLists: false })) }
        : { key: "Enter", run: () => true },
    ];
    if (toolbar) {
      keys.push(
        { key: "Mod-Alt-1", run: cmd(toggleHeading(2)) },
        { key: "Mod-Alt-2", run: cmd(toggleHeading(3)) },
        { key: "Mod-Alt-3", run: cmd(toggleHeading(4)) },
        { key: "Mod-Shift-8", run: cmd(toggleList(false)) },
        { key: "Mod-Shift-7", run: cmd(toggleList(true)) },
      );
    }
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": label ?? "Value" }),
      markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax], addKeymap: false, completeHTMLTags: false }),
      editorLinks,
      autocompletion({ override: [linkCompletions], icons: false, maxRenderedOptions: 30 }),
      syntaxHighlighting(highlight),
      miniTheme,
      popupTheme,
      placeholder ? placeholderExt(placeholder) : [],
      multiline ? [] : singleLine,
      Prec.high(keymap.of(keys)),
      keymap.of([...defaultKeymap.filter((b) => !["Mod-[", "Mod-]"].includes(b.key ?? "")), ...historyKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
      }),
    ];
    const view = new EditorView({ parent: hostRef.current!, state: EditorState.create({ doc: value, extensions }) });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once; `value` changes from outside are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value changed from outside (e.g. restoring a hidden value) replaces the text.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, filter: false });
    }
  }, [value]);

  const env = useMemo<LinkEnv>(
    () => ({
      names: wiki.names,
      sections: (id) => api.pageSections(wiki.project, id),
      open: (link) => {
        const target = link.page ? wiki.names.resolve(link.page) : null;
        if (!link.page || target?.page.id === pageId) return;
        if (target) wiki.follow({ pageId: target.page.id, section: link.section, via: target.via ?? null });
        else wiki.createFromLink(link.page, pageId);
      },
    }),
    [wiki, pageId],
  );
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setLinkEnv.of(env) });
  }, [env]);

  function run(c: StateCommand) {
    const view = viewRef.current;
    if (!view) return;
    cmd(c)(view);
    view.focus();
  }

  return (
    <div className={`mini-editor ${multiline ? "multi" : ""} ${className ?? ""}`}>
      {toolbar && (
        <div className="mini-toolbar" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className="tool" title="Heading" onClick={() => run(toggleHeading(2))}>
            H1
          </button>
          <button type="button" className="tool" title="Subheading" onClick={() => run(toggleHeading(3))}>
            H2
          </button>
          <button type="button" className="tool" title="Sub-subheading" onClick={() => run(toggleHeading(4))}>
            H3
          </button>
          <span className="toolbar-sep" />
          <button type="button" className="tool" title="Bold" onClick={() => run(toggleInline("bold"))}>
            <b>B</b>
          </button>
          <button type="button" className="tool" title="Italic" onClick={() => run(toggleInline("italic"))}>
            <i>I</i>
          </button>
          <button type="button" className="tool" title="Bulleted list" onClick={() => run(toggleList(false))}>
            • List
          </button>
          <button type="button" className="tool" title="Link to a page" onClick={() => openPickerRef.current()}>
            Link
          </button>
        </div>
      )}
      <div className="mini-host" ref={hostRef} />
      {children}
      {picker && (
        <PagePicker
          names={wiki.names}
          label="Link to page"
          placeholder="Type a page title or alias…"
          initialQuery={picker.query}
          allowNew
          onPick={(p) => {
            const view = viewRef.current;
            if (view) insertLink(view, "entry" in p ? p.entry.name : p.newTitle);
          }}
          close={() => {
            setPicker(null);
            viewRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
