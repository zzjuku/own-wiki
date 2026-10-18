// Hover previews: resting the mouse on a page link (read view or editor
// preview) for a moment shows a card with the page's title, group and
// opening paragraph (for section links: the start of that section). Links
// inside a card don't open further cards.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CategoryPreview, type Preview } from "./api";
import { imageUrl } from "./infobox";
import { renderSnippet } from "./markdown";
import { displayGroup } from "./tree";
import { useContentClick, useWiki } from "./wiki";

export const HOVER_DELAY_MS = 400;
const HIDE_DELAY_MS = 250;
const CARD_GAP = 6;

interface Card {
  /** The link's position on screen. */
  rect: DOMRect;
  /** null: the page doesn't exist. */
  preview: Preview | null;
  missingTitle?: string;
  pageId?: string;
  /** A [[Category:…]] link. */
  category?: CategoryPreview;
}

const LINK_SELECTOR = ".read-view .markdown a.wikilink, .split-preview .markdown a.wikilink";

export function HoverCards() {
  const wiki = useWiki();
  const [card, setCard] = useState<Card | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = useRef<HTMLAnchorElement | null>(null);
  const project = wiki.project;
  const onClick = useContentClick(card?.pageId);

  useEffect(() => {
    const cancelHide = () => clearTimeout(hideTimer.current);
    const hideSoon = () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        current.current = null;
        setCard(null);
      }, HIDE_DELAY_MS);
    };

    const over = (e: MouseEvent) => {
      const el = e.target as Element;
      if (cardRef.current?.contains(el)) return cancelHide();
      const a = el.closest<HTMLAnchorElement>(LINK_SELECTOR);
      if (!a) return;
      cancelHide();
      if (a === current.current) return;
      current.current = a;
      clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => {
        const rect = a.getBoundingClientRect();
        if (a.dataset.category !== undefined) {
          api.categoryPreview(project, a.dataset.category).then(
            (category) => current.current === a && setCard({ rect, preview: null, category }),
            () => {},
          );
          return;
        }
        if (a.classList.contains("new")) {
          setCard({ rect, preview: null, missingTitle: a.dataset.target ?? "" });
          return;
        }
        const pageId = a.dataset.page;
        if (!pageId) return;
        api.linkPreview(project, pageId, a.dataset.section ?? null).then(
          (preview) => current.current === a && setCard({ rect, preview, pageId }),
          () => {},
        );
      }, HOVER_DELAY_MS);
    };

    const out = (e: MouseEvent) => {
      const el = e.target as Element;
      const to = e.relatedTarget as Element | null;
      const fromLink = el.closest(LINK_SELECTOR);
      const fromCard = cardRef.current?.contains(el);
      if (!fromLink && !fromCard) return;
      if (to && (cardRef.current?.contains(to) || (current.current && current.current.contains(to)))) return;
      hideSoon();
    };

    const reset = () => {
      clearTimeout(showTimer.current);
      current.current = null;
      setCard(null);
    };

    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    // Scrolling, typing or clicking elsewhere closes the card.
    document.addEventListener("scroll", reset, true);
    document.addEventListener("keydown", reset);
    const down = (e: MouseEvent) => !cardRef.current?.contains(e.target as Node) && reset();
    document.addEventListener("mousedown", down);
    return () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("scroll", reset, true);
      document.removeEventListener("keydown", reset);
      document.removeEventListener("mousedown", down);
    };
  }, [project]);

  // Links in the card show their targets but don't open further cards.
  const links = useMemo(
    () => ({
      resolve: (n: string) => wiki.names.resolve(n),
      currentId: card?.pageId,
      image: (f: string, w?: number) => imageUrl(project, f, w),
      category: (n: string) => wiki.categories.resolve(n) !== null,
    }),
    [wiki.names, wiki.categories, card?.pageId, project],
  );
  const html = useMemo(() => {
    const text = card?.preview?.text ?? card?.category?.text;
    return text ? renderSnippet(text, links) : "";
  }, [card, links]);

  // Place the card under the link, or above it when there's no room below.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!card || !el) return setPos(null);
    const { rect } = card;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    const below = rect.bottom + CARD_GAP;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - CARD_GAP) : below;
    setPos({ left, top });
  }, [card, html]);

  if (!card) return null;
  const style = pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 };

  if (card.category) {
    const c = card.category;
    return (
      <div ref={cardRef} className={`hover-card ${c.exists ? "" : "missing"}`} style={style} role="tooltip">
        <div className="hover-card-body">
          <div className="hover-card-title">Category: {c.name}</div>
          {c.exists ? (
            <>
              <div className="hover-card-group">
                {c.pages === 1 ? "1 page" : `${c.pages.toLocaleString("en")} pages`}
                {c.subcategories > 0 && ` · ${c.subcategories === 1 ? "1 subcategory" : `${c.subcategories} subcategories`}`}
              </div>
              {html && <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />}
            </>
          ) : (
            <div>Category doesn't exist. Click the link to create it.</div>
          )}
        </div>
      </div>
    );
  }

  if (!card.preview) {
    return (
      <div ref={cardRef} className="hover-card missing" style={style} role="tooltip">
        <div className="hover-card-body">
          <div className="hover-card-title">{card.missingTitle}</div>
          <div>Page doesn't exist. Click the link to create it.</div>
        </div>
      </div>
    );
  }

  const p = card.preview;
  return (
    <div
      ref={cardRef}
      className="hover-card"
      style={style}
      role="tooltip"
      onClick={(e) => {
        onClick(e);
        if ((e.target as Element).closest("a")) setCard(null);
      }}
    >
      <div className="hover-card-body">
        <div className="hover-card-title">
          {p.title}
          {p.section && <> § {p.section}</>}
        </div>
        {p.group && <div className="hover-card-group">{displayGroup(p.group)}</div>}
        {html ? (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="hover-card-empty">{p.section ? "This section has no text yet." : "This page has no text yet."}</div>
        )}
      </div>
      <div className="hover-card-image">{p.image && <img src={imageUrl(project, p.image, 160)} alt="" />}</div>
    </div>
  );
}
