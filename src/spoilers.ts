// Spoilers: `||hidden text||` (Discord-style), images and galleries marked
// "spoiler", and infobox fields with the Spoiler toggle. Hidden until clicked;
// a click reveals one spoiler until the page is left. "Reveal spoilers" in the
// page header shows all of a page's spoilers; the global switch (eye in the
// sidebar) shows them everywhere and is remembered on this computer only.
// The editor preview always shows them, marked. The Rust side
// (src-tauri/src/wikilinks.rs) finds spoilers with the same rule.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { EditorSelection, type ChangeSpec, type StateCommand } from "@codemirror/state";

/**
 * A spoiler at the start of a string: `||`, a first character that isn't
 * `|` or a space, and the shortest text up to `||` that doesn't end in `\`.
 * One line only.
 */
export const SPOILER_AT_START = /^\|\|([^|\s](?:[^\n]*?[^\\\n])??)\|\|/;
/** In table rows the `|` is written `\|`. */
const TABLE_SPOILER = /\\\|\\\|((?:(?!\\\|\\\|)[^\n])+?)\\\|\\\|/g;
const SPOILER = new RegExp(SPOILER_AT_START.source.slice(1), "g");

/** Spoilers in one source line: where each starts and ends (markers included). */
export function spoilerRanges(line: string, inTable = false): { from: number; to: number; marker: number }[] {
  const re = inTable ? TABLE_SPOILER : SPOILER;
  re.lastIndex = 0;
  const out = [];
  for (let m = re.exec(line); m; m = re.exec(line)) out.push({ from: m.index, to: m.index + m[0].length, marker: inTable ? 4 : 2 });
  return out;
}

const isTableRow = (text: string) => /^\s*\|/.test(text);

/**
 * Toolbar / Cmd+Shift+S: hides the selection as a spoiler, or unhides the
 * spoiler the cursor is in. Like bold, each selected line is wrapped on its
 * own (a spoiler never spans lines); with no selection the word at the cursor.
 */
export const toggleSpoiler: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const inTable = isTableRow(line.text);
    const mark = inTable ? "\\|\\|" : "||";
    const len = mark.length;
    // Inside a spoiler (on one line): remove its markers.
    const s = spoilerRanges(line.text, inTable).find(
      (r) => line.from + r.from <= range.from && range.to <= line.from + r.to && (range.from !== range.to || (line.from + r.from < range.from && range.to < line.from + r.to)),
    );
    if (s) {
      const from = line.from + s.from;
      const to = line.from + s.to;
      const map = (p: number) => Math.max(from, Math.min(p - len, to - 2 * len));
      return {
        changes: [
          { from, to: from + len },
          { from: to - len, to },
        ],
        range: EditorSelection.range(map(range.anchor), map(range.head)),
      };
    }
    if (range.empty) {
      const word = state.wordAt(range.head);
      if (word) {
        return {
          changes: [
            { from: word.from, insert: mark },
            { from: word.to, insert: mark },
          ],
          range: EditorSelection.cursor(range.head + len),
        };
      }
      return { changes: { from: range.head, insert: mark + mark }, range: EditorSelection.cursor(range.head + len) };
    }
    const changes: ChangeSpec[] = [];
    let first = -1;
    let last = -1;
    for (let pos = range.from; pos <= range.to; ) {
      const l = state.doc.lineAt(pos);
      const m = isTableRow(l.text) ? "\\|\\|" : "||";
      const start = Math.max(range.from, l.from);
      const end = Math.min(range.to, l.to);
      const text = state.sliceDoc(start, end);
      const from = start + (text.length - text.trimStart().length);
      const to = end - (text.length - text.trimEnd().length);
      if (from < to) {
        changes.push({ from, insert: m }, { from: to, insert: m });
        // Select the hidden text, in positions after the insertions.
        if (first < 0) first = from + m.length;
        last = to + (changes.length - 1) * m.length;
      }
      pos = l.to + 1;
    }
    if (!changes.length) return { range };
    return { changes, range: EditorSelection.range(first, last) };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

// ---- revealing ----

const REVEAL_KEY = "ownwiki.revealSpoilers";

/** Is `el` inside a spoiler that is hidden right now? */
export function isHiddenSpoiler(el: Element): boolean {
  const s = el.closest(".spoiler:not(.revealed)");
  return !!s && !s.closest(".reveal-spoilers, .split-preview");
}

/** The key that remembers one spoiler: its own (headings and their Contents
 * entries share one), else its place among the others. */
function keyOf(el: HTMLElement, root: Element): string {
  if (el.dataset.sp) return el.dataset.sp;
  return `i:${[...root.querySelectorAll(".spoiler:not([data-sp])")].indexOf(el)}`;
}

function apply(root: Element, revealed: Set<string>) {
  if (!revealed.size) return;
  for (const el of root.querySelectorAll<HTMLElement>(".spoiler")) {
    el.classList.toggle("revealed", revealed.has(keyOf(el, root)));
  }
}

/**
 * Clicking a hidden spoiler inside `ref` reveals it (and doesn't follow a
 * link in it). Remembered while the component lives, i.e. until the page is
 * left, also when the page re-renders.
 */
export function useSpoilerReveal(ref: RefObject<HTMLElement | null>) {
  const revealed = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (ref.current) apply(ref.current, revealed.current);
  });
  return useCallback(
    (e: React.MouseEvent) => {
      const root = ref.current;
      const el = (e.target as Element).closest<HTMLElement>(".spoiler");
      if (!root || !el || !isHiddenSpoiler(el)) return;
      e.preventDefault();
      e.stopPropagation();
      revealed.current.add(keyOf(el, root));
      apply(root, revealed.current);
    },
    [ref],
  );
}

function loadGlobal(): boolean {
  try {
    return localStorage.getItem(REVEAL_KEY) === "1";
  } catch {
    return false;
  }
}

/** The global "show all spoilers" switch, remembered on this computer. */
export function useGlobalReveal(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadGlobal);
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(REVEAL_KEY, v ? "1" : "0");
    } catch {
      // Not remembering it is harmless.
    }
  }, []);
  return [on, set];
}

/** Does rendered HTML contain a spoiler? */
export const hasSpoilers = (html: string) => /class="[^"]*\bspoiler\b/.test(html);
