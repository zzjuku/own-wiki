// A family tree in page text (M12): a line of its own,
//   <familytree root="Page A" up="1" down="3">
// written by the Family tree dialog. Drawn inside the page (read-only), with
// Open in Family tree. `root` is a page name (`"` written as &quot;).
export interface TreeLineCall {
  root: string;
  up: number;
  down: number;
}

export const DEFAULT_LINE_GENS = { up: 1, down: 3 };
export const FAMILYTREE_LINE = /^ {0,3}<familytree\b([^>\n]*)>[ \t]*$/i;
/** A family tree line at the start of `src` (with its line break). */
export const FAMILYTREE_BLOCK = /^ {0,3}<familytree\b([^>\n]*)>[ \t]*(?:\n+|$)/i;

const gens = (s: string | undefined, fallback: number) => (s !== undefined && /^\d+$/.test(s.trim()) ? Math.min(10, Number(s)) : fallback);

export function parseTreeAttrs(attrs: string): TreeLineCall {
  const a: Record<string, string> = {};
  for (const m of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) a[m[1].toLowerCase()] = m[2];
  return { root: (a.root ?? "").replace(/&quot;/g, '"').trim(), up: gens(a.up, DEFAULT_LINE_GENS.up), down: gens(a.down, DEFAULT_LINE_GENS.down) };
}

/** The family tree on line `line`, if it is one. */
export function treeOnLine(line: string): TreeLineCall | null {
  const m = FAMILYTREE_LINE.exec(line);
  return m ? parseTreeAttrs(m[1]) : null;
}

export function treeLineSource(c: TreeLineCall): string {
  const root = c.root.replace(/"/g, "&quot;").replace(/[<>\n]/g, "");
  return `<familytree root="${root}" up="${c.up}" down="${c.down}">`;
}
