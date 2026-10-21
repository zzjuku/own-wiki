// Find on page (M10): a bar under the page header in the read view
// (Cmd+F / Ctrl+F, and when a search result opens a page). Matches are found
// with the search rules (src/search.ts: word starts, accents and case
// ignored, "phrases") in the page text and infobox, and in links' targets;
// hidden spoilers aren't matched until revealed. Matches are painted with the
// CSS Custom Highlight API, so the page's HTML is never changed.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { IS_MAC } from "./QuickOpen";
import { findInText, fold, parseQuery, wordMatches } from "./search";
import { isHiddenSpoiler } from "./spoilers";

/** Elements that start a new run of text (a match never spans them). */
const BLOCKS = new Set(
  "P LI TD TH DIV H1 H2 H3 H4 H5 H6 BLOCKQUOTE TR TABLE FIGCAPTION FIGURE DT DD UL OL SECTION ASIDE HEADER PRE CAPTION TBODY THEAD".split(" "),
);

interface Run {
  block: Element | null;
  text: string;
  pieces: { node: Text; start: number }[];
}

/** The point at offset `at` of a run (`end`: the end of a match). */
function pointAt(run: Run, at: number, end: boolean): [Text, number] | null {
  for (const p of run.pieces) {
    const len = p.node.data.length;
    if (end ? at > p.start && at <= p.start + len : at >= p.start && at < p.start + len) return [p.node, at - p.start];
  }
  return null;
}

/** Ranges matching `terms` inside `root`, in page order. */
export function findRanges(root: Element, terms: string[]): Range[] {
  if (!terms.length) return [];
  const runs: Run[] = [];
  let run: Run | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = n as Element;
      if (el.matches("style, script, .find-skip") || (el.classList.contains("spoiler") && isHiddenSpoiler(el))) return NodeFilter.FILTER_REJECT;
      return el.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const blockOf = (n: Node) => {
    let el = n.parentElement;
    while (el && el !== root && !BLOCKS.has(el.tagName)) el = el.parentElement;
    return el;
  };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType !== Node.TEXT_NODE) {
      if (run) run.text += " ";
      continue;
    }
    const block = blockOf(n);
    if (!run || run.block !== block) {
      run = { block, text: "", pieces: [] };
      runs.push(run);
    }
    run.pieces.push({ node: n as Text, start: run.text.length });
    run.text += (n as Text).data;
  }
  const ranges: Range[] = [];
  for (const r of runs) {
    for (const [a, b] of findInText(r.text, terms)) {
      const start = pointAt(r, a, false);
      const end = pointAt(r, b, true);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      ranges.push(range);
    }
  }
  // A link matches by the page it points to too: its whole text is marked.
  for (const a of root.querySelectorAll<HTMLElement>("a[data-target]")) {
    if (isHiddenSpoiler(a) || !a.textContent?.trim()) continue;
    const target = fold(a.dataset.target ?? "");
    const shown = fold(a.textContent);
    if (!terms.some((t) => wordMatches(target, t).length && !wordMatches(shown, t).length)) continue;
    if (ranges.some((r) => a.contains(r.startContainer))) continue;
    const range = document.createRange();
    range.selectNodeContents(a);
    ranges.push(range);
  }
  return ranges.sort((x, y) => x.compareBoundaryPoints(Range.START_TO_START, y));
}

const highlights = () => (typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null);

function paint(ranges: Range[], current: number) {
  const h = highlights();
  if (!h) return;
  h.set("find", new Highlight(...ranges));
  h.set("find-current", new Highlight(...(ranges[current] ? [ranges[current]] : [])));
}

function unpaint() {
  highlights()?.delete("find");
  highlights()?.delete("find-current");
}

/** Scrolls `scroller` so the range sits a third of the way down. */
function scrollToRange(range: Range, scroller: HTMLElement | null) {
  const rect = range.getBoundingClientRect();
  if (!scroller) return range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  const box = scroller.getBoundingClientRect();
  if (rect.top >= box.top + 40 && rect.bottom <= box.bottom - 40) return;
  scroller.scrollTop += rect.top - box.top - scroller.clientHeight / 3;
}

/** The find bar of a read view: Cmd+F / Ctrl+F opens it (not while editing:
 * the editor has its own find). `show` opens it with a query. */
export function useFindBar(editing: boolean) {
  const [find, setFind] = useState<{ query: string; key: number } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(IS_MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      if (editingRef.current || document.querySelector(".backdrop")) return;
      e.preventDefault();
      setFind((f) => ({ query: f?.query ?? window.getSelection()?.toString().trim() ?? "", key: Date.now() }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Editing closes it (the page may be different when reading again).
  useEffect(() => {
    if (editing) setFind(null);
  }, [editing]);
  const show = useCallback((query: string) => setFind({ query, key: Date.now() }), []);
  const close = useCallback(() => setFind(null), []);
  return { find: editing ? null : find, show, close };
}

export function FindBar({
  root,
  scroller,
  initial,
  focusKey,
  onClose,
}: {
  /** Where to find (the page's text and infobox). */
  root: RefObject<HTMLElement | null>;
  /** What scrolls (the read view). */
  scroller: RefObject<HTMLElement | null>;
  initial: string;
  /** Changes when the bar should take the focus again (Cmd+F while open). */
  focusKey: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initial);
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const ranges = useRef<Range[]>([]);
  const currentRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const terms = parseQuery(query).join("\n");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  const go = useCallback(
    (i: number, scroll = true) => {
      const n = ranges.current.length;
      const next = n ? ((i % n) + n) % n : 0;
      currentRef.current = next;
      setCurrent(next);
      paint(ranges.current, next);
      if (scroll && ranges.current[next]) scrollToRange(ranges.current[next], scroller.current);
    },
    [scroller],
  );

  // Find again when the query changes (scroll to the first match) and when
  // the page changes under the bar (an embed arrives, a spoiler is revealed).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const list = terms ? terms.split("\n") : [];
    const run = (first: boolean) => {
      ranges.current = findRanges(el, list);
      setCount(ranges.current.length);
      go(first ? 0 : Math.min(currentRef.current, Math.max(0, ranges.current.length - 1)), first);
    };
    run(true);
    let timer = 0;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => run(false), 50);
    });
    observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    // "Reveal spoilers" and the eye switch mark the page and the project.
    for (const outer of [el.closest(".page"), el.closest(".project")]) {
      if (outer) observer.observe(outer, { attributes: true, attributeFilter: ["class"] });
    }
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [terms, root, go]);

  useEffect(() => unpaint, []);

  return (
    <div className="find-bar" role="search" aria-label="Find on page">
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder="Find on page"
        aria-label="Find on page"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(currentRef.current + (e.shiftKey ? -1 : 1));
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {terms ? (count ? `${current + 1} of ${count}` : "No matches") : ""}
      </span>
      <button className="plain" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={!count} onClick={() => go(current - 1)}>
        ↑
      </button>
      <button className="plain" title="Next match (Enter)" aria-label="Next match" disabled={!count} onClick={() => go(current + 1)}>
        ↓
      </button>
      <button className="plain find-close" title="Close (Esc)" aria-label="Close find bar" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
