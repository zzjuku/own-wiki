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
  | { kind: "size"; min: number; max: number; step: number; unit: "px" | "" }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "font" };

export interface Setting {
  name: string;
  label: string;
  hint?: string;
  type: SettingKind;
}

const color = { kind: "color" } as const;
const px = (min: number, max: number, step = 1) => ({ kind: "size", min, max, step, unit: "px" }) as const;

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
    title: "Embed boxes",
    settings: [
      { name: "--navbox-bg", label: "Background", type: color },
      { name: "--navbox-border", label: "Frame colour", type: color },
      { name: "--navbox-title-bg", label: "Title bar", type: color },
      { name: "--navbox-border-width", label: "Frame width", type: px(0, 6) },
      {
        name: "--navbox-border-style",
        label: "Frame style",
        type: {
          kind: "select",
          options: [
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
            { value: "dotted", label: "Dotted" },
            { value: "double", label: "Double" },
            { value: "none", label: "None" },
          ],
        },
      },
      { name: "--navbox-radius", label: "Corner rounding", type: px(0, 16) },
    ],
  },
  {
    title: "Text",
    settings: [
      { name: "--font-body", label: "Page font", type: { kind: "font" } },
      { name: "--font-heading", label: "Headings font", hint: "Page title and section headings", type: { kind: "font" } },
      { name: "--page-font-size", label: "Text size", type: px(12, 24) },
      { name: "--page-line-height", label: "Line spacing", type: { kind: "size", min: 1.2, max: 2.2, step: 0.05, unit: "" } },
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
