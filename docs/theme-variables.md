# Theme variables

The contract for themes (M8). Defaults live in [`src/theme.css`](../src/theme.css), always light (the system's dark mode is ignored since M7). A theme sets any of these variables; anything it leaves out keeps the default. Keep this list, `theme.css` and the editor's list in `src/themes/vars.ts` in sync.

How themes use them (M8, `src/themes/engine.ts`): a theme file stores only the variables it sets. A default written as another variable (`var(--bg)`) follows that variable. Some colours are computed from a main setting when the theme changes that setting (e.g. hover and border colours from the background, text on the accent, tooltip text); the rules are in `RULES` in `engine.ts`. A theme that sets nothing looks exactly like the defaults.

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
| `--search-match` / `--search-match-current` | Find matches (editor find & replace, find on page, search results) and the current one |
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
| `--infobox-label-weight` | Field label weight (`700` bold, `600` semi-bold, `400` normal) |
| `--infobox-width` | Box width (floats right of the page text) |
| `--infobox-font-size` | Text size inside the box |
| `--infobox-row-space` | Space above and below each row's text |
| `--infobox-padding` | Cell padding (follows `--infobox-row-space`) |
| `--infobox-gap` | Space between the box and the text beside it |
| `--thumb-bg` / `--thumb-border` | Frame around images in the text and gallery cells |
| `--thumb-caption` | Image and gallery captions |
| `--thumb-gap` | Space between a floating image and the text beside it |
| `--viewer-bg` / `--viewer-text` | Full-size image viewer background and its text |

## Spoilers and quote boxes (M7)
| Variable | Used for |
|---|---|
| `--spoiler-bg` / `--spoiler-hover-bg` | A hidden spoiler (and under the mouse); hidden captions |
| `--spoiler-revealed-bg` | A revealed spoiler's faint background; spoiler text in the source editor |
| `--spoiler-mark` | Dashed mark around spoilers in the editor preview and source, Reveal buttons |
| `--spoiler-blur` | How strongly hidden images and galleries are blurred |
| `--spoiler-label-bg` / `--spoiler-label-text` | The "Spoiler" label on hidden images |
| `--quote-mark` | The large quotation marks of quote boxes |
| `--embed-hover` | Faint highlight of an embedded page under the mouse |
| `--navbox-bg` / `--navbox-border` | Collapsible embed boxes (infobox colours by default) |
| `--navbox-title-bg` / `--navbox-title-text` | Their title bar |
| `--navbox-border-width` / `--navbox-border-style` / `--navbox-radius` | Their frame: width, style (solid, dashed, dotted, double, none), own corner rounding (follows `--box-radius`) |

## Tooltips (M8)
| Variable | Used for |
|---|---|
| `--tooltip-bg` / `--tooltip-text` | App-styled tooltips on buttons and controls |

## Fonts and sizes
| Variable | Used for |
|---|---|
| `--font-ui` | App interface |
| `--font-body` | Page text |
| `--font-heading` | Section headings, app screen titles (Georgia by default) |
| `--font-title` | The page title (follows `--font-heading`) |
| `--font-infobox` / `--font-infobox-title` / `--font-infobox-header` / `--font-infobox-label` | Infobox text, title, section headings, labels (follow `--font-body`) |
| `--font-toc` / `--font-navbox-title` / `--font-quote` / `--font-caption` | Contents, embed box titles, quote boxes, captions (follow `--font-body`) |
| `--font-mono` | Code |
| `--title-size` / `--heading-size` / `--infobox-title-size` | Page title, section headings (h2), infobox title |
| `--title-weight` / `--heading-weight` | Weight of the page title and of section headings (h1, h2): `400`, `500`, `600`, `700` |
| `--text-xs` … `--text-display` | UI type scale (12, 13, 14, 15, 17, 20, 26, 30 px) |
| `--page-font-size` / `--page-line-height` | Page text size and line spacing |

## Look (M8)
Keywords, read by style queries in `src/styles/look.css`; the defaults change nothing. Ornaments drawn as pseudo-elements always exist there and are only shown through a `--show-…` variable the query sets (WebKit doesn't redraw a pseudo-element when a query around it stops matching).
| Variable | Values |
|---|---|
| `--title-align` | `left`, `center` (own row under the buttons) |
| `--title-deco` | `none`, `line`, `accent` (line with an accent bar), `double` |
| `--title-case` / `--heading-case` / `--infobox-heading-case` | Letters of the page title / section headings (and the Contents panel title) / infobox section headings: `normal`, `caps` (capitals, spaced), `small-caps` |
| `--heading-deco` | `line`, `accent`, `double`, `bar` (accent bar at the left, no line), `none` |
| `--ornament` | Colour of accent bars and corner ornaments (follows `--accent`) |
| `--box-inner-line` | The inner line of double and ornate frames |
| `--infobox-frame` / `--toc-frame` / `--navbox-frame` | `plain`, `double`, `ornate` (double line plus corner ornaments; on the infobox at all four corners), `bracket` (thin frame, bold corner marks in the ornament colour), `rule` (no side lines: an ornament-coloured line on top, a thin one below) |
| `--box-radius` | Corner rounding of every box on the page (infobox, contents, embed boxes, framed quote boxes, tables, picture frames, galleries, categories box; code blocks at least `--radius`), with any frame; `0px` by default. Ornate and bracket frames stay square |
| `--infobox-shadow` / `--toc-shadow` / `--navbox-shadow` | A box-shadow (`0 0 #0000` = none) |
| `--infobox-title-style` | `bar`, `plain` (line under it), `accent` (line with accent bar) |
| `--infobox-heading-style` | Infobox section headings: `bar`, `lined` (larger, thin lines above and below) |
| `--quote-style` | `open` (quotation marks only), `framed`, `bar` (accent bar at the left, italic, no marks) |

## Layout
| Variable | Used for |
|---|---|
| `--radius` | Corner rounding |
| `--sidebar-width` | Project sidebar width |
| `--page-width` | Maximum width of the page text (including a floating infobox) |
| `--page-padding-x` | Space left and right of the page text |
| `--toc-side-width` | Width of the contents panel left of the page text |
