// Search matching (M10), the same rules as src-tauri/src/searchtext.rs (both
// run shared-tests/search.json): upper/lower case and accents ignored, each
// word matches the start of a word, `"phrases"` as a whole. Used by the find
// bar on a page and to mark matches in result titles; searching pages is
// done in Rust.

/** Letters and digits (same as is_word_char in Rust). */
const WORD_CHAR = /[\p{Alphabetic}\p{N}]/u;
const MARK = /\p{M}/u;

/** One character folded for matching (same as fold_char in Rust). */
function foldChar(c: string): string {
  if (/\s/.test(c)) return " ";
  let out = "";
  for (const d of c.normalize("NFD")) if (!MARK.test(d)) out += d.toLowerCase();
  return out;
}

export function fold(s: string): string {
  let out = "";
  for (const c of s) out += foldChar(c);
  return out;
}

/** `text` folded, and for each folded UTF-16 index the text index it came from (plus the end). */
export function foldMap(text: string): { folded: string; from: number[] } {
  let folded = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const c = String.fromCodePoint(text.codePointAt(i)!);
    const f = foldChar(c);
    for (let k = 0; k < f.length; k++) from.push(i);
    folded += f;
    i += c.length;
  }
  from.push(text.length);
  return { folded, from };
}

/** The words and phrases of a query, folded; words without a letter or digit are dropped. */
export function parseQuery(q: string): string[] {
  const raw: string[] = [];
  let rest = q;
  for (;;) {
    rest = rest.trimStart();
    if (!rest) break;
    if (rest.startsWith('"')) {
      const end = rest.indexOf('"', 1);
      raw.push(rest.slice(1, end < 0 ? undefined : end));
      rest = end < 0 ? "" : rest.slice(end + 1);
    } else {
      const m = /^[^\s"]+/.exec(rest)!;
      raw.push(m[0]);
      rest = rest.slice(m[0].length);
    }
  }
  const terms: string[] = [];
  for (const r of raw) {
    const t = fold(r).split(/\s+/).filter(Boolean).join(" ");
    if (WORD_CHAR.test(t) && !terms.includes(t)) terms.push(t);
  }
  return terms;
}

const lastChar = (s: string, end: number) => {
  const before = s.slice(Math.max(0, end - 2), end);
  return before ? [...before].pop()! : "";
};

/** Where `term` (folded) starts a word in `hay` (folded). */
export function wordMatches(hay: string, term: string): number[] {
  const out: number[] = [];
  if (!term) return out;
  const startsWord = WORD_CHAR.test([...term][0]);
  for (let i = hay.indexOf(term); i >= 0; i = hay.indexOf(term, i + term.length)) {
    if (!startsWord || !WORD_CHAR.test(lastChar(hay, i))) out.push(i);
  }
  return out;
}

/** Ranges [from, to) of `text` that match any of `terms`, in order, without overlaps. */
export function findInText(text: string, terms: string[]): [number, number][] {
  const { folded, from } = foldMap(text);
  const ranges: [number, number][] = [];
  for (const t of terms) {
    for (const at of wordMatches(folded, t)) {
      // from[end]: where the character after the match starts.
      ranges.push([from[at], Math.max(from[at + t.length], from[at] + 1)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** Does every term occur in `text` (folded) at a word start? */
export const matchesAll = (text: string, terms: string[]) => {
  const folded = fold(text);
  return terms.every((t) => wordMatches(folded, t).length > 0);
};
