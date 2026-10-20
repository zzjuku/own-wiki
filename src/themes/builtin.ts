// Built-in themes (Juku, 2026-10-20): Default (the app's own look), Parchment
// and AWOIAF. They can't be changed or deleted, only copied. Their fonts come
// with Mac and Windows or with the app itself (AWOIAF's, copied along when the
// theme is copied).
import type { ThemeData } from "./engine";
// Free fonts (SIL Open Font License, see fonts/OFL-*.txt) that come with the app.
import marcellusUrl from "./fonts/Marcellus-Regular.ttf?url";
import uncialUrl from "./fonts/UncialAntiqua-Regular.ttf?url";

export const BUILTIN_THEMES: { id: string; data: ThemeData }[] = [
  { id: "default", data: { name: "Default", vars: {} } },
  {
    id: "parchment",
    data: {
      name: "Parchment",
      vars: {
        "--bg": "#f4ecd8",
        "--sidebar-bg": "#ebdfc2",
        "--text": "#3b2f20",
        "--accent": "#8b5a2b",
        "--tooltip-bg": "#3e3022",
        "--page-bg": "#f7f0de",
        "--page-text": "#33281b",
        "--heading-color": "#4a3520",
        "--link": "#8b4513",
        "--link-new": "#b22222",
        "--infobox-bg": "#efe4c8",
        "--infobox-header-bg": "#d9c39a",
        "--infobox-border": "#b8a27a",
        "--spoiler-bg": "#5a4632",
        "--navbox-border-width": "3px",
        "--navbox-border-style": "double",
        "--navbox-radius": "4px",
        "--font-body": '"Palatino Linotype", Palatino, "Book Antiqua", serif',
        "--font-heading": 'Georgia, "Times New Roman", serif',
        "--page-font-size": "16px",
        "--page-line-height": "1.65",
      },
    },
  },
  {
    id: "awoiaf",
    data: {
      name: "AWOIAF",
      // Imitates A Wiki of Ice and Fire: centred title in Uncial Antiqua,
      // Marcellus headings with accent bars, cream boxes with an ornate
      // Contents frame and soft shadows.
      fonts: [
        { family: "Marcellus", file: "Marcellus-Regular.ttf", weight: "400", style: "normal", url: marcellusUrl },
        { family: "Uncial Antiqua", file: "UncialAntiqua-Regular.ttf", weight: "400", style: "normal", url: uncialUrl },
      ],
      vars: {
        "--sidebar-bg": "#f8f5ee",
        "--accent": "#8f5c14",
        "--tooltip-bg": "#3b3127",
        "--page-text": "#202122",
        "--heading-color": "#202122",
        "--link": "#1088b7",
        "--link-new": "#dd0033",
        "--infobox-bg": "#f8f5ee",
        "--infobox-header-bg": "#eee5d5",
        "--infobox-border": "#b9ad99",
        "--heading-rule": "#b9ad99",
        "--table-header-bg": "#eee5d5",
        "--quote-border": "#b9ad99",
        "--navbox-bg": "#f8f5ee",
        "--navbox-border": "#b9ad99",
        "--navbox-title-bg": "#eee5d5",
        "--ornament": "#8f5c14",
        "--box-inner-line": "rgb(96 76 48 / 0.24)",
        "--title-align": "center",
        "--title-deco": "accent",
        "--heading-deco": "accent",
        "--infobox-frame": "ornate",
        "--infobox-shadow": "0 1px 0 rgb(96 76 48 / 0.1), 0 8px 22px rgb(35 27 18 / 0.15)",
        "--infobox-title-style": "accent",
        "--infobox-heading-style": "lined",
        "--infobox-label": "#54595d",
        "--infobox-label-weight": "600",
        "--infobox-row-space": "0.42em",
        "--toc-frame": "ornate",
        "--toc-shadow": "2px 2px 0 rgb(96 76 48 / 0.06), 0 4px 11px rgb(35 27 18 / 0.09)",
        "--quote-style": "framed",
        "--navbox-frame": "double",
        "--font-title": '"Uncial Antiqua", Georgia, serif',
        "--font-heading": '"Marcellus", Georgia, serif',
        "--font-infobox-title": '"Marcellus", Georgia, serif',
        "--font-infobox-header": '"Marcellus", Georgia, serif',
        "--font-navbox-title": '"Marcellus", Georgia, serif',
        "--page-font-size": "16px",
        "--page-line-height": "1.5",
        "--title-size": "38px",
        "--heading-size": "1.65em",
        "--infobox-font-size": "90%",
        "--infobox-width": "25.5em",
      },
    },
  },
];

export const BUILTIN_PREFIX = "builtin:";
export const DEFAULT_REF = "builtin:default";

export function builtinTheme(ref: string): ThemeData | null {
  return BUILTIN_THEMES.find((t) => BUILTIN_PREFIX + t.id === ref)?.data ?? null;
}
