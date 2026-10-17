// Cmd+O / Ctrl+O: find a page by title and open it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageInfo } from "./api";
import { displayGroup, searchTitles } from "./tree";

interface Props {
  pages: Iterable<PageInfo>;
  onOpen: (id: string) => void;
  close: () => void;
}

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const QUICK_OPEN_KEYS = IS_MAC ? "⌘O" : "Ctrl+O";

export function isQuickOpenKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "o";
}

export function QuickOpen({ pages, onOpen, close }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => searchTitles(pages, query), [pages, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(i: number) {
    const page = results[i];
    if (!page) return;
    close();
    onOpen(page.id);
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog quick-open" role="dialog" aria-label="Open page">
        <input
          ref={inputRef}
          className="quick-input"
          placeholder="Type a page title…"
          value={query}
          spellCheck={false}
          aria-label="Page title"
          aria-controls="quick-results"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            }
          }}
        />
        {query.trim() && (
          <ul id="quick-results" ref={listRef} className="quick-results" role="listbox">
            {results.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                <span className="quick-title">{p.title}</span>
                {p.group && <span className="quick-group">{displayGroup(p.group)}</span>}
              </li>
            ))}
            {results.length === 0 && <li className="empty small">No page with that title.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
