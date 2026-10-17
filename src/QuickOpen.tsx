// Finding a page by name (title or alias): Cmd+O / Ctrl+O to open one, and
// the Link button / Cmd+K in the editor to link to one.
import { useEffect, useMemo, useRef, useState } from "react";
import type { NameEntry, NameIndex } from "./names";
import { displayGroup } from "./tree";
import { LINK_CHARS, norm } from "./wikilinks";

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const QUICK_OPEN_KEYS = IS_MAC ? "⌘O" : "Ctrl+O";

export function isQuickOpenKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "o";
}

/** What was picked: an existing page's name, or a title for a page that doesn't exist yet. */
export type Picked = { entry: NameEntry } | { newTitle: string };

interface PickerProps {
  names: NameIndex;
  label: string;
  placeholder: string;
  /** Text to start with (selected, so typing replaces it). */
  initialQuery?: string;
  /** Offer the typed text as a new page when no name matches it exactly. */
  allowNew?: boolean;
  onPick: (picked: Picked) => void;
  close: () => void;
}

export function PagePicker({ names, label, placeholder, initialQuery = "", allowNew, onPick, close }: PickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => names.search(query), [names, query]);
  const typed = query.trim();
  const offerNew =
    allowNew && typed !== "" && !LINK_CHARS.test(typed) && !results.some((e) => norm(e.name) === norm(typed));
  const count = results.length + (offerNew ? 1 : 0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(i: number) {
    if (i < results.length) {
      close();
      onPick({ entry: results[i] });
    } else if (offerNew) {
      close();
      onPick({ newTitle: typed });
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog quick-open" role="dialog" aria-label={label}>
        <input
          ref={inputRef}
          className="quick-input"
          placeholder={placeholder}
          value={query}
          spellCheck={false}
          aria-label={label}
          aria-controls="quick-results"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, count - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            }
          }}
        />
        {typed && (
          <ul id="quick-results" ref={listRef} className="quick-results" role="listbox">
            {results.map((e, i) => (
              <li
                key={`${e.page.id}\n${e.name}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseMove={() => setActive(i)}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(i);
                }}
              >
                <span className="quick-title">{e.name}</span>
                {e.alias && <span className="quick-alias">→ {e.page.title}</span>}
                {e.page.group && <span className="quick-group">{displayGroup(e.page.group)}</span>}
              </li>
            ))}
            {offerNew && (
              <li
                role="option"
                aria-selected={active === results.length}
                className={`quick-new ${active === results.length ? "active" : ""}`}
                onMouseMove={() => setActive(results.length)}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(results.length);
                }}
              >
                <span className="quick-title">{typed}</span>
                <span className="quick-group">new page (red link)</span>
              </li>
            )}
            {count === 0 && <li className="empty small">No page with that name.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export function QuickOpen({ names, onOpen, close }: { names: NameIndex; onOpen: (e: NameEntry) => void; close: () => void }) {
  return (
    <PagePicker
      names={names}
      label="Open page"
      placeholder="Type a page title or alias…"
      onPick={(p) => "entry" in p && onOpen(p.entry)}
      close={close}
    />
  );
}
