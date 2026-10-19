// Contents panel at the left of the read view (AWOIAF-style): stays in place
// while the page scrolls, highlights the section being read, and sections with
// subsections fold open and closed.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { handleContentClick } from "./links";
import { partsHtml, type TocEntry } from "./markdown";

interface Props {
  toc: TocEntry[];
  /** The scrolling read view that holds the page text. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Where folded sections are remembered (this computer only). */
  storageKey: string;
}

/** A heading counts as "being read" once its top is this close to the top. */
const ACTIVE_OFFSET = 80;

function loadCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function TocPanel({ toc, scrollRef, storageKey }: Props) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(storageKey));
  const [active, setActive] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Parent of each entry (index into toc, -1 = top level) and which have children.
  const { parents, hasChildren } = useMemo(() => {
    const parents: number[] = [];
    const hasChildren = new Set<number>();
    const stack: number[] = [];
    toc.forEach((e, i) => {
      while (stack.length && toc[stack[stack.length - 1]].depth >= e.depth) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : -1;
      parents.push(parent);
      if (parent >= 0) hasChildren.add(parent);
      stack.push(i);
    });
    return { parents, hasChildren };
  }, [toc]);

  /** The entry shown for `i`: itself, or its nearest ancestor that isn't folded away. */
  const visibleFor = useCallback(
    (i: number) => {
      let shown = i;
      for (let p = parents[i]; p >= 0; p = parents[p]) if (collapsed.has(toc[p].id)) shown = p;
      return shown;
    },
    [parents, collapsed, toc],
  );

  const updateActive = useCallback(() => {
    const view = scrollRef.current;
    if (!view) return;
    const top = view.getBoundingClientRect().top + ACTIVE_OFFSET;
    let current: string | null = null;
    // At the very bottom the last sections may never reach the top: use the last one.
    const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 2 && view.scrollTop > 0;
    for (const e of toc) {
      const h = view.ownerDocument.getElementById(e.id);
      if (!h) continue;
      if (atBottom || h.getBoundingClientRect().top <= top) current = e.id;
      else break;
    }
    setActive(current);
  }, [scrollRef, toc]);

  useEffect(() => {
    const view = scrollRef.current;
    if (!view) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    };
    updateActive();
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, updateActive]);

  const activeIndex = active === null ? -1 : toc.findIndex((e) => e.id === active);
  const highlighted = activeIndex < 0 ? null : toc[visibleFor(activeIndex)].id;

  // Keep the highlighted entry in view inside the panel (without moving the page).
  useEffect(() => {
    const panel = panelRef.current;
    const item = panel?.querySelector<HTMLElement>(".toc-left-item.active");
    if (!panel || !item) return;
    const p = panel.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.top < p.top + 40) panel.scrollTop -= p.top + 40 - r.top;
    else if (r.bottom > p.bottom - 12) panel.scrollTop += r.bottom - (p.bottom - 12);
  }, [highlighted]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Not remembering folded sections is harmless.
      }
      return next;
    });
  }

  return (
    <nav className="toc-left" ref={panelRef} aria-label="Contents" onClick={handleContentClick}>
      <div className="toc-left-title">Contents</div>
      <ol>
        {toc.map((e, i) => {
          if (visibleFor(i) !== i) return null;
          const folded = collapsed.has(e.id);
          return (
            <li
              key={e.id}
              className={`toc-left-item toc-depth-${Math.min(e.depth, 5)} ${highlighted === e.id ? "active" : ""}`}
            >
              <a href={`#${encodeURIComponent(e.id)}`}>
                <span className="toc-number">{e.number}</span>{" "}
                {e.parts.some((p) => p.spoiler) ? <span dangerouslySetInnerHTML={{ __html: partsHtml(e) }} /> : e.text}
              </a>
              {hasChildren.has(i) && (
                <button
                  className={`toc-fold ${folded ? "folded" : ""}`}
                  aria-label={folded ? `Show subsections of ${e.text}` : `Hide subsections of ${e.text}`}
                  aria-expanded={!folded}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggle(e.id);
                  }}
                >
                  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                    <path d="M2 3.5 5 6.5 8 3.5" />
                  </svg>
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
