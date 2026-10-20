// The theme variables: their defaults (read from src/theme.css, the single
// source), the settings the theme editor shows up front, and every colour
// grouped by area for "All colours" (docs/theme-variables.md lists them too).
import themeCss from "../theme.css?raw";

/** Default value of every variable, as written in theme.css ("var(--x)" kept). */
export const DEFAULTS: Record<string, string> = Object.fromEntries(
  [...themeCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

export type SettingKind =
  | { kind: "color" }
  | { kind: "size"; min: number; max: number; step: number; unit: "px" | "em" | "%" | "" }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "font" };

export interface Setting {
  name: string;
  label: string;
  hint?: string;
  type: SettingKind;
}

const color = { kind: "color" } as const;
const font = { kind: "font" } as const;
const size = (min: number, max: number, step: number, unit: "px" | "em" | "%" | "") => ({ kind: "size", min, max, step, unit }) as const;
const px = (min: number, max: number, step = 1) => size(min, max, step, "px");
const select = (...options: [string, string][]) => ({ kind: "select", options: options.map(([value, label]) => ({ value, label })) }) as const;

const FRAMES = select(["plain", "Plain"], ["double", "Double line"], ["ornate", "Ornate corners"]);
/** Shadow choices: the values are CSS box-shadows ("0 0 #0000" = none). */
export const SHADOWS = select(
  ["0 0 #0000", "None"],
  ["0 1px 3px rgb(0 0 0 / 0.12)", "Soft"],
  ["2px 2px 0 rgb(96 76 48 / 0.06), 0 4px 11px rgb(35 27 18 / 0.09)", "Medium"],
  ["0 1px 0 rgb(96 76 48 / 0.1), 0 8px 22px rgb(35 27 18 / 0.15)", "Deep"],
);

/** The main settings, up front in the editor. Everything else follows them. */
export const MAIN_SETTINGS: { title: string; settings: Setting[] }[] = [
  {
    title: "App",
    settings: [
      { name: "--bg", label: "Background", hint: "Library, content area, dialogs", type: color },
      { name: "--sidebar-bg", label: "Sidebar and toolbars", type: color },
      { name: "--text", label: "Text", type: color },
      { name: "--accent", label: "Accent", hint: "Main buttons, focus rings, selection", type: color },
      { name: "--tooltip-bg", label: "Tooltips", type: color },
    ],
  },
  {
    title: "Page",
    settings: [
      { name: "--page-bg", label: "Page background", type: color },
      { name: "--page-text", label: "Page text", type: color },
      { name: "--heading-color", label: "Headings", type: color },
      { name: "--link", label: "Links", type: color },
      { name: "--link-new", label: "Red links", hint: "Links to pages that don't exist yet", type: color },
      { name: "--infobox-bg", label: "Boxes", hint: "Infobox, contents, tables, image frames, code", type: color },
      { name: "--infobox-header-bg", label: "Infobox title bar", hint: "A page's own infobox colour still wins", type: color },
      { name: "--infobox-border", label: "Lines and borders", hint: "Box frames, lines under headings, tables", type: color },
      { name: "--spoiler-bg", label: "Spoilers", type: color },
    ],
  },
  {
    title: "Look",
    settings: [
      { name: "--title-align", label: "Page title", type: select(["left", "Left"], ["center", "Centred, own row"]) },
      { name: "--title-deco", label: "Line under the title", type: select(["none", "None"], ["line", "Line"], ["accent", "Line with accent"]) },
      { name: "--heading-deco", label: "Line under section headings", type: select(["line", "Line"], ["accent", "Line with accent"], ["none", "None"]) },
      { name: "--ornament", label: "Ornaments", hint: "Accent bars and corner ornaments", type: color },
      { name: "--box-inner-line", label: "Inner frame line", hint: "The second line of double and ornate frames", type: color },
    ],
  },
  {
    title: "Boxes",
    settings: [
      { name: "--infobox-frame", label: "Infobox frame", type: FRAMES },
      { name: "--infobox-shadow", label: "Infobox shadow", type: SHADOWS },
      { name: "--infobox-title-style", label: "Infobox title style", hint: "A page's own infobox colour shows on the bar", type: select(["bar", "Coloured bar"], ["plain", "Plain with line"], ["accent", "Plain with accent"]) },
      { name: "--toc-frame", label: "Contents frame", type: FRAMES },
      { name: "--toc-shadow", label: "Contents shadow", type: SHADOWS },
      { name: "--quote-style", label: "Quote boxes", type: select(["open", "Quotation marks"], ["framed", "Framed"]) },
    ],
  },
  {
    title: "Embed boxes",
    settings: [
      { name: "--navbox-bg", label: "Background", type: color },
      { name: "--navbox-border", label: "Frame colour", type: color },
      { name: "--navbox-title-bg", label: "Title bar", type: color },
      { name: "--navbox-frame", label: "Frame", type: FRAMES },
      { name: "--navbox-shadow", label: "Shadow", type: SHADOWS },
      { name: "--navbox-border-width", label: "Frame width", type: px(0, 6) },
      {
        name: "--navbox-border-style",
        label: "Frame style",
        type: select(["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["double", "Double"], ["none", "None"]),
      },
      { name: "--navbox-radius", label: "Corner rounding", type: px(0, 16) },
    ],
  },
  {
    title: "Fonts",
    settings: [
      { name: "--font-body", label: "Page font", hint: "Page text", type: font },
      { name: "--font-title", label: "Title font", hint: "The page title at the top", type: font },
      { name: "--font-heading", label: "Headings font", hint: "Section headings", type: font },
      { name: "--font-infobox", label: "Infobox text", type: font },
      { name: "--font-infobox-title", label: "Infobox title", type: font },
      { name: "--font-infobox-header", label: "Infobox section headings", type: font },
      { name: "--font-infobox-label", label: "Infobox labels", type: font },
      { name: "--font-toc", label: "Contents", type: font },
      { name: "--font-navbox-title", label: "Embed box titles", type: font },
      { name: "--font-quote", label: "Quote boxes", type: font },
      { name: "--font-caption", label: "Captions", type: font },
      { name: "--font-ui", label: "App interface", hint: "Buttons, sidebar, dialogs", type: font },
    ],
  },
  {
    title: "Sizes",
    settings: [
      { name: "--page-font-size", label: "Text size", type: px(12, 24) },
      { name: "--page-line-height", label: "Line spacing", type: size(1.2, 2.2, 0.05, "") },
      { name: "--title-size", label: "Title size", type: px(16, 52) },
      { name: "--heading-size", label: "Section heading size", type: size(1, 2.4, 0.05, "em") },
      { name: "--infobox-font-size", label: "Infobox text size", type: size(70, 110, 1, "%") },
      { name: "--infobox-title-size", label: "Infobox title size", type: size(100, 180, 5, "%") },
      { name: "--infobox-width", label: "Infobox width", type: size(16, 32, 0.5, "em") },
      { name: "--page-width", label: "Page width", hint: "Widest the page text gets, infobox included", type: px(700, 2000, 10) },
    ],
  },
];

/** Every colour variable, by area, with a short label (All colours). */
export const ALL_COLORS: { title: string; vars: [string, string][] }[] = [
  {
    title: "App",
    vars: [
      ["--bg", "Background"],
      ["--bg-soft", "Soft background (notices)"],
      ["--bg-hover", "Hovered rows and buttons"],
      ["--border", "Borders and separators"],
      ["--text", "Text"],
      ["--muted", "Secondary text, hints"],
      ["--accent", "Accent"],
      ["--accent-text", "Text on accent"],
      ["--danger", "Delete buttons, errors"],
      ["--danger-text", "Text on delete buttons"],
      ["--ok", "\"Saved\" status"],
      ["--warn", "Warning text"],
      ["--warn-bg", "Warning background"],
      ["--drop", "Drop target, selected group"],
      ["--selection", "Selected text in the editor"],
      ["--backdrop", "Dimmed background behind dialogs"],
      ["--sidebar-bg", "Sidebar"],
      ["--toolbar-bg", "Editor toolbar and status line"],
      ["--tooltip-bg", "Tooltip background"],
      ["--tooltip-text", "Tooltip text"],
    ],
  },
  {
    title: "Editor",
    vars: [
      ["--editor-mark", "Markdown symbols"],
      ["--editor-quote", "Quote text in the source"],
      ["--search-match", "Find matches"],
      ["--search-match-current", "Current find match"],
    ],
  },
  {
    title: "Page",
    vars: [
      ["--page-bg", "Background"],
      ["--page-text", "Text"],
      ["--heading-color", "Headings"],
      ["--heading-rule", "Line under headings, divider lines"],
      ["--link", "Links"],
      ["--link-new", "Red links"],
      ["--quote-border", "Quote bar"],
      ["--quote-text", "Quote text"],
      ["--code-bg", "Code"],
      ["--table-border", "Table lines"],
      ["--table-bg", "Table cells"],
      ["--table-header-bg", "Table header"],
      ["--toc-bg", "Contents box"],
      ["--toc-border", "Contents frame"],
      ["--toc-number", "Contents numbers"],
      ["--toc-active", "Contents: section being read"],
      ["--card-bg", "Hover card background"],
      ["--card-border", "Hover card frame"],
    ],
  },
  {
    title: "Infobox and images",
    vars: [
      ["--infobox-bg", "Infobox background"],
      ["--infobox-border", "Infobox frame"],
      ["--infobox-header-bg", "Infobox title bar"],
      ["--infobox-header-text", "Infobox title text"],
      ["--infobox-label", "Field labels"],
      ["--thumb-bg", "Image frame background"],
      ["--thumb-border", "Image frame"],
      ["--thumb-caption", "Captions"],
      ["--viewer-bg", "Image viewer background"],
      ["--viewer-text", "Image viewer text"],
    ],
  },
  {
    title: "Look",
    vars: [
      ["--ornament", "Ornaments"],
      ["--box-inner-line", "Inner frame line"],
    ],
  },
  {
    title: "Spoilers, quote boxes, embeds",
    vars: [
      ["--spoiler-bg", "Hidden spoiler"],
      ["--spoiler-hover-bg", "Hidden spoiler under the mouse"],
      ["--spoiler-revealed-bg", "Revealed spoiler"],
      ["--spoiler-mark", "Spoiler marks in the editor"],
      ["--spoiler-label-bg", "\"Spoiler\" label on images"],
      ["--spoiler-label-text", "\"Spoiler\" label text"],
      ["--quote-mark", "Quote box quotation marks"],
      ["--embed-hover", "Embedded page under the mouse"],
      ["--navbox-bg", "Embed box background"],
      ["--navbox-border", "Embed box frame"],
      ["--navbox-title-bg", "Embed box title bar"],
      ["--navbox-title-text", "Embed box title text"],
    ],
  },
];

/** Standard fonts: present on both Mac and Windows, so nothing is copied. */
export const STANDARD_FONTS: { label: string; value: string }[] = [
  { label: "System (sans-serif)", value: DEFAULTS["--font-body"] },
  { label: "Georgia", value: DEFAULTS["--font-heading"] },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Palatino", value: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
];
