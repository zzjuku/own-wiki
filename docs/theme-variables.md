# Theme variables

The contract for themes (M11). Defaults live in [`src/theme.css`](../src/theme.css), light values first and dark values in a `prefers-color-scheme: dark` block. A theme sets any of these variables; anything it leaves out keeps the default. Keep this list and `theme.css` in sync.

Rule: the app's CSS uses no colour or font of its own. Every colour and font comes from a variable below, as do the type scale and the main layout sizes. Small fixed spacings inside controls (button padding, icon sizes, gaps of a few pixels) are not themeable.

## App surfaces and text
| Variable | Used for |
|---|---|
| `--bg` | Main background (library, content area, dialogs) |
| `--bg-soft` | Soft background (notices, hover areas) |
| `--bg-hover` | Hovered and selected rows/buttons |
| `--border` | Borders and separators in the app UI |
| `--text` | Main UI text |
| `--muted` | Secondary text, hints |
| `--accent` / `--accent-text` | Primary buttons, focus rings, active toolbar buttons; text on accent |
| `--danger` / `--danger-text` | Delete buttons, error banner; text on danger |
| `--ok` | "Saved" status |
| `--warn` / `--warn-bg` | Long-path warning |
| `--drop` | Drag-and-drop target, selected group, jump highlight |
| `--selection` | Selected text in the editor |
| `--shadow` | Shadow of dialogs and menus |
| `--backdrop` | Dimmed background behind dialogs |
| `--sidebar-bg` | Project sidebar |
| `--toolbar-bg` | Editor toolbar and status line |

## Editor (Markdown source)
| Variable | Used for |
|---|---|
| `--editor-mark` | Markdown symbols (`##`, `**`, `-`, `>`) |
| `--editor-quote` | Quote text in the source |
| `--search-match` / `--search-match-current` | Find & replace matches |
| `--editor-font-size` | Source text size |
| `--editor-padding` | Space around the source text |

## Page (read view and preview)
| Variable | Used for |
|---|---|
| `--page-bg` | Page background |
| `--page-text` | Page body text |
| `--heading-color` | Section headings |
| `--heading-rule` | Line under main headings, divider lines |
| `--link` | Links |
| `--link-new` | Links to pages that don't exist yet (red links) |
| `--quote-border` / `--quote-text` | Quotes |
| `--code-bg` | Code |
| `--table-border` / `--table-bg` / `--table-header-bg` | Tables |
| `--toc-bg` / `--toc-border` / `--toc-number` | Table of contents box/panel and numbers |
| `--toc-active` | Bar beside the section being read, in the contents panel |
| `--card-bg` / `--card-border` | Link hover preview cards |
| `--card-width` | Width of hover preview cards |

## Infobox (used from M5)
| Variable | Used for |
|---|---|
| `--infobox-bg` / `--infobox-border` | Box background and border |
| `--infobox-header-bg` / `--infobox-header-text` | Title bar and section headers |
| `--infobox-label` | Field labels |
| `--infobox-width` | Box width (floats right of the page text) |
| `--infobox-font-size` | Text size inside the box |
| `--infobox-padding` | Cell padding |
| `--infobox-gap` | Space between the box and the text beside it |
| `--thumb-bg` / `--thumb-border` | Frame around images in the text and gallery cells |
| `--thumb-caption` | Image and gallery captions |
| `--thumb-gap` | Space between a floating image and the text beside it |
| `--viewer-bg` / `--viewer-text` | Full-size image viewer background and its text |

## Fonts and sizes
| Variable | Used for |
|---|---|
| `--font-ui` | App interface |
| `--font-body` | Page text |
| `--font-heading` | Page title and section headings (Georgia by default) |
| `--font-mono` | Code |
| `--text-xs` … `--text-display` | UI type scale (12, 13, 14, 15, 17, 20, 26, 30 px) |
| `--page-font-size` / `--page-line-height` | Page text size and line spacing |

## Layout
| Variable | Used for |
|---|---|
| `--radius` | Corner rounding |
| `--sidebar-width` | Project sidebar width |
| `--page-width` | Maximum width of the page text (including a floating infobox) |
| `--page-padding-x` | Space left and right of the page text |
| `--toc-side-width` | Width of the contents panel left of the page text |
