// Built-in themes (Juku, 2026-10-20): Default (the app's own look), Parchment
// and AWOIAF. They can't be changed or deleted, only copied. They use only
// fonts that come with both Mac and Windows, so they carry no font files.
import type { ThemeData } from "./engine";

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
      vars: {
        "--sidebar-bg": "#f8f5ee",
        "--accent": "#a8672a",
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
        "--font-heading": 'Georgia, "Times New Roman", serif',
        "--page-font-size": "16px",
        "--page-line-height": "1.5",
        "--infobox-width": "23em",
      },
    },
  },
];

export const BUILTIN_PREFIX = "builtin:";
export const DEFAULT_REF = "builtin:default";

export function builtinTheme(ref: string): ThemeData | null {
  return BUILTIN_THEMES.find((t) => BUILTIN_PREFIX + t.id === ref)?.data ?? null;
}
