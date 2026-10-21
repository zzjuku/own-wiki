// Theme engine: turns a theme's own settings into the CSS variables to set.
// A theme stores only what was changed (`vars`). Every other variable keeps
// its default from theme.css, except the ones that follow a changed setting
// (RULES): those are computed, so e.g. a dark background also darkens the
// hover colour and the borders. An unchanged copy of Default therefore looks
// exactly like Default.
import { mix, readableOn, withAlpha } from "./color";
import { DEFAULTS } from "./vars";

/** One font file inside a theme folder (src-tauri/src/fonts.rs). */
export interface ThemeFont {
  family: string;
  file: string;
  weight: string;
  style: string;
  /** Built-in themes: where the app's own copy of the font is. */
  url?: string;
}

/** Contents of a theme's theme.json. Unknown keys are kept by the Rust side. */
export interface ThemeData {
  name: string;
  /** Variables the theme sets itself, e.g. { "--bg": "#1e1e1e" }. */
  vars: Record<string, string>;
  /** Font files copied into the theme. */
  fonts?: ThemeFont[];
  [extra: string]: unknown;
}

type Rule = [target: string, sources: string[], compute: (...values: string[]) => string | null];

/** Variables that follow others when those are changed. In dependency order. */
const RULES: Rule[] = [
  ["--bg-soft", ["--bg", "--text"], (bg, t) => mix(bg, t, 0.04)],
  ["--bg-hover", ["--bg", "--text"], (bg, t) => mix(bg, t, 0.08)],
  ["--border", ["--bg", "--text"], (bg, t) => mix(bg, t, 0.14)],
  ["--muted", ["--text", "--bg"], (t, bg) => mix(t, bg, 0.45)],
  ["--editor-mark", ["--text", "--bg"], (t, bg) => mix(t, bg, 0.42)],
  ["--editor-quote", ["--text", "--bg"], (t, bg) => mix(t, bg, 0.25)],
  ["--accent-text", ["--accent"], (a) => readableOn(a)],
  ["--drop", ["--accent"], (a) => withAlpha(a, 0.14)],
  ["--selection", ["--accent"], (a) => withAlpha(a, 0.22)],
  ["--embed-hover", ["--accent"], (a) => withAlpha(a, 0.05)],
  ["--tooltip-text", ["--tooltip-bg"], (c) => readableOn(c)],
  ["--page-text", ["--text"], (t) => t],
  ["--heading-color", ["--page-text"], (t) => t],
  ["--quote-text", ["--page-text", "--page-bg"], (t, bg) => mix(t, bg, 0.25)],
  ["--quote-border", ["--infobox-border", "--page-bg"], (l, bg) => mix(l, bg, 0.4)],
  ["--quote-mark", ["--page-text", "--page-bg"], (t, bg) => mix(bg, t, 0.3)],
  ["--table-header-bg", ["--infobox-bg", "--page-text"], (b, t) => mix(b, t, 0.06)],
  ["--infobox-header-text", ["--infobox-header-bg"], (c) => readableOn(c)],
  ["--navbox-title-text", ["--navbox-title-bg"], (c) => readableOn(c)],
  ["--spoiler-hover-bg", ["--spoiler-bg", "--page-bg"], (s, bg) => mix(s, bg, 0.1)],
  ["--spoiler-revealed-bg", ["--spoiler-bg"], (s) => withAlpha(s, 0.08)],
  ["--spoiler-mark", ["--spoiler-bg", "--page-bg"], (s, bg) => mix(s, bg, 0.4)],
  ["--graph-node", ["--graph-label", "--graph-bg"], (t, bg) => mix(t, bg, 0.45)],
  ["--graph-node-faded", ["--graph-bg", "--graph-label"], (bg, t) => mix(bg, t, 0.1)],
  ["--graph-line", ["--graph-bg", "--graph-label"], (bg, t) => mix(bg, t, 0.2)],
];

const VAR_REF = /^var\((--[\w-]+)\)$/;

export interface Resolved {
  /** Variables differing from theme.css: the theme's own plus followers. */
  changed: Record<string, string>;
  /** Every variable with its final value ("var(--x)" kept where it follows another). */
  all: Record<string, string>;
}

/** The variables theme `vars` sets, directly and through RULES. */
export function resolveVars(vars: Record<string, string>): Resolved {
  const own = Object.fromEntries(Object.entries(vars).filter(([k, v]) => k in DEFAULTS && typeof v === "string" && v.trim()));
  const changed: Record<string, string> = { ...own };
  const value = (name: string): string => {
    const v = changed[name] ?? DEFAULTS[name] ?? "";
    const ref = VAR_REF.exec(v);
    return ref ? value(ref[1]) : v;
  };
  // A variable is touched when it, or the variable its default follows, changed.
  const touched = (name: string): boolean => {
    if (name in changed) return true;
    const ref = VAR_REF.exec(DEFAULTS[name] ?? "");
    return ref ? touched(ref[1]) : false;
  };
  for (const [target, sources, compute] of RULES) {
    if (target in own || !sources.some(touched)) continue;
    const v = compute(...sources.map(value));
    if (v) changed[target] = v;
  }
  return { changed, all: { ...DEFAULTS, ...changed } };
}

/** The value a variable has in a theme (following var() chains), for display. */
export function effectiveValue(resolved: Resolved, name: string): string {
  const v = resolved.all[name] ?? "";
  const ref = VAR_REF.exec(v);
  return ref ? effectiveValue(resolved, ref[1]) : v;
}

/** What a variable follows when the theme doesn't set it: another setting's name, or null. */
export function followsWhat(name: string): string | null {
  const rule = RULES.find((r) => r[0] === name);
  if (rule) return rule[1][0];
  return VAR_REF.exec(DEFAULTS[name] ?? "")?.[1] ?? null;
}

/** The family name a theme font is registered under, so two themes with
 * fonts of the same name never mix them up. */
export function scopedFamily(family: string, themeRef: string): string {
  // One plain word: WebKit's FontFace refuses names with other characters
  // or words starting with a digit.
  let hash = 0;
  for (const ch of `${themeRef}\n${family}`) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `ThemeFont${hash.toString(36)}`;
}

const quoteFamily = (f: string) => `"${f.replace(/["\\]/g, "")}"`;

/** `vars` with the theme's own font families renamed to their scoped names. */
export function scopeFonts(vars: Record<string, string>, fonts: ThemeFont[], scope: string): Record<string, string> {
  const families = new Set(fonts.map((f) => f.family));
  if (!families.size) return vars;
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [
      k,
      k.startsWith("--font-") ? v.replace(/"([^"]+)"/g, (m, fam: string) => (families.has(fam) ? quoteFamily(scopedFamily(fam, scope)) : m)) : v,
    ]),
  );
}

/** CSS text for `selector` setting `vars`, with the theme's own font families scoped. */
export function cssFor(selector: string, vars: Record<string, string>, fonts: ThemeFont[], scope: string): string {
  const lines = Object.entries(scopeFonts(vars, fonts, scope)).map(([k, v]) => `  ${k}: ${v.replace(/[;{}]/g, "")};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/** A font stack starting with `family`, falling back to the default stack of `name`. */
export function fontStack(family: string, name: string): string {
  return `${quoteFamily(family)}, ${DEFAULTS[name] ?? "serif"}`;
}

/** The first family in a font stack (quotes removed). */
export function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}
