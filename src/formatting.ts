// Toolbar and shortcut actions for the Markdown editor. Each one is a
// CodeMirror command, so every action is a single undoable step.
import { EditorSelection, EditorState, type ChangeSpec, type StateCommand } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

// ---- inline formatting (bold, italic, strikethrough) ----

export type InlineKind = "bold" | "italic" | "strike";

const INLINE: Record<InlineKind, { mark: string; node: string }> = {
  bold: { mark: "**", node: "StrongEmphasis" },
  italic: { mark: "*", node: "Emphasis" },
  strike: { mark: "~~", node: "Strikethrough" },
};

function tree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

/** The innermost node named `name` that contains from..to. A bare cursor
 * must be strictly inside (not right after the closing marker). */
function enclosing(state: EditorState, name: string, from: number, to: number): SyntaxNode | null {
  for (let n: SyntaxNode | null = tree(state).resolveInner(from, 1); n; n = n.parent) {
    if (n.name !== name) continue;
    if (from === to ? n.from < from && to < n.to : n.from <= from && to <= n.to) return n;
  }
  return null;
}

/** Where a line's text starts, after heading / quote / list markers. */
function contentStart(text: string): number {
  const m = /^\s*(?:>\s?)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/.exec(text);
  return m ? m[0].length : 0;
}

export function toggleInline(kind: InlineKind): StateCommand {
  const { mark, node } = INLINE[kind];
  const len = mark.length;
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      // Already formatted: remove the markers around it.
      const n = enclosing(state, node, range.from, range.to);
      if (n) {
        const changes: ChangeSpec[] = [
          { from: n.from, to: n.from + len },
          { from: n.to - len, to: n.to },
        ];
        const map = (p: number) => Math.max(n.from, Math.min(p - len, n.to - 2 * len));
        return { changes, range: EditorSelection.range(map(range.anchor), map(range.head)) };
      }

      if (range.empty) {
        // Cursor in a word: format the word. Otherwise insert empty markers.
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
        return {
          changes: { from: range.head, insert: mark + mark },
          range: EditorSelection.cursor(range.head + len),
        };
      }

      // Selection: wrap each line's selected text separately (formatting can't
      // span paragraphs), leaving out surrounding spaces and line markers.
      const changes: ChangeSpec[] = [];
      let first = -1;
      let last = -1;
      for (let pos = range.from; pos <= range.to; ) {
        const line = state.doc.lineAt(pos);
        const start = Math.max(range.from, line.from + contentStart(line.text));
        const end = Math.min(range.to, line.to);
        const text = state.sliceDoc(start, end);
        const from = start + (text.length - text.trimStart().length);
        const to = end - (text.length - text.trimEnd().length);
        if (from < to && !enclosing(state, node, from, to)) {
          changes.push({ from, insert: mark }, { from: to, insert: mark });
          if (first < 0) first = from;
          last = to;
        }
        pos = line.to + 1;
      }
      if (!changes.length) return { range };
      const count = changes.length / 2;
      // Select the formatted text, without the outer markers.
      return { changes, range: EditorSelection.range(first + len, last + (2 * count - 1) * len) };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

// ---- line formatting (headings, lists, quotes) ----

const HEADING = /^(#{1,6})[ \t]+/;
const QUOTE = /^[ \t]*>[ \t]?/;
const BULLET = /^([ \t]*)[-*+][ \t]+/;
const ORDERED = /^([ \t]*)\d+[.)][ \t]+/;

function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const r of state.selection.ranges) {
    const end = r.to > r.from && state.doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to;
    for (let pos = r.from; pos <= end; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        lines.push(line);
      }
      pos = line.to + 1;
    }
  }
  return lines;
}

/** Replaces the start of each selected line in one undoable step. `edit`
 * returns how many characters to replace and with what, or null to skip. */
function editLines(
  state: EditorState,
  dispatch: (tr: ReturnType<EditorState["update"]>) => void,
  edit: (text: string, index: number) => { remove: number; insert: string } | null,
) {
  const changes: ChangeSpec[] = [];
  selectedLines(state).forEach((line, i) => {
    const e = edit(line.text, i);
    if (e && (e.remove || e.insert)) changes.push({ from: line.from, to: line.from + e.remove, insert: e.insert });
  });
  if (changes.length) {
    // Keep the cursor after markers added at its position.
    const set = state.changes(changes);
    dispatch(
      state.update({ changes: set, selection: state.selection.map(set, 1), scrollIntoView: true, userEvent: "input.format" }),
    );
  }
  return true;
}

export function toggleHeading(level: number): StateCommand {
  const marks = "#".repeat(level) + " ";
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const allSet = lines.every((l) => HEADING.exec(l.text)?.[1].length === level);
    return editLines(state, dispatch, (text) => {
      if (allSet) return { remove: HEADING.exec(text)![0].length, insert: "" };
      // A heading replaces list or quote markers on the line.
      const old = HEADING.exec(text) ?? BULLET.exec(text) ?? ORDERED.exec(text) ?? QUOTE.exec(text);
      return { remove: old?.[0].length ?? 0, insert: marks };
    });
  };
}

export function toggleQuote(): StateCommand {
  return ({ state, dispatch }) => {
    const allSet = selectedLines(state).every((l) => QUOTE.test(l.text));
    return editLines(state, dispatch, (text) =>
      allSet ? { remove: QUOTE.exec(text)![0].length, insert: "" } : { remove: 0, insert: text ? "> " : ">" },
    );
  };
}

export function toggleList(ordered: boolean): StateCommand {
  const own = ordered ? ORDERED : BULLET;
  const other = ordered ? BULLET : ORDERED;
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const skipBlank = lines.length > 1;
    const relevant = lines.filter((l) => !skipBlank || l.text.trim());
    const allSet = relevant.length > 0 && relevant.every((l) => own.test(l.text));
    // A numbered list continues the numbering of an item right above it.
    let n = 1;
    if (ordered && !allSet) {
      const before = lines[0].number > 1 ? state.doc.line(lines[0].number - 1).text : "";
      const m = /^[ \t]*(\d+)[.)]/.exec(before);
      if (m) n = Number(m[1]) + 1;
    }
    return editLines(state, dispatch, (text) => {
      if (skipBlank && !text.trim()) return null;
      if (allSet) {
        const m = own.exec(text)!;
        return { remove: m[0].length, insert: m[1] };
      }
      if (own.test(text)) {
        if (!ordered) return null;
        const m = own.exec(text)!;
        return { remove: m[0].length, insert: `${m[1]}${n++}. ` };
      }
      const m = other.exec(text) ?? HEADING.exec(text);
      const indent = other.exec(text)?.[1] ?? "";
      const marker = ordered ? `${n++}. ` : "- ";
      return { remove: m?.[0].length ?? 0, insert: indent + marker };
    });
  };
}

/** Inserts a divider line on its own, with blank lines around it (a `---`
 * right under text would turn that text into a heading). */
export const insertDivider: StateCommand = ({ state, dispatch }) => {
  const spot = blockSpot(state);
  const insert = `${spot.before}---${spot.after}`;
  // Continue below the divider (past the blank line if one was already there).
  const cursor = spot.from + insert.length + (spot.after ? 0 : 2);
  dispatch(
    state.update({
      changes: { from: spot.from, to: spot.to, insert },
      selection: EditorSelection.cursor(Math.min(cursor, state.doc.length - (spot.to - spot.from) + insert.length)),
      scrollIntoView: true,
      userEvent: "input.format",
    }),
  );
  return true;
};

// ---- list indent / outdent (Tab, Shift+Tab) ----

const ITEM = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/;

/** Tab / Shift+Tab on list items. Returns false outside lists. */
export function indentListItem(outdent: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    if (!lines.every((l) => ITEM.test(l.text))) return false;
    const changes: ChangeSpec[] = [];
    for (const line of lines) {
      const indent = ITEM.exec(line.text)![1].length;
      // Look upwards for the item to nest under (Tab) or the parent (Shift+Tab).
      let target: number | null = null;
      for (let n = line.number - 1; n >= 1; n--) {
        const text = state.doc.line(n).text;
        if (!text.trim()) continue;
        const m = ITEM.exec(text);
        if (!m) {
          if (/^\S/.test(text)) break; // left the list
          continue;
        }
        const ind = m[1].length;
        if (outdent ? ind < indent : ind === indent) {
          // Nesting: indent to where the sibling's text starts.
          target = outdent ? ind : ind + m[2].length + m[3].length;
          break;
        }
        if (ind < indent && !outdent) break;
      }
      if (outdent && target === null) target = indent > 0 ? 0 : null;
      if (target === null || target === indent) continue;
      changes.push({ from: line.from, to: line.from + indent, insert: " ".repeat(target) });
    }
    if (changes.length) dispatch(state.update({ changes, userEvent: "input.indent" }));
    return true; // Tab inside a list never leaves the editor
  };
}

// ---- which formatting the cursor is in (toolbar highlighting) ----

export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading: number; // 0 = none
  bullet: boolean;
  ordered: boolean;
  quote: boolean;
}

export function activeFormats(state: EditorState): ActiveFormats {
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from).text;
  const t = syntaxTree(state);
  const inside = (name: string) => {
    for (let n: SyntaxNode | null = t.resolveInner(from, 1); n; n = n.parent) {
      if (n.name === name && (from === to ? n.from < from && from < n.to : n.from <= from && to <= n.to))
        return true;
    }
    return false;
  };
  const listType = (() => {
    for (let n: SyntaxNode | null = t.resolveInner(from, -1); n; n = n.parent) {
      if (n.name === "BulletList" || n.name === "OrderedList") return n.name;
    }
    return null;
  })();
  return {
    bold: inside("StrongEmphasis"),
    italic: inside("Emphasis"),
    strike: inside("Strikethrough"),
    heading: HEADING.exec(line)?.[1].length ?? 0,
    bullet: listType === "BulletList" || BULLET.test(line),
    ordered: listType === "OrderedList" || ORDERED.test(line),
    quote: QUOTE.test(line),
  };
}

export function sameFormats(a: ActiveFormats, b: ActiveFormats) {
  return (Object.keys(a) as (keyof ActiveFormats)[]).every((k) => a[k] === b[k]);
}

// ---- blocks inserted by the toolbar ----

/** Text to put before and after a block inserted at the cursor so it stands
 * on its own lines with blank lines around it. Returns where to insert. */
function blockSpot(state: EditorState) {
  const line = state.doc.lineAt(state.selection.main.head);
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  // The text after the block needs one blank line before it.
  const after = !next ? "\n\n" : next.text.trim() ? "\n" : "";
  if (line.text.trim()) return { from: line.to, to: line.to, before: "\n\n", after };
  const prev = line.number > 1 ? state.doc.line(line.number - 1).text : "";
  return { from: line.from, to: line.to, before: prev.trim() ? "\n" : "", after };
}

/** A table with a header row and `rows` rows below it; selects the first
 * header cell's placeholder. */
export function insertTable(rows: number, cols: number): StateCommand {
  return ({ state, dispatch }) => {
    const headers = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
    const lines = [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...Array.from({ length: rows }, () => `| ${headers.map(() => " ").join(" | ")} |`),
    ];
    const spot = blockSpot(state);
    const insert = spot.before + lines.join("\n") + spot.after;
    const start = spot.from + spot.before.length + 2;
    dispatch(
      state.update({
        changes: { from: spot.from, to: spot.to, insert },
        selection: EditorSelection.range(start, start + headers[0].length),
        scrollIntoView: true,
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

/** Inserts the next footnote marker at the cursor and an empty note at the
 * end of the page, and puts the cursor in the note. */
export const insertFootnote: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc.toString();
  let max = 0;
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  const label = String(max + 1);
  const { from, to } = state.selection.main;
  const marker = `[^${label}]`;
  // Notes go together at the end: one line break after an existing note,
  // otherwise a blank line.
  const trimmed = doc.replace(/\s+$/, "");
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  const sep = !trimmed ? "" : /^\[\^[^\]\s]+\]:/.test(lastLine) ? "\n" : "\n\n";
  const note = `${sep}[^${label}]: `;
  const end = doc.length;
  const changes: ChangeSpec[] = [
    { from, to, insert: marker },
    { from: trimmed.length, to: end, insert: note },
  ];
  // If the cursor sits in trailing whitespace, the two changes would overlap.
  if (to > trimmed.length) changes.splice(0, 2, { from: trimmed.length, to: end, insert: marker + note });
  const set = state.changes(changes);
  dispatch(
    state.update({
      changes: set,
      selection: EditorSelection.cursor(set.newLength),
      scrollIntoView: true,
      userEvent: "input.format",
    }),
  );
  return true;
};
