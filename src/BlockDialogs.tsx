// Blocks of the page editor that are edited in a dialog rather than typed:
// galleries, quote boxes, embeds and page lists. The toolbar opens a dialog for a new one;
// clicking one in the source opens its dialog (an embed first shows a small
// popup: Open, Change, Remove).
import { useState, type RefObject } from "react";
import type { StateCommand } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EmbedDialog, EmbedPopup } from "./EmbedDialog";
import { embedOnLine, embedSource, type EmbedCall } from "./embedSyntax";
import { insertBlock } from "./formatting";
import { GalleryDialog } from "./GalleryDialog";
import { GALLERY_OPEN, galleryAround, gallerySource, parseGallery, type GalleryItem } from "./images";
import { QuoteDialog } from "./QuoteDialog";
import { PageListDialog } from "./PageListDialog";
import { pageListOnLine, pageListSource, type PageListCall } from "./pageLists";
import { parseQuote, quoteAround, quoteSource, type Quote } from "./quotes";

/** Lines of the source (0-based, first and last). */
type Range = { start: number; end: number };

export function useBlockDialogs(viewRef: RefObject<EditorView | null>, pageId: string, openPage: (call: EmbedCall) => void) {
  // A new block (range null) or the one on lines `range`.
  const [gallery, setGallery] = useState<{ range: Range | null; items: GalleryItem[]; spoiler: boolean } | null>(null);
  const [quote, setQuote] = useState<{ range: Range | null; quote: Quote } | null>(null);
  const [embedDialog, setEmbedDialog] = useState<{ line: number | null; call: EmbedCall | null } | null>(null);
  const [pageList, setPageList] = useState<{ line: number | null; call: PageListCall | null } | null>(null);
  // The popup after clicking an embed line.
  const [embedPopup, setEmbedPopup] = useState<{ line: number; call: EmbedCall; at: { left: number; top: number } } | null>(null);

  const focus = () => viewRef.current?.focus();

  /** Puts a block into the text: new at the cursor, or replacing the lines
   * `range`; `null` removes the block on `range`. */
  function write(range: Range | null, source: string | null) {
    const view = viewRef.current;
    if (!view) return;
    if (!range) {
      if (source) (insertBlock(source) as StateCommand)({ state: view.state, dispatch: view.dispatch });
    } else {
      const doc = view.state.doc;
      const from = doc.line(range.start + 1).from;
      let to = doc.line(range.end + 1).to;
      if (source === null && to < doc.length) to++; // removing: take its line break too
      const insert = source ?? "";
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.block", scrollIntoView: true });
    }
    view.focus();
  }

  /** The line `n` (0-based) was clicked: open what's there. */
  function clicked(view: EditorView, n: number) {
    const lines = view.state.doc.toString().split("\n");
    setEmbedPopup(null);
    const g = galleryAround(lines, n);
    if (g) {
      const spoiler = !!GALLERY_OPEN.exec(lines[g.start])?.[1];
      return setGallery({ range: g, items: parseGallery(lines.slice(g.start + 1, g.end)), spoiler });
    }
    const q = quoteAround(lines, n);
    if (q) return setQuote({ range: q, quote: parseQuote(lines.slice(q.start + 1, q.end)) });
    const list = pageListOnLine(lines[n]);
    if (list) return setPageList({ line: n, call: list });
    const call = embedOnLine(lines[n]);
    if (call) {
      requestAnimationFrame(() => {
        const c = view.coordsAtPos(view.state.doc.line(n + 1).from);
        if (c) setEmbedPopup({ line: n, call, at: { left: c.left, top: c.bottom + 6 } });
      });
    }
  }

  function open(kind: "gallery" | "embed" | "quotebox" | "pagelist") {
    if (kind === "gallery") setGallery({ range: null, items: [], spoiler: false });
    else if (kind === "pagelist") setPageList({ line: null, call: null });
    else if (kind === "embed") setEmbedDialog({ line: null, call: null });
    else setQuote({ range: null, quote: { text: "", by: "", source: "" } });
  }

  const elements = (
    <>
      {gallery && (
        <GalleryDialog
          pageId={pageId}
          initial={gallery.range ? gallery.items : undefined}
          initialSpoiler={gallery.spoiler}
          save={(items, spoiler) => {
            setGallery(null);
            write(gallery.range, gallerySource(items, spoiler));
          }}
          remove={
            gallery.range
              ? () => {
                  setGallery(null);
                  write(gallery.range, null);
                }
              : undefined
          }
          close={() => {
            setGallery(null);
            focus();
          }}
        />
      )}

      {quote && (
        <QuoteDialog
          pageId={pageId}
          initial={quote.quote}
          isNew={!quote.range}
          save={(q) => {
            setQuote(null);
            write(quote.range, quoteSource(q));
          }}
          remove={
            quote.range
              ? () => {
                  setQuote(null);
                  write(quote.range, null);
                }
              : undefined
          }
          close={() => {
            setQuote(null);
            focus();
          }}
        />
      )}

      {embedPopup && (
        <EmbedPopup
          key={embedPopup.line}
          call={embedPopup.call}
          at={embedPopup.at}
          open={() => {
            setEmbedPopup(null);
            openPage(embedPopup.call);
          }}
          change={() => {
            setEmbedPopup(null);
            setEmbedDialog({ line: embedPopup.line, call: embedPopup.call });
          }}
          remove={() => {
            setEmbedPopup(null);
            write({ start: embedPopup.line, end: embedPopup.line }, null);
          }}
          close={() => {
            setEmbedPopup(null);
            focus();
          }}
        />
      )}

      {pageList && (
        <PageListDialog
          initial={pageList.call}
          save={(call) => {
            setPageList(null);
            write(pageList.line === null ? null : { start: pageList.line, end: pageList.line }, pageListSource(call));
          }}
          remove={
            pageList.line !== null
              ? () => {
                  setPageList(null);
                  write({ start: pageList.line!, end: pageList.line! }, null);
                }
              : undefined
          }
          close={() => {
            setPageList(null);
            focus();
          }}
        />
      )}

      {embedDialog && (
        <EmbedDialog
          initial={embedDialog.call}
          save={(call) => {
            setEmbedDialog(null);
            write(embedDialog.line === null ? null : { start: embedDialog.line, end: embedDialog.line }, embedSource(call));
          }}
          close={() => {
            setEmbedDialog(null);
            focus();
          }}
        />
      )}
    </>
  );

  return { clicked, open, closePopup: () => setEmbedPopup(null), elements };
}
