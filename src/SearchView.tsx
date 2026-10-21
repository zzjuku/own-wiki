// The Search screen (M10): full-text search across titles, aliases, page
// text, infobox values and category text (done in Rust, src-tauri/src/search.rs),
// results updating while typing, with group, category and template filters.
// Spoilers follow the global eye switch: off, spoiler text isn't searched and
// snippets leave it out. Opening a result shows the page with the find bar
// filled in; Back returns here with the same query.
import { useEffect, useRef, useState } from "react";
import { api, errorText, type SearchHit, type SearchPart, type SearchResults } from "./api";
import { IS_MAC } from "./QuickOpen";
import { findInText } from "./search";
import { compareNames, displayGroup, ROOT } from "./tree";
import { useWiki } from "./wiki";

export interface SearchState {
  query: string;
  /** Filters ("" = all): group id, category name, template id. */
  group: string;
  category: string;
  template: string;
}

export const NO_SEARCH: SearchState = { query: "", group: "", category: "", template: "" };

export const SEARCH_KEYS = IS_MAC ? "⌘⇧F" : "Ctrl+Shift+F";

export function isSearchKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey : e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
}

/** The last focus request the Search screen followed (it's remounted each time it opens). */
let handledFocus = 0;

/** Results shown at first; more on request. */
const PAGE = 100;
/** Wait this long after a key before searching (results still update while typing). */
const TYPING_DELAY = 60;

/** `text` with the parts matching `terms` marked. */
export function Marked({ text, terms }: { text: string; terms: string[] }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const [a, b] of findInText(text, terms)) {
    out.push(text.slice(last, a), <mark key={a}>{text.slice(a, b)}</mark>);
    last = b;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function Snippet({ parts }: { parts: SearchPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.spoiler && !p.text ? (
          <span key={i} className="search-spoiler-hidden" title="Spoiler (hidden while the eye switch is off)" />
        ) : p.spoiler ? (
          <span key={i} className="search-spoiler" title="Spoiler">
            {p.hit ? <mark>{p.text}</mark> : p.text}
          </span>
        ) : p.hit ? (
          <mark key={i}>{p.text}</mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : word.endsWith("h") ? "es" : "s"}`;

export function SearchView({
  state,
  setState,
  spoilers,
  focusKey,
  onOpen,
}: {
  state: SearchState;
  setState: (s: SearchState) => void;
  /** The global eye switch. */
  spoilers: boolean;
  /** Changes when the search box should take the focus. */
  focusKey: number;
  onOpen: (hit: SearchHit) => void;
}) {
  const wiki = useWiki();
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Cmd+Shift+F selects the query (to type a new one); arriving by typing in
  // the sidebar's box keeps typing at the end.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (focusKey !== handledFocus) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    handledFocus = focusKey;
  }, [focusKey]);

  // Search while typing; an older answer arriving late is dropped.
  useEffect(() => {
    if (!state.query.trim()) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .search(wiki.project, {
          query: state.query,
          spoilers,
          group: state.group || null,
          category: state.category || null,
          template: state.template || null,
          limit,
        })
        .then(
          (r) => {
            if (!live) return;
            setResults(r);
            setError(null);
          },
          (e) => live && setError(errorText(e)),
        );
    }, TYPING_DELAY);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wiki.project, wiki.names, state, spoilers, limit]);

  const set = (patch: Partial<SearchState>) => {
    setLimit(PAGE);
    setState({ ...state, ...patch });
  };
  const groups = wiki.groupOptions.filter((g) => g.id !== ROOT);
  const templates = [...wiki.templates].sort((a, b) => compareNames(a.name, b.name));
  const filtered = !!(state.group || state.category || state.template);

  /** Up and down arrows move between the search box and the results. */
  function arrows(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".search-result") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = at + (e.key === "ArrowDown" ? 1 : -1);
    e.preventDefault();
    if (next < 0) inputRef.current?.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  }

  return (
    <div className="page search-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Search</h1>
        </div>
      </header>
      <div className="search-body" onKeyDown={arrows}>
        <div className="search-box">
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            value={state.query}
            placeholder={'Search pages… ("exact phrase")'}
            aria-label="Search"
            spellCheck={false}
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.hits[0]) onOpen(results.hits[0]);
            }}
          />
        </div>
        <div className="search-filters">
          <select aria-label="Group" value={state.group} onChange={(e) => set({ group: e.target.value })}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <select aria-label="Category" value={state.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All categories</option>
            {wiki.categories.list.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="Template" value={state.template} onChange={(e) => set({ template: e.target.value })}>
            <option value="">All templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {filtered && (
            <button className="plain search-clear-filters" onClick={() => set({ group: "", category: "", template: "" })}>
              Clear filters
            </button>
          )}
        </div>
        <p className="hint search-hint">
          {spoilers
            ? "Spoilers are searched too (the eye switch is on); they're marked in the results."
            : "Spoilers aren't searched while the eye switch in the sidebar is off."}
        </p>
        {error && <p className="dialog-error">{error}</p>}
        {!state.query.trim() ? (
          <p className="empty small search-empty">
            Searches titles, aliases, page text, infobox values and category text. Words match at their start (“Targ” finds
            Targaryen); all words must be on the page; use “quotes” for an exact phrase.
          </p>
        ) : results && results.hits.length === 0 ? (
          <p className="empty small search-empty">{results.terms.length ? "No pages match." : "Type a word to search for."}</p>
        ) : results ? (
          <>
            <p className="search-count muted small">{plural(results.total, "result")}</p>
            <ol className="search-results" ref={listRef}>
              {results.hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button className="plain search-result" onClick={() => onOpen(h)}>
                    <span className="search-result-head">
                      <span className="search-title">
                        {h.kind === "category" && <span className="muted">Category: </span>}
                        <Marked text={h.title} terms={results.terms} />
                      </span>
                      {h.group && <span className="search-group muted small">{displayGroup(h.group)}</span>}
                      <span className="spacer" />
                      <span className="search-matches muted small">{plural(h.count, "match")}</span>
                    </span>
                    {h.places.map((p, i) => (
                      <span key={i} className="search-place">
                        <span className="search-place-name">{p.place}</span>
                        <span className="search-snippet">
                          <Snippet parts={p.parts} />
                        </span>
                      </span>
                    ))}
                    {h.morePlaces > 0 && (
                      <span className="search-more-places muted small">
                        and {h.morePlaces} more {h.morePlaces === 1 ? "place" : "places"}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
            {results.total > results.hits.length && (
              <button className="search-show-more" onClick={() => setLimit(limit + PAGE)}>
                Show more ({(results.total - results.hits.length).toLocaleString("en")} left)
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
