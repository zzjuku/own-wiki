// The split editor: Markdown source (CodeMirror) on the left, live preview on
// the right, toolbar on top, word count at the bottom.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import { EditorState, Prec, type Extension, type StateCommand } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder, type Command } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
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
import { api, errorText, type Infobox, type Relations } from "./api";
import { infoboxHtml } from "./infobox";
import { InfoboxForm } from "./InfoboxForm";
import { editorLinks, imageRangeAt, insertLink, linkCompletions, linkRangeAt, setLinkEnv, wikiLinkSyntax, type LinkEnv } from "./editorLinks";
import { LinkPopup } from "./LinkPopup";
import { chooseTextImages, ImagePopup } from "./ImagePopup";
import { useFileDrop } from "./dropFiles";
import { hasExtension, imageSource, newImage, TEXT_IMAGE_EXTENSIONS, type TextImage } from "./images";
import { useBlockDialogs } from "./BlockDialogs";
import { embedMarks, highlight, Icon, popupTheme, spoilerMarks, theme } from "./editorTheme";
import { toggleSpoiler } from "./spoilers";
import { useReportError } from "./notify";
import { categoryOf } from "./categories";
import { editedLink, shownText, type WikiLink } from "./wikilinks";
import { countWords, plainText } from "./markdown";
import { renderWithEmbeds, useEmbedEnv } from "./embeds";
import { htmlToMarkdown } from "./paste";
import { TableDialog } from "./TableDialog";
import { IS_MAC, PagePicker } from "./QuickOpen";
import { frameFor, scrollToSection, useContentClick, useLinkContext, useWiki } from "./wiki";

interface Props {
  /** The page being edited. */
  pageId: string;
  /** Its title (the infobox's title bar). */
  title: string;
  initial: string;
  onChange: (text: string) => void;
  infobox: Infobox | null;
  infoboxError: string | null;
  /** What other pages' fields add to this page (Linked from, two-way fields). */
  relations: Relations;
  /** This page wrote a relation into another page: re-read the relations. */
  onRelationsChanged: () => void;
  onInfoboxChange: (ib: Infobox | null) => void;
  /** Shown at the right of the status line (save state). */
  status?: ReactNode;
  /** No Infobox tab (category pages). */
  noInfobox?: boolean;
  /** Editing a category page's text: links to it show bold. */
  currentCategory?: string;
}

type Tab = "text" | "infobox";

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
  { id: "spoiler", label: <Icon name="spoiler" />, title: `Spoiler: hidden until clicked (${MOD}${SHIFT}S)`, run: cmd(toggleSpoiler) },
  "|",
  { id: "bullet", label: <Icon name="bullet" />, title: `Bulleted list (${MOD}${SHIFT}8)`, run: cmd(toggleList(false)), active: (f) => f.bullet },
  { id: "ordered", label: <Icon name="ordered" />, title: `Numbered list (${MOD}${SHIFT}7)`, run: cmd(toggleList(true)), active: (f) => f.ordered },
  { id: "quote", label: <Icon name="quote" />, title: "Indented quote", run: cmd(toggleQuote()), active: (f) => f.quote },
  { id: "quotebox", label: <Icon name="quotebox" />, title: "Quote box (quote, by, source)", run: () => true },
  { id: "divider", label: <Icon name="divider" />, title: "Separator line", run: cmd(insertDivider) },
  "|",
  { id: "table", label: <Icon name="table" />, title: "Insert table", run: () => true },
  { id: "footnote", label: <Icon name="footnote" />, title: "Footnote", run: cmd(insertFootnote) },
  { id: "link", label: <Icon name="link" />, title: `Link to a page (${MOD}K)`, run: () => true },
  { id: "embed", label: <Icon name="embed" />, title: "Embed a page (its current content shows here)", run: () => true },
  { id: "image", label: <Icon name="image" />, title: "Insert image (you can also drop or paste images)", run: () => true },
  { id: "gallery", label: <Icon name="gallery" />, title: "Insert gallery", run: () => true },
];

// Cmd+[ / Cmd+] (Alt+Left / Alt+Right on Windows) are Back and Forward, not indenting.
const RESERVED_KEYS = new Set(IS_MAC ? ["Mod-[", "Mod-]"] : ["Mod-[", "Mod-]", "Alt-ArrowLeft", "Alt-ArrowRight"]);
const baseKeymap = defaultKeymap.filter((b) => !RESERVED_KEYS.has(b.key ?? "") && !RESERVED_KEYS.has(b.win ?? ""));

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

/** Pasted formatted text (Word, Google Docs, web pages) becomes Markdown;
 * a pasted image (e.g. a screenshot) is added to the project. */
function pasteFormatted(pasteImages: (files: File[]) => void) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      const html = data?.getData("text/html");
      const md = html ? htmlToMarkdown(html) : null;
      if (md) {
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(md), { userEvent: "input.paste", scrollIntoView: true });
        return true;
      }
      const images = [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (images.length) {
        event.preventDefault();
        pasteImages(images);
        return true;
      }
      return false;
    },
  });
}

/** Is the line at `pos` a table row (links and images write `\|` there)? */
const inTableAt = (state: EditorState, pos: number) => /^\s*\|/.test(state.doc.lineAt(pos).text);

const formatKeymap = [
  { key: "Mod-b", run: cmd(toggleInline("bold")) },
  { key: "Mod-i", run: cmd(toggleInline("italic")) },
  { key: "Mod-Shift-x", run: cmd(toggleInline("strike")) },
  { key: "Mod-Shift-s", run: cmd(toggleSpoiler), preventDefault: true },
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

export function SplitEditor({ pageId, title, initial, onChange, infobox, infoboxError, relations, onRelationsChanged, onInfoboxChange, status, noInfobox, currentCategory }: Props) {
  const wiki = useWiki();
  const report = useReportError();
  const [tab, setTab] = useState<Tab>("text");
  const links = useLinkContext(pageId, currentCategory);
  const onContentClick = useContentClick(pageId);
  const [linkPicker, setLinkPicker] = useState<{ query: string } | null>(null);
  // The Edit link popup, shown after clicking a link in the source.
  const [popup, setPopup] = useState<{ from: number; to: number; link: WikiLink; at: { left: number; top: number } } | null>(null);
  const popupRef = useRef(popup);
  popupRef.current = popup;
  // The Edit image popup, after clicking an image in the source.
  const [imagePopup, setImagePopup] = useState<{ from: number; to: number; image: TextImage; at: { left: number; top: number } } | null>(null);
  const imagePopupRef = useRef(imagePopup);
  imagePopupRef.current = imagePopup;
  const insertImagesRef = useRef<(files: string[], at?: number) => void>(() => {});
  const pasteImagesRef = useRef<(files: File[]) => void>(() => {});
  const openLinkPickerRef = useRef(() => {});
  openLinkPickerRef.current = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    setLinkPicker({ query: view.state.sliceDoc(sel.from, sel.to).replace(/\s+/g, " ").trim().slice(0, 200) });
  };
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const anchors = useRef<{ line: number; top: number }[]>([]);
  // Counts images that finished loading in the preview (they move the line anchors).
  const [loads, setLoads] = useState(0);
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
      markdown({
        base: markdownLanguage,
        extensions: [wikiLinkSyntax],
        addKeymap: false,
        completeHTMLTags: false,
        pasteURLAsLink: false,
      }),
      editorLinks,
      autocompletion({ override: [linkCompletions], icons: false, maxRenderedOptions: 50 }),
      syntaxHighlighting(highlight),
      spoilerMarks,
      embedMarks,
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
      popupTheme,
      pasteFormatted((files) => pasteImagesRef.current(files)),
      Prec.high(
        keymap.of([
          ...formatKeymap,
          {
            key: "Mod-k",
            run: () => {
              openLinkPickerRef.current();
              return true;
            },
            preventDefault: true,
          },
        ]),
      ),
      keymap.of([...baseKeymap, ...historyKeymap, ...searchKeymap]),
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
        // Clicking into a link opens the Edit link popup, clicking an image
        // the Edit image popup, clicking a gallery the gallery dialog;
        // moving away or typing closes the popups.
        if (u.docChanged && popupRef.current) setPopup(null);
        if (u.docChanged) blocksRef.current.closePopup();
        if (u.docChanged && imagePopupRef.current && !u.transactions.some((t) => t.isUserEvent("input.image"))) setImagePopup(null);
        if (u.selectionSet && !u.docChanged) {
          const sel = u.state.selection.main;
          const clicked = u.transactions.some((t) => t.isUserEvent("select.pointer"));
          const r = sel.empty ? linkRangeAt(u.state, sel.head) : null;
          const img = sel.empty && !(r && r.from < sel.head && sel.head < r.to) ? imageRangeAt(u.state, sel.head) : null;
          if (clicked && r && r.from < sel.head && sel.head < r.to) {
            setImagePopup(null);
            requestAnimationFrame(() => {
              const c = u.view.coordsAtPos(r.from);
              if (c) setPopup({ ...r, at: { left: c.left, top: c.bottom + 6 } });
            });
          } else if (clicked && img && img.from < sel.head && sel.head < img.to) {
            setPopup(null);
            requestAnimationFrame(() => {
              const c = u.view.coordsAtPos(sel.head);
              const start = u.view.coordsAtPos(img.from);
              if (c) setImagePopup({ ...img, at: { left: start && start.top === c.top ? start.left : c.left - 40, top: c.bottom + 6 } });
            });
          } else {
            if (popupRef.current && (sel.head < popupRef.current.from || sel.head > popupRef.current.to)) setPopup(null);
            const ip = imagePopupRef.current;
            if (ip && (sel.head < ip.from || sel.head > ip.to)) setImagePopup(null);
            if (clicked && sel.empty) blocksRef.current.clicked(u.view, u.state.doc.lineAt(sel.head).number - 1);
          }
        }
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
    const onScroll = () => {
      requestAnimationFrame(syncScroll);
      if (popupRef.current) setPopup(null);
      if (imagePopupRef.current) setImagePopup(null);
      blocksRef.current.closePopup();
    };
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

  // What the editor needs to know about the project's pages; refreshed when they change.
  const env = useMemo<LinkEnv>(
    () => ({
      names: wiki.names,
      categories: wiki.categories,
      sections: (id) => api.pageSections(wiki.project, id),
      open: (link) => {
        const cat = categoryOf(link.page);
        if (cat !== null) return wiki.categories.resolve(cat) ? wiki.openCategory(cat) : wiki.createCategory(cat);
        const target = link.page ? wiki.names.resolve(link.page) : null;
        if (!link.page || target?.page.id === pageId) {
          if (previewRef.current) scrollToSection(previewRef.current, link.section);
        } else if (target) {
          wiki.follow({ pageId: target.page.id, section: link.section, via: target.via ?? null });
        } else {
          wiki.createFromLink(link.page, pageId);
        }
      },
    }),
    [wiki, pageId],
  );
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setLinkEnv.of(env) });
  }, [env]);

  // Galleries, quote boxes and embeds: their dialogs and the embed popup.
  const blocks = useBlockDialogs(viewRef, pageId, (call) => env.open({ page: call.page, section: call.section, label: null, suffix: "" }));
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  /** Inserts images at `at` (default: replacing the selection); a single one opens its popup. */
  insertImagesRef.current = (files, at) => {
    const view = viewRef.current;
    if (!view || !files.length) return;
    const sel = view.state.selection.main;
    const from = at ?? sel.from;
    const to = at ?? sel.to;
    const inTable = inTableAt(view.state, from);
    const insert = files.map((f) => imageSource(newImage(f), inTable)).join(" ");
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.image",
      scrollIntoView: true,
    });
    view.focus();
    if (files.length === 1) {
      requestAnimationFrame(() => {
        const c = view.coordsAtPos(from);
        if (c) setImagePopup({ from, to: from + insert.length, image: newImage(files[0]), at: { left: c.left, top: c.bottom + 6 } });
      });
    }
  };

  pasteImagesRef.current = (files) => {
    void (async () => {
      try {
        const names: string[] = [];
        for (const f of files) names.push(await api.importImageData(wiki.project, f.name || "image.png", new Uint8Array(await f.arrayBuffer())));
        insertImagesRef.current(names);
      } catch (e) {
        report(`Couldn't add the image: ${errorText(e)}`);
      }
    })();
  };

  async function chooseImages() {
    try {
      insertImagesRef.current(await chooseTextImages(wiki.project, true));
    } catch (e) {
      report(`Couldn't add the image: ${errorText(e)}`);
    }
  }

  // Image files dropped on the text go where they were dropped.
  useFileDrop(
    hostRef,
    (paths, at) => {
      const view = viewRef.current;
      if (!view) return;
      const images = paths.filter((p) => hasExtension(p, TEXT_IMAGE_EXTENSIONS));
      if (images.length < paths.length) report("Only PNG, JPG, GIF, WebP and SVG images can be added.");
      if (!images.length) return;
      const pos = view.posAtCoords(at) ?? view.state.selection.main.head;
      void Promise.all(images.map((p) => api.importImage(wiki.project, p, true))).then(
        (files) => insertImagesRef.current(files, pos),
        (e) => report(`Couldn't add the image: ${errorText(e)}`),
      );
    },
    tab === "text",
  );

  const embedEnv = useEmbedEnv(text, currentCategory !== undefined ? `category:${currentCategory}` : pageId);
  const textHtml = useMemo(() => renderWithEmbeds(text, { lineAnchors: true, links }, embedEnv).html, [text, links, embedEnv]);
  const boxHtml = useMemo(
    () => infoboxHtml(infobox, { project: wiki.project, title, links, relations, presentDay: wiki.settings.presentDay, showEmpty: true, frame: frameFor(wiki, infobox?.template) }),
    [infobox, wiki, title, links, relations],
  );
  const html = boxHtml + textHtml;
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
  }, [html, previewHidden, split, loads]);

  // Images change the preview's height as they load: measure again.
  useEffect(() => {
    const pv = previewRef.current;
    if (!pv) return;
    let frame = 0;
    const loaded = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLoads((n) => n + 1));
    };
    pv.addEventListener("load", loaded, true);
    return () => {
      cancelAnimationFrame(frame);
      pv.removeEventListener("load", loaded, true);
    };
  }, [previewHidden]);

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

  function showTab(t: Tab) {
    setTab(t);
    if (t === "text") requestAnimationFrame(() => viewRef.current?.focus());
  }

  return (
    <div className="split-editor">
      <div className="toolbar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => e.preventDefault()}>
        <div className="tabs" role="tablist" aria-label="Edit">
          <button role="tab" aria-selected={tab === "text"} className={`tab ${tab === "text" ? "active" : ""}`} onClick={() => showTab("text")}>
            Text
          </button>
          {!noInfobox && (
            <button
              role="tab"
              aria-selected={tab === "infobox"}
              className={`tab ${tab === "infobox" ? "active" : ""}`}
              onClick={() => showTab("infobox")}
            >
              Infobox
            </button>
          )}
        </div>
        <span className="toolbar-sep" />
        {tab === "text" && TOOLS.map((tool, i) =>
          tool === "|" ? (
            <span key={i} className="toolbar-sep" />
          ) : (
            <button
              key={tool.id}
              className={`tool ${tool.active?.(formats) ? "active" : ""}`}
              title={tool.title}
              aria-label={tool.title}
              aria-pressed={tool.active ? tool.active(formats) : undefined}
              onClick={() =>
                tool.id === "table"
                  ? setTableOpen(true)
                  : tool.id === "link"
                    ? openLinkPickerRef.current()
                    : tool.id === "image"
                      ? void chooseImages()
                      : tool.id === "gallery" || tool.id === "embed" || tool.id === "quotebox"
                        ? blocks.open(tool.id)
                        : run(tool.run)
              }
            >
              {tool.label}
            </button>
          ),
        )}
        {tab === "text" && (
          <>
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
          </>
        )}
        <div className="spacer" />
        <button className={`tool wide ${previewHidden ? "" : "active"}`} title="Show or hide the preview" onClick={togglePreview}>
          Preview
        </button>
      </div>

      <div className="split" ref={splitRef}>
        <div className="split-source" style={{ flexBasis: previewHidden ? "100%" : `${split * 100}%` }}>
          {/* The text editor stays mounted while the Infobox tab is open, so its undo history survives. */}
          <div className="split-source-text" ref={hostRef} hidden={tab !== "text"} />
          {tab === "infobox" && (
            <InfoboxForm
              pageId={pageId}
              pageTitle={title}
              infobox={infobox}
              error={infoboxError}
              templates={wiki.templates}
              relations={relations}
              onRelationsChanged={onRelationsChanged}
              onChange={onInfoboxChange}
            />
          )}
        </div>
        {!previewHidden && (
          <>
            <div className="split-divider" onPointerDown={startDrag} title="Drag to resize" />
            <div className="split-preview" ref={previewRef}>
              <div className="markdown" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
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

      {popup && (
        <LinkPopup
          key={`${popup.from}-${popup.to}`}
          link={popup.link}
          names={wiki.names}
          at={popup.at}
          close={() => {
            setPopup(null);
            viewRef.current?.focus();
          }}
          apply={(target, shown) => {
            const view = viewRef.current;
            setPopup(null);
            if (!view) return;
            const inTable = /^\s*\|/.test(view.state.doc.lineAt(popup.from).text);
            const insert = editedLink(popup.link, target, shown, inTable);
            view.dispatch({
              changes: { from: popup.from, to: popup.to, insert },
              selection: { anchor: popup.from + insert.length },
              userEvent: "input.link",
            });
            view.focus();
          }}
          unlink={() => {
            const view = viewRef.current;
            setPopup(null);
            if (!view) return;
            const insert = shownText(popup.link);
            view.dispatch({
              changes: { from: popup.from, to: popup.to, insert },
              selection: { anchor: popup.from + insert.length },
              userEvent: "input.link",
            });
            view.focus();
          }}
          open={(target) => {
            setPopup(null);
            const hash = target.indexOf("#");
            env.open({
              page: (hash < 0 ? target : target.slice(0, hash)).trim(),
              section: hash < 0 ? null : target.slice(hash + 1).trim() || null,
              label: null,
              suffix: "",
            });
          }}
        />
      )}

      {imagePopup && (
        <ImagePopup
          key={`${imagePopup.from}`}
          image={imagePopup.image}
          pageId={pageId}
          at={imagePopup.at}
          change={(img) => {
            const view = viewRef.current;
            const p = imagePopupRef.current;
            if (!view || !p) return;
            const insert = imageSource(img, inTableAt(view.state, p.from));
            view.dispatch({ changes: { from: p.from, to: p.to, insert }, userEvent: "input.image" });
            const next = { ...p, to: p.from + insert.length, image: img };
            imagePopupRef.current = next;
            setImagePopup(next);
          }}
          remove={() => {
            const view = viewRef.current;
            const p = imagePopupRef.current;
            setImagePopup(null);
            if (!view || !p) return;
            // Take a space next to it along, so no double space is left.
            const after = view.state.sliceDoc(p.to, p.to + 1) === " " ? 1 : 0;
            view.dispatch({ changes: { from: p.from, to: p.to + after }, selection: { anchor: p.from }, userEvent: "delete.image" });
            view.focus();
          }}
          close={() => {
            setImagePopup(null);
            viewRef.current?.focus();
          }}
        />
      )}


      {blocks.elements}

      {linkPicker && (
        <PagePicker
          names={wiki.names}
          label="Link to page"
          placeholder="Type a page title or alias…"
          initialQuery={linkPicker.query}
          allowNew
          onPick={(p) => {
            const view = viewRef.current;
            if (view) insertLink(view, "entry" in p ? p.entry.name : p.newTitle);
          }}
          close={() => {
            setLinkPicker(null);
            viewRef.current?.focus();
          }}
        />
      )}

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
