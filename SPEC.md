# Own WIKI — Spec (v0.17, 2026-10-21)

This file is the single source of truth for what the program is and why. Update the decision log whenever a decision changes. Detailed scopes and decisions of finished milestones are in `docs/history.md`.

Status: M1–M10 done (M10 on 2026-10-21); next: build M11 Graph view (defined 2026-10-21); roadmap M11–M17 drafted.

## Purpose
A blank, local desktop program for building personal wikis for fictional stories. The program is only the container. All content is created by the user inside it. Nothing story-specific is hardcoded.

## Settled decisions

### 1. Structure
- Top level: **Projects**. One project = one independent wiki (one story/world).
- The app ships **blank**. No built-in entity types such as "Character" or "Place". The user defines their own page types or templates (fields, infobox layout) per project.
- Projects are fully self-contained and can be copied, moved, or deleted as one folder.
- Inside a project: **groups** (folders) and **pages**. Groups can contain groups (nested). A page sits in exactly one group (or at the top level).
- **Categories** are separate from groups: tags, many per page, AWOIAF-style. Each category gets an automatic category page listing its members.
- **Page titles are unique across the whole project**, regardless of group. Duplicates are named Wikipedia-style, e.g. "Page A (Example)". Links never contain the group path, so moving a page between groups breaks nothing.
- Expected size: projects can reach **thousands of pages**. Index, search, sidebar and graph must stay fast at that size.

### 2. Platform
- Primary: **macOS**. Also needs a **Windows** build of the same program.
- One codebase, two builds. Proposed stack: **Tauri 2** (small native app, web-tech UI). Electron is the fallback.
- Mac builds are made locally on Juku's Mac via Claude Code. Windows installers (and release Mac builds if wanted) are built by GitHub Actions. The repo is public, so Actions minutes are free.
- Builds are unsigned (no paid Apple/Microsoft certificates). First launch needs the OS "open anyway" step once.
- UI language: **English**.

### 3. Data storage (content strictly separate from code)
- Each project is a plain folder on disk:
  ```
  MyStory/
    project.json        # project name, settings, template definitions
    pages/              # one Markdown file per page, structured fields in YAML front matter;
                        # groups are subfolders here (nested allowed)
    assets/             # images and other media, copied in on import (never linked to outside paths)
    categories/         # one Markdown file per category that has its own text or parent categories (M6)
  ```
- All projects live in one **library folder**. The user chooses its location in the app settings. **Move library…** (Settings, 2026-10-21) copies the library's own folders (every project and `_themes`; nothing else in that folder, which may be a whole Documents folder) to a chosen folder (itself if empty, else a new "Own WIKI" folder in it), checks the copy and uses it from then on; the originals stay as a backup.
- The library path is stored **per machine** (in the app's local settings), never inside the synced data, because the Mac and Windows paths differ.
- Plain, human-readable formats only (Markdown, JSON, YAML, normal image files). No proprietary database as the source of truth.
- Images are imported into the project's own `assets/` folder and stored locally. All references inside pages are relative paths.
- **Export**: the project folder is already the export. Additional exports (zip archive, static HTML site, others TBD) come later.

### 4. Sync between Mac and Windows
- Done at file level, not built into the app. Chosen service: **Google Drive for desktop** on both machines, with the library folder inside My Drive.
- Recommended setting: **Mirror files** mode, or Stream mode with the library folder set to "Available offline".
- The app must:
  - detect files changed on disk by the sync service and reload them
  - recognize sync-conflict or duplicate copies and surface them instead of silently ignoring them
  - keep caches/indexes out of the synced data (they live in the app's local cache folder)
  - write files safely (write a temp file, then rename) so a half-synced file can't corrupt a page
- Limitation: don't edit the same page on both machines at the same time. The app warns when a project is still open on the other computer, and edits that collide end up on the Conflicts screen (M10).
- Windows path limit (~260 characters): deeply nested groups plus long titles inside the Drive folder can exceed it. The app warns when a path gets close to the limit.

### 5. Users and privacy
- Single user. No accounts, no server, no cloud dependency.

### 6. Spoilers
- **Inline**, Discord-style: `||hidden text||`. The text stays hidden until clicked to reveal.
- Spoilers stay hidden everywhere their text appears: page text, infobox fields, hover previews, embeds and search results.
- "Reveal all spoilers" exists both per page and as a global switch for everywhere (2026-10-19). Per page: lasts until the page is left. Global switch: stays on until switched off, remembered per computer (browser local storage, never synced).
- Every infobox field on a page can be hidden as a whole with a **Spoiler** toggle, whatever its type (2026-10-20). Images and galleries in page text can be spoilers (blurred until clicked).
- Never hidden: page titles, aliases, category names, the sidebar, and the fact that one page links to another. A value hidden as a spoiler stays hidden wherever it shows up again (reverse fields in M9, search in M10, field names on graph lines in M11, timelines, trees…).

### 7. Working mode
- Juku doesn't need to understand or maintain the code. Claude builds, tests, and documents. Explanations stay short and user-facing.
- Building happens in **Claude Code on Juku's Mac**, working in this repo. Planning and feature discussion happen in the claude.ai project "Own WIKI".
- This repo contains only program code, never story content. Test fixtures use neutral placeholder data.

### 8. Features (Juku, 2026-10-17)
Inspiration: Wikipedia, A Wiki of Ice and Fire (AWOIAF), Chronicler.
- **Links:** manual, `[[Page]]`, with autocomplete while typing. Display text can differ from the target (`[[John Snow|John]]` shows "John"). Renaming a page updates every link to it. No automatic linking of plain words.
- **Editor:** Markdown stays the file format. Editor = Markdown source with a formatting toolbar and keyboard shortcuts (headings, bold, lists, links…), plus a **live preview side by side** (option A). Juku never has to type Markdown syntax. Possible later upgrade: Obsidian-style inline live preview.
- **Templates and infoboxes:** user-defined templates per project (characters, locations, items… — defined by the user, never shipped). New pages are pre-filled. AWOIAF-style infobox with images and captions. Fields are **typed** (text, link to page, date, image, list…) so maps, timelines and family trees can read them.
  - (Changed 2026-10-18.) A template is a **starting point**: a new page gets its own copy of the template's fields. Changing a template never changes existing pages on its own; **Apply to existing pages…** pushes a change to the chosen pages when Juku wants it.
  - Values are never lost silently: a field removed by Apply **hides** its values on those pages instead of deleting them.
  - Relations are entered once: reverse fields fill themselves (M9 Relations, 2026-10-19). Example: John's *Father* field links Alex → Alex's *Children* shows John. Shown from the link index. Stored from the specific to the general only: the relation lives in the child's parent field (*Father*, *Mother*), never in a *Children* list. Entered from either side (2026-10-20): adding a child on Alex's page asks which of the child's parent fields Alex fills ("Alex is John's: Father / Mother"), writes Alex into that field on John's page and stores nothing on Alex's page — the only case where the app writes into another page's file; the same write-back is reused by family-tree edits (M15). Two-way fields (e.g. *Spouse*) work both ways. Children typed in by hand still work; duplicates are merged. A child without a page can be created from the parent's page; a parent field already holding another page asks Replace / Add (2026-10-20).
  - **Divider** field type: a thin separating line in the infobox, with an optional label.
- **Categories:** easy to add per page, AWOIAF-style list at the bottom of the page, automatic category pages with optional own text, subcategories, and default categories from templates.
- **Embeds:** insert the content of one page into another (navboxes, item cards, stat blocks). Plain embeds first; embeds with parameters only if needed later. Embed loops are detected and blocked.
- **Automatic page lists:** a section at the bottom of a page listing the pages whose fields link here, e.g. "Chapters that take place at …" on a place page, filled from the chapter pages' place fields (M9).
- **Quote boxes:** AWOIAF-style quote box (quote + attribution), inserted by hand in the text. "Quotes by" / "Quotes about" are ordinary sections the user writes (e.g. in a template's starter text); no automatic collection.
- **Separator lines in text:** thin horizontal line (`---`), with a toolbar button.
- **Health reports:** auto-generated reports (broken links, orphan pages, unlinked mentions, missing images, duplicate titles, sync conflicts, hidden template values…) with tools to fix them.
- **Graph view:** Obsidian-style interactive network of linked pages. Must handle thousands of pages: local graph (neighbours of the current page) plus a filterable global graph. Local graph as a panel beside the page; own colour rules; red links, categories and groups can be shown as nodes; every link is drawn, field names on lines follow the eye switch (Juku, 2026-10-21; scope in M11).
- **Themes:** user-created, selectable, editable themes. A theme is either app-wide or belongs to one project (stored in and synced with that project); a project can use its own theme instead of the app-wide one. UI styling uses CSS variables from the start so themes are cheap to add. A theme sets colours, fonts (body text and headings separately), text size, line spacing and page width (2026-10-19). Fonts a theme uses are copied into the project/theme so Mac and Windows look the same. Custom CSS on top: not for now, can be added later (Juku, 2026-10-20). The app itself is always light on Mac and Windows, regardless of the system's dark mode (2026-10-19); other looks come only from themes. Themes set one look for all pages, infoboxes included; a page can still give its own infobox a different **colour** (not style).
- **Interactive maps:** zoomable, pannable; pins linked to pages with hover preview; drawable regions; nested maps (a pin opens another map); distance measuring.
  - Map source (changed 2026-10-18) is either a painted image (Photoshop) exported as a large PNG (ideally 8,000+ px on the long side), which the app tiles for smooth deep zoom, or an **SVG**, which stays sharp at any zoom without tiling (very detailed SVGs can zoom slowly; PNG stays the safe choice for big painted maps). Pins, regions, labels and distance lines are vector overlays drawn by the app and stay sharp at any zoom.
- **Timelines** with **custom calendars** (own months, eras), fuzzy dates ("c. 250") and date ranges (e.g. reigns).
- **Family trees:** generated automatically from infobox link fields, editable, and also creatable manually. Must support multiple spouses, unknown parents, intermarriage and incest (the "tree" is really a graph).
  - Editing a relation in the tree writes it back to the infobox fields of the pages involved (one source of truth).
  - Trees may contain people without a page (placeholders); a placeholder can later be turned into a page.
- **Deep search:** full-text search across page text, infobox fields and aliases; finds every mention. Own Search screen, matches word starts, spoilers follow the eye switch (M10).
- **Solar system map:** later version, details to be defined.
- Additions proposed by Claude and approved by Juku (2026-10-17): red links (link to a missing page, click to create it), "What links here" (backlinks), hover previews for every link, aliases/redirects, automatic table of contents, footnotes/citations, a main page per project, tables, image galleries, quick-open by title (Cmd+O). Page history/undo of edits: later.


## Milestones
Milestones are defined here before they are built. Each gets its detailed scope here before it is built; once done, the scope moves to `docs/history.md` and its lasting rules go into "Rules from finished milestones" below.

### Roadmap (draft, 2026-10-17)
Order follows dependencies: typed fields before maps/timelines/trees; links before graph and health reports. Juku plans to start entering real content **after M7**.

**v1**
- **M1 Foundation** (done 2026-10-17): app shell, library folder, projects, basic Markdown pages, safe writes, Windows CI.
- **M2 Structure** (done 2026-10-17): groups (nested folders), sidebar tree, move pages between groups, quick-open by title, project-wide unique titles, path-length warning.
- **M3 Editor** (done 2026-10-17): split-screen live preview, toolbar + shortcuts, table of contents, tables, footnotes, paste with formatting, word count, Wikipedia-like page look, theme-ready styling (CSS variables).
- **M4 Links** (done 2026-10-18): `[[ ]]` with autocomplete and display text, red links, backlinks, link rewrite on rename, hover previews, aliases/redirects, main page per project, back/forward, link index in `.cache/`.
- **M5 Templates & infoboxes** (done 2026-10-18): template editor, typed fields, AWOIAF-style infobox, image fields, calendar-ready dates, Apply to existing pages.
- **M6 Images & categories** (done 2026-10-18): images in page text, captions, galleries, drag and drop, SVG, uniform infobox image frames, categories with category pages, subcategories, template default categories, sort keys, project settings.
- **M7 Spoilers & embeds** (done 2026-10-20), plus small additions (2026-10-19): AWOIAF-style quote box; separator line in text (toolbar button) and Divider infobox field with optional label; thinner Contents box; app always light; collapsible embed boxes.

**After v1 start**
- **M8 Themes** (done 2026-10-20), plus app-styled tooltips: built-in, app-wide and project themes; colours, a font for every part of the page, sizes and shapes (title position, heading lines, box frames, ornaments, shadows); AWOIAF built-in with its own fonts.
- **M9 Relations** (done 2026-10-21): Linked from fields that fill themselves, two-way fields, entering and removing relations from either side (writes the other page), sort orders, page lists (bottom of the page and `<pagelist>` lines), the Relations table; plus checkpoint additions: Create page… from fields, Add several… / picking several pages, Date, place and Date, text fields, ages, words around links, AWOIAF infobox look, hide sidebar, draggable page width.
- **M10 Search & sync safety** (done 2026-10-21): Search screen (word starts, filters, spoilers follow the eye switch), find on page; no blind overwrites, live reload, edit clash bar, conflict copies (also edits Drive silently overwrote) and the Conflicts screen, open-on-another-computer warning; easier field moving in the infobox editors; plus Move library…, a synced page edge, What links here listing relations, caches out of the Drive folder. Mac and Windows can now both be used with the library in Drive.
- **M11 Graph view.**
- **M12 Health reports.**
- **M13 Interactive maps.**
- **M14 Calendars & timelines.**
- **M15 Family trees** (builds on M9 Relations).
- **M16 Solar system map** (later version, scope to be defined).
- **M17 Export:** zip, static HTML site.

### How every milestone is written
- **Done when** always includes: new features have automated UI tests (Playwright smoke tests in `tests/ui/`) and pass with the Rust and unit tests; screenshots check how new or changed screens look; speed targets only if the milestone touches loading, the index, search or big lists; this milestone's diff reviewed once for bugs and duplicated code; the Mac app built, installed and checked once on screen; the Windows workflow produces an installer; Juku has reviewed the installed app and approved it.
- A milestone may name a **checkpoint** partway for Juku. A session that ends partway adds a short **Progress** note (done / left / open questions) to the milestone here.

### M11 — Graph view (defined 2026-10-21)
An Obsidian-style map of how pages link, for the whole project and around the current page.

**What the graph shows**
- Nodes = pages; lines = links between them: text links and infobox link fields (relations included). Embeds don't count (M7 rule). Several links between the same two pages make one line. Reverse fields (M9) are the same link seen from the other side, so no extra line.
- Node size grows with the number of links. Page names show once zoomed in far enough, and always for the hovered page and its neighbours.
- **Extra nodes**, each with its own on/off switch (Juku): **red links** (linked but missing pages, greyed; click creates the page like a red link), **categories** (a node per category, lined to its member pages and to its parent categories), **groups** (a node per group, lined to the pages directly inside and to its parent group). Off by default.
- **Spoilers** (Juku): every line is drawn, also for links in spoiler text or spoiler fields (keeps rule 6: the fact that a page links to another is never hidden). Hovering a page labels its lines with the infobox field names (*Father*, *Spouse*…); names of spoiler fields and links inside `||…||` only show while the global eye switch is on. Text links have no label.
- Arrows showing link direction: on/off switch, off by default.

**Global graph**
- Own **Graph** screen: button in the sidebar header and Cmd+Alt+G (Ctrl+Alt+G).
- Zoom, pan, drag a node to move it. Hover highlights the page and its neighbours (rest fades) and shows the usual hover card; click opens the page; Back returns to the graph where it was.
- **Search box** highlights matching titles and aliases (word starts, as in M10) and zooms to the first match.
- **Filters:** group (incl. subgroups), category, template, hide orphans (pages without links), text links on/off, infobox links on/off, plus the extra-node switches. Filters are remembered per project on each computer (not synced).
- **Stable layout:** positions are remembered per project on each computer (app cache folder, not synced), so the graph doesn't reshuffle on every open. New pages appear next to their neighbours; **Re-arrange** lays everything out fresh.
- Updates live on save, rename, move, delete and live reload (M10).

**Local graph**
- A **panel beside the page** (Juku), opened and closed with a button on the page (open/closed remembered per computer): the current page in the centre, its neighbours around it, **depth 1–3**. Same hover, click, labels and spoiler behaviour; the same switches for link types and extra nodes. Follows the page you're on. **Open in Graph** opens the full screen centred on this page.

**Colour rules** (Juku)
- Obsidian-style list on the Graph screen: each rule is **template**, **group** (incl. subgroups) or **category** = a chosen colour. First matching rule wins; drag to reorder; pages matching none use the theme's node colour. Saved in `project.json` (synced), so both computers show the same colours. Used by the global graph and the local panel.

**Look**
- New theme settings (theme contract: `src/theme.css`, `docs/theme-variables.md`, `src/themes/vars.ts`): graph background, node, highlighted node, faded node, line, highlighted line, label text, red-link node, category node, group node. The built-in themes (AWOIAF included) get values.

**Checkpoint for Juku:** the Graph screen with every page and link, zoom/pan/drag, hover highlight and hover card, click to open, stable layout, speed targets met. After it: extra nodes, labels and spoilers, filters and search, colour rules, local panel, theme settings.

- **Done when:** the points above work; new features have Playwright UI tests (Graph screen opens from button and shortcut, click opens a page and Back returns, hover highlights neighbours, each extra-node switch, spoiler field names hidden until the eye switch is on, filters and search, colour rules incl. order, local panel with depth, Open in Graph, graph updates after a save and a rename) and pass with the Rust and unit tests (graph data from the index: deduplicated lines, red-link/category/group nodes, spoiler flags on links, filter logic, rule matching); screenshots check the Graph screen, the local panel, the colour-rule editor and the graph in the built-in themes; with a generated 5,000-page / 25,000-link project the Graph screen first shows within about 2 s (under 1 s with remembered positions), zooms and pans smoothly, the local panel opens without noticeable delay and a save doesn't make the graph stutter; a 5,000-page project still reopens in under 1 s if the index changes; this milestone's diff reviewed once for bugs and duplicated code; the Mac app built, installed and checked once on screen; the Windows workflow produces an installer; Juku has reviewed the installed app and approved it.

## Rules from finished milestones (M1–M10)
Everything later work must keep working. Reasons and full detail: `docs/history.md` (search it).

**Stack and code**
- Tauri 2 + React + TypeScript. Rust does all file access (commands in `src-tauri/src/lib.rs`, typed wrappers in `src/api.ts`). Editor: CodeMirror 6. Pasted HTML → Markdown via Turndown. Web links open through the opener plugin; plain paste reads the clipboard plugin.
- Links are parsed in both Rust (index, rewrites) and TypeScript (rendering, editor); both run `shared-tests/links.json`, so change both together.
- Theme contract: every colour and font, the type scale and main layout widths are CSS variables in `src/theme.css`, listed in `docs/theme-variables.md` and offered by the editor in `src/themes/vars.ts` (keep all three in sync). No hard-coded colours. The app is always light, title bar included (window `theme: "Light"`); the system's dark mode is ignored; other looks only from themes.
- Per-machine settings (library path) live in `settings.json` in the OS app-config folder. Per-computer UI state (open groups, editor divider, folded contents sections, "Include pages of subcategories", the global "show all spoilers" switch, the hidden sidebar, where the page's right edge was dragged to) lives in browser local storage. Neither is ever synced.
- App id `io.github.zzjuku.ownwiki`, display name "Own WIKI" (placeholder). Windows installer: NSIS, built by `.github/workflows/windows.yml`. Builds unsigned.

**Folders and files**
- Project folder: `project.json`, `pages/`, `assets/`, `categories/` (caches live in the app's local cache folder since M10, not in the project). Project folder named after the project; renaming renames it.
- Every write: temp file + rename. Every delete (project, page, group, category file) goes to the system Trash / Recycle Bin after a confirmation that states what's affected.
- `project.json` keys: `name`, `formatVersion` (1), `templates`, `mainPage` (title), `infoboxImage` (project frame `{width, height}`, default 250 × 300), `hideCategoryBox`, `presentDay` (a date: the story's "today", for ages). Unknown keys are kept, everywhere (project.json, front matter, fields).
- Pages: `pages/…/Title.md`; groups are subfolders (nested). Page and group ids are `/`-separated paths inside `pages/`. A group's name is its folder name (characters invalid in file names become `-`). Two titles mapping to one file name in a folder: the second gets " (2)" etc. Renaming a page renames its file. Files without front matter stay without it when saved.
- Page front matter keys: `title` (the real title), `aliases` (list), `categories` (list), `sort` ("Sort as"), `infobox` (`template`, `color`, `ownColor`, `fields`, `hidden`).
- Category files: `categories/Name.md` (named like pages, " (2)" on clashes) with own text and `parents`; created when a category gets text or parents, or is created from a red link / New category. A category exists while a page, template default, subcategory or its own file uses it.
- Link index: `link-index.json` in the project's cache folder (cache version 8; bump when its format changes), per-file modification time and size for incremental rebuilds. Holds titles, aliases, headings, outgoing links (text and infobox; infobox links know their field, whether two-way, spoiler, in text or typed in), embeds (kept apart from links), opening paragraphs (quote boxes, embed and `<pagelist>` lines left out, never cut inside a spoiler), hover-card image (not a spoiler image, not a picture beside the title), categories, parents and sort keys ("Sort as"), the infobox's fields (label, type), its Linked from settings, and sortable values (numbers; dates as year/month/day; not spoiler fields); also serves the page tree. Updated on every save, rename, move and delete; written at most every 10 s for small changes. Files changed outside the app are picked up by live reload (M10).
- Image thumbnails: `thumbs/` in the project's cache folder, widths 320/640/1280/2560 px; at most 2 big images decoded at once; SVG and GIF shown as they are. Images reach the page only through the `wikiasset:` URL scheme, which reads only a project's `assets/`; SVG responses carry a policy that blocks scripts.

**Names**
- Names differing only in upper/lower case are the same name (projects, groups among siblings, titles, aliases, categories).
- Page titles are unique across the project; titles and aliases share one name space. Category names are their own name space (a page and a category may share a name).
- Not allowed in titles, aliases and category names: `[ ] | #`. Titles and aliases can't start with "Category:" or "File:". Existing names that break a rule show a rename notice in the header, never an error.
- Group names unique among siblings; a move onto a same-named group is refused (no merging); a group can't move into itself or its subgroups.
- Path-length warning: path from the library folder + 60 characters reserved, above 240 → warn; the user may continue (`allowLong`).
- Sidebar order: natural alphabetical (ignores case and accents, "Page 2" before "Page 10"), groups before pages. Category pages sort by `sort`, else title.

**Link syntax and behaviour**
- `[[Page]]`, `[[Page|text]]`, `[[Page#Section]]`, `[[Page#Section|text]]`, `[[#Section]]`. Case-insensitive. Pipe trick `[[Page A (X)|]]` shows "Page A". Letters right after `]]` join the link. A link to its own page shows bold text. A section link without text shows "Page § Section". A missing section opens the top of the page. Text in code is never a link and never rewritten. In tables a link's `|` is written `\|`.
- `[[Category:Name]]` (also `[[Category: Name]]`) links a category page; red if missing, click creates it. `[[File:…]]` is image syntax (below).
- Heading anchors: lower-case, spaces → `-`, duplicates `-2`, `-3`….
- Links in infobox text and Page link fields count as links everywhere (red links, previews, rename rewrite, What links here "via infobox: field").
- Renaming a page rewrites `[[Old]]` → `[[New]]`, `[[Old#S]]` → `[[New#S]]` and embeds `{{Old…}}` → `{{New…}}` in pages, category texts and infobox fields; links with own text keep it; links through an alias are untouched; `mainPage` follows; optional "keep old title as alias". Renaming a heading doesn't rewrite links. Deleting a page turns its links red.
- New projects get an empty "Main Page" set as main page.

**Images**
- In text: `[[File:Name.png|right|medium|Caption]]`; positions `right` (default), `left`, `center`, `full`; sizes `small` 160, `medium` (default) 250, `large` 400 px; option `spoiler` (blurred until clicked). In captions `|` is stored as `&#124;` (read back as `|`, so `||spoilers||` work there) and an unfinished `[[` as `[`. Galleries: `<gallery>` (or `<gallery spoiler>`) … one `File|Caption` line per image … `</gallery>`.
- Import (button, drag and drop, paste, Image fields) copies into `assets/`, keeps the original name (" (2)" on clashes), the same file twice is stored once, pasted images are named "Pasted image.png". Removing an image never deletes its file.
- Formats: PNG, JPG, GIF, WebP, SVG in text and galleries; Image fields: no SVG.

**Templates and infobox fields**
- Field: `key` (template field it came from; absent = the page's own), `label`, `type`, `hint`, `options`, `value`. A page's field may have `spoiler: true` (whole value hidden until clicked; templates can't set it; Apply keeps it).
- Types: `text`, `longtext`, `number`, `yesno`, `choice` (`options.choices`), `list`, `links` ("Page link": one page or several, stored as a list; `options.twoWay`; the older one-page `link` type still reads and edits but isn't offered), `linkedfrom` ("Linked from", see Relations), `date` (`options.ranges`), `dateplace` ("Date, place": a date or range, the place on its own line under it), `datetext` ("Date, text": a date or range, then a smaller note), `image`, `heading`, `divider` (a line in the box, optional label, no value). Date, place / Date, text value: `{date, text}`, a list of them with `options.multiple` ("Several entries"); their text may hold links, which count like links in text fields.
- A Page link entry is a page name (`Page A`, `Page A#Section`) or words around a link (`Lord [[Page A]] (supposedly)`, the Aa button): the words show only in that infobox; everything else goes by the link.
- `options.place`: Text, Choice and List fields can show `above` or `below` the infobox title (titles, nicknames; smaller), Image fields `beside` it (small pictures left and right; one picture shows on both sides, two go one each side). They aren't repeated as rows unless `options.inBox` ("Also show it in the box", above/below only).
- `options.age` on Date and Date, place fields: `birth` shows "(age N)" counted to the project's `presentDay` while no death field has anything in it; `death` shows "(aged N)". Whole years (one less before the birthday when months/days are known), "c." when either date is approximate, nothing across different era names; an age from a spoiler birth date is hidden too.
- Date value: `{year, era, month, day, qualifier: c|before|after}`, or with ranges `{start: {…}, end: {…} | "present"}`. Shown day.month.year until M13 maps eras and months to calendars.
- Image value: `{file, caption, crop: {x, y, zoom, aspect}}` (x/y in percent, zoom 1 = fills the frame, aspect = width/height; no zoom = simply fills). Every infobox image sits in one frame size: the template's `imageFrame`, else the project's `infoboxImage`; never copied into pages.
- Text fields allow bold, italic, `[[links]]`, `||spoilers||`.
- Template field keys are random ("f-k2j4") and never reused; template ids are readable + random ("template-a-54px").
- A template is a starting point: a new page copies its fields, colour, starter text and default categories. Editing, renaming or deleting a template never changes pages by itself.
- **Apply to existing pages…** (per page, untickable; dry run shows the changes): adds new fields; updates labels, types, hints, options and order; renamed fields keep their values; fields removed from the template become **hidden values** (never deleted); fields the page added itself are untouched, except one named like a new template field, which becomes it with its value; template fields deleted on a page come back; colour only on pages without their own (`ownColor`); starter text never; default categories added, never removed.
- Change template: same-named fields keep values, the rest become hidden values. Changing a field's type keeps values that don't fit, with a warning. Values are never lost silently.

**Spoilers, quote boxes, embeds (M7)**
- Spoiler `||text||`: first character not `|` or a space, shortest text up to `||` not ending in `\`, one line only (TS `SPOILER_AT_START` = Rust `spoiler_at`); in table rows `\|\|`. The Spoiler button / Cmd+Shift+S wraps each selected line on its own. Hidden everywhere their text shows (text, headings and the Contents panel, tables, footnotes, captions, quote boxes, infobox values, category text, hover cards, What links here lines, embeds); never hidden: titles, aliases, category names, the sidebar, the existence of links.
- A click reveals one spoiler (a link inside isn't followed by that click) until the page is left; "Reveal spoilers" in the header shows all of the page's, "Hide spoilers" hides all again; the global eye switch in the sidebar shows them everywhere (per computer) with a visible bar while on. The editor preview shows them revealed but marked. Hover cards never reveal. Spoiler colours and blur are theme variables.
- Quote box: `<quote>` line, quote text lines (blank line = paragraph), optional `<by>…</by>` and `<source>…</source>` lines, `</quote>`; written by the Quote box dialog, clicking it in the source reopens the dialog. Left out of hover previews; links in it count.
- Separator line button writes `---` with blank lines around it.
- Embeds: a line holding only `{{Page}}` (infobox + text), `{{Page#Section}}` (that section up to the next heading of the same or higher level, with its notes) or `{{Page|infobox}}`; options `|collapsible` / `|collapsed` make an AWOIAF-style box with a title bar and [show]/[hide], starting open or closed. Written by the Embed dialog; clicking an embed line in the source shows Open, Change…, Remove. Always the current content (loaded through `embed_sources`). Seamless look with an "open page" link on hover. Links inside don't count as the host's; What links here lists "Embedded in" apart. Missing page: red box, click creates it. Up to 5 levels; self-embeds, loops and deeper ones show a warning box. Embedded headings stay out of the host's Contents (their ids are dropped, footnote ids prefixed); the embedded page's categories don't carry over. Works in page text and category text, not in infobox fields.

**Themes and tooltips (M8)**
- A theme is a list of CSS variables (`theme.json`: `name`, `formatVersion` 1, `vars`, `fonts` [{family, file, weight, style}]); unknown keys kept. A theme stores only what it sets; defaults written as `var(--x)` follow that variable, and computed followers (`RULES` in `src/themes/engine.ts`) are written only when a setting they follow is changed, so an unchanged copy of Default looks exactly like Default.
- Look settings are keyword variables (`--title-align`, `--heading-deco`, `--infobox-frame`, …) read by container style queries in `src/styles/look.css`; their defaults change nothing. New shapes go there the same way. No custom CSS (not for now).
- Ornaments drawn as `::before`/`::after` always exist and are shown only through a `--show-…` variable the style query sets (`display: var(--show-…, none)`): WebKit (the app's engine) keeps drawing a pseudo-element after a style query around it stops matching, which left corner ornaments at the wrong place when switching frames (fixed 2026-10-21). Shapes without pseudo-elements (borders, background layers) can sit in the query directly. Check shape changes in Safari/WebKit, not only Chromium.
- App-wide themes: library folder `_themes/<Name>/` (theme.json, `fonts/`), chosen one in `_themes/settings.json` (`active`: "builtin:<id>" / "app:<folder>"), all synced. Project themes: `<project>/themes/<Name>/`; project.json `theme` ("builtin:<id>" / "project:<folder>", absent = app theme). A project's theme wins while it's open; the library uses the app theme. `_themes` is no project and not allowed as a project name.
- Built-ins (Default, Parchment, AWOIAF, AWOIAF Modern, Folio, Slate, Midnight) live in code, can't be edited or deleted, only copied. Their fonts come with Mac and Windows or with the app (`src/themes/fonts/`, OFL); copying a theme copies its fonts.
- Fonts used by a theme are always copied into its folder (installed fonts incl. faces out of .ttc collections, or imported .ttf/.otf/.woff/.woff2) and loaded with the FontFace API under a generated one-word name per theme and family. Every part of the page has its own font variable (`--font-title`, `--font-infobox-…`, `--font-toc`, …), following the page or headings font when unset.
- Theme names unique per place (case-insensitive); deleting goes to the Trash; a deleted theme in use falls back to Default / the app theme. Edits save automatically and show live when the theme is in use.
- More shapes (2026-10-21): frames `bracket` (corner marks), `rule` (lines above and below); one corner rounding `--box-radius` (0 by default) for every box on the page with any frame (Juku: one shared setting, not per box; ornate and bracket frames stay square; embed boxes can still have their own); tables use separate cell borders so they can round (unchanged look when square); heading lines `double` and `bar` (accent bar at the left); title line `double`; quote style `bar`; letters (`normal` / `caps` / `small-caps`) for the title, section headings and infobox section headings; title and heading weight. Bundled fonts: Marcellus, Uncial Antiqua, Jost, Inter, EB Garamond (OFL, `src/themes/fonts/`, listed in `src-tauri/src/fonts.rs`).
- Infobox look settings (2026-10-21): `--infobox-heading-style` (`bar` / `lined`: larger, thin lines above and below), `--infobox-label-weight`, `--infobox-row-space` (row spacing); the ornate infobox frame has AWOIAF's corner ornament at all four corners. Default infobox width 24em. Copying a built-in theme writes its fonts from the app itself (built into the program), never through the window.
- Tooltips: every `title` shows as an app-styled tooltip (`src/Tooltip.tsx`; the title moves to `data-tip` while hovered); page links have no title and keep their hover cards. Shortcuts stay in the text. Colours `--tooltip-bg`/`--tooltip-text`.

**Relations and page lists (M9)**
- A relation is stored once, on the specific side: a Page link field (John's *Father* → Alex). A **Linked from** field (`options.from`: field names, case-insensitive; `templates`: template ids, empty = any; `sortBy`: a number or date field name, else natural title order, pages without the value last; `show: "list"` + `listHeading`) shows the pages whose named fields point here, plus names typed into it (its `value`; they count as links). Each page once; an entry is a spoiler only if every link bringing it is one. Text-field `[[links]]` count when a Linked from field reads that field.
- **Two-way** Page link fields: a link shows on the other page if it has a Page link field of the same name; entered on both sides = shown once.
- Entering from the reverse side writes the other page (`set_relation`: add / replace / remove, Rust `src-tauri/src/relations.rs`), the only case where the app writes into another page's file: Add… ("Alex is John's: Father / Mother"; a taken field asks Replace / Add too; a non-Page-link field is greyed out, never written as text; a missing field is added as the page's own Page link field; a missing page: Create page… first), Add several… (one choice for all, a line per page, taken fields: add next to / replace / leave), × removes with confirmation (text-field links are changed by hand). Nothing is stored on the reverse side's page.
- Renaming a template field renames it in every template's Linked from `from`/`sortBy` when the label box is left (added next to the old name while another template still has it). The template editor and Infobox tab warn when a `from` name matches no field or only Linked from fields.
- Page lists: a Linked from field shown as a list goes after the page text under an `##` heading (in Contents), not in the infobox; a `<pagelist from="Field, Field" templates="Template name" sort="Field">` line (names, `"` as `&quot;`) lists what points to the page it's on (an embedded page's list: that page). Written by the Page list dialog; clicking the line reopens it. Empty lists show nothing (the editor preview says so).
- What links here names no spoiler field ("a spoiler field"). The **Relations** screen lists every Page link relation and typed-in name, where it shows up, and problems (missing page, nothing on the linked page shows it, link to its own page, Linked from names no field has); spoiler rows stay hidden and match the filter only by their own page.
- Pages created from a page (red links, Create page… in fields) get that page's template preselected; nothing is created before Create.

**Picking several pages, layout (M9 additions)**
- Sidebar: ⌘/Ctrl-click picks pages (the open page counts), Shift-click a run; the bar moves, categorises or trashes them together; dragging a picked page moves all; a plain click or Escape lets go. Enter in a List or Page link entry starts the next entry.
- The sidebar can be hidden (⌘\ / Ctrl+\). Dragging the page's right edge fixes where it sits on screen (all projects, per computer, over the theme's page width; double-click: the theme's again): the infobox stays put when the sidebar is hidden or shown.

**Search & sync safety (M10)**
- Search runs in Rust (`search.rs`, `searchtext.rs`), index in the project's cache folder, synced lazily with the link index's file times. Matching (TS `src/search.ts` = Rust, `shared-tests/search.json`): case and accents ignored, each word matches word starts, all words on the page, `"phrases"`. Searched: titles, aliases, page text (tables, footnotes, captions, quote boxes), infobox values as shown, typed-in Linked from names, category text; links also by target. Not searched: hidden template values, embeds, code. Ranking: title, alias, infobox, text. Spoilers follow the eye switch (off: not searched, snippets leave them out; headings with spoilers show ▒▒▒). Cmd+Shift+F / sidebar box; Cmd+O stays title-only. Back returns to the results.
- Find on page (Cmd+F, read view and category pages) uses the same rules, paints with the CSS Custom Highlight API (HTML never changed), skips hidden spoilers until revealed, matches links by target too.
- Every save from the UI sends the version it loaded (hash of the file); a file changed on disk since is not overwritten (kind "changed"), except over the app's own last write. Write-backs into other pages read the file fresh.
- Live reload: watcher on the open project and `_themes/` (notices plus a look over the files every 2 s; batches until 300 ms quiet), the app's own writes/renames/Trash moves left out; event "files-changed". Open page: no unsaved edits → reloads in place (editor keeps its cursor) with a notice; unsaved → bar Show differences / Use the other version / Keep mine (the version not kept goes to the Trash); deleted → Keep it / Close; moved → followed. Templates, settings, themes, category text changed while edited: the newer is shown, the last local change dropped with a notice (category text to the Trash).
- Conflict copies: same title (pages) or name (category files), or `project*.json` / `theme*.json` next to the real one. Original = named after its title, else older. Copies stay out of sidebar, links, search, relations; "Conflicts N" in the sidebar; Conflicts screen side by side (text by line, infobox by field): Keep the original / Keep the copy / Keep both (pages, categories: "<Title> (copy)"). Keeping a copy merges edit counts.
- Lost edits: page and category files with front matter carry `edits: {<computer id>: n}` (counted on every write); each computer remembers its last write per file in its app-config folder (`edits/`). A file showing a lower count for this computer than it wrote → the lost text comes back as "<Title> (from <computer>).md" (a conflict copy). Checked on file changes and on project open.
- Unreadable page files are never overwritten: a notice with Try again instead of the editor.
- Open-on-another-computer: `_open/<computer id>.json` in the project (computer name, since, refreshed every 2 min; stale after 6 min; removed on leaving the project and on quitting). Opening a project with a fresh marker of another computer asks Open anyway / Cancel.
- Quitting (⌘Q or closing the window) saves unsaved edits first.
- Caches (link and search index, thumbnails, versions not kept) live in the app's local cache folder, one folder per project, never in the library.
- Infobox editors: dragging near the list's edge scrolls it; a section heading moves with its fields and lands only between sections; ⋯ → Move to section… (fields to the end of a section, headings after another section).
- Settings → Move library… copies the projects and `_themes` (nothing else) to a chosen folder (itself if empty, else a new "Own WIKI" folder), checks the copy and switches; originals stay.
- The dragged page edge is a share of the window width kept in `_themes/settings.json` (`pageEdge`), the same on all computers.
- What links here also lists, apart, pages that show the page through relations stored on it (counted in "Links here").

**Behaviour to keep**
- Autosave a moment after typing stops and before switching pages, leaving the project, closing the window or quitting; no Save button.
- Pages open in the read view; new pages open in the editor. Shortcuts in use (Ctrl on Windows): Cmd+O quick-open, Cmd+Shift+F search, Cmd+F find (read view: find on page; editor: its own find), Cmd+E read/edit, Cmd+B/I bold/italic, Cmd+Shift+X strikethrough, Cmd+Shift+S spoiler, Cmd+Alt+1/2/3 headings, Cmd+Shift+8/7 lists, Cmd+K link, Cmd+Z / Cmd+Shift+Z undo/redo, Cmd+Shift+V plain paste, Cmd+[ / Cmd+] back/forward (Alt+Left/Right on Windows), Cmd+click follows a link in the source.
- One Enter = new line in the preview; an empty line = new paragraph.

**Promised to later milestones (from M1–M9 scopes)**
- M12: health reports link to the Conflicts screen (conflict copies).
- M17: exports leave out `_open/` (open-on-another-computer markers) and the `edits` counts in front matter.
- M12: unlinked mentions, broken section links (incl. renamed headings), unused images, hidden template values.
- M13: map location fields; SVG maps.
- M14: eras and month numbers mapped to real calendars without a data migration; ages then also across eras (today only within one era name).
- M15: family-tree edits write relations through the same write-back as M9 (`set_relation`).
- Later / undecided: a frame option per theme for plain (seamless) embeds (asked in M8, not answered); hover card rework to look more like AWOIAF's (e.g. bigger picture, wider card; details to define), Obsidian-style inline live preview, page history/undo of edits, replace across pages (offered for M10, not now; Search screen could host it), image file pages ("File:" pages with description), group overview pages (Open items). Not planned: categories driven by field values, automatic linking of plain words.

## Open items (from Juku)
- **Group overview pages** (a page per group listing its contents, maybe with own text): wanted later; overlaps with category pages (M6, which can have own text), decide where it fits after M6.
- Visual references (beyond Wikipedia/AWOIAF/Chronicler: what exactly he likes about them)
- App name
- **Spoiler levels per book** ("reveal up to Book 2"): proposed by Claude 2026-10-20, undecided; the `||` format can be extended later without changing existing spoilers.


## Decision log
- Entries up to 2026-10-18 (M1–M6), the M7 entries (2026-10-19 – 2026-10-20), the M8 entries (2026-10-20) and the M9 entries (2026-10-20 – 2026-10-21) and the M10 entries (2026-10-21): see `docs/history.md`.
- 2026-10-18 (maintenance, not a milestone): SPEC.md trimmed; finished scopes and the old decision log moved to `docs/history.md` unchanged, SPEC.md keeps a "Rules from finished milestones" summary. `src/styles.css` split into `src/styles/*.css` by area, imported in the original order from `src/main.tsx` (pure move: the built CSS is byte-identical, screenshots unchanged).
- 2026-10-18 technical: automated UI tests with **Playwright** (Chromium) against the Vite dev server (port 1430) on `tests/ui/harness.html`, which installs an in-memory backend (`tests/ui/mock/`, via Tauri's `mockIPC`) before the app; images answer with a placeholder picture. tauri-driver isn't used (no macOS support). The real file and index logic stays covered by the Rust tests. `npm test` = unit + Rust (also in Windows CI); `npm run test:ui` = type-check + Playwright (Mac only for now). Smoke tests cover opening a project, creating/editing a page, links, infobox from a template, image in text and categories.
- 2026-10-19 (planning): Juku's list of small additions placed. M7 gains an AWOIAF-style quote box (inserted by hand), a separator line in text + Divider infobox field (optional label), a thinner Contents box, and the app is always light on Mac and Windows (replaces "follows the system"). Automatic relation fields pulled forward from Family trees into a new **M8 Relations** (calculated from the link index, never written into other files; parents → children, two-way for spouse), together with automatic page lists such as "Chapters that take place at …". Themes (now M12) also set fonts (body, headings), text size, line spacing and page width; fonts are copied into the project. Later milestones renumbered +1 (old M8 → M9 … M16 → M17); `docs/history.md` keeps the old numbers. Edit/read hotkey already exists (Cmd+E).
- 2026-10-20 (planning): AWOIAF-style rework of the hover cards moved to a later version (listed under "Later / undecided"); the current M4/M6 hover cards stay as they are.
- 2026-10-20 (planning): embed boxes get their own look per theme (frame/box appearance, background, colours), added to M12 Themes.
- 2026-10-21 (planning): Graph view moved ahead of Health reports (Juku). Renumbered: Graph view M12 → M11, Health reports M11 → M12; M13–M17 unchanged. No dependency between the two; `docs/history.md` keeps the old numbers.
- 2026-10-21 (planning, M11 defined): local graph as a panel beside the page with Open in Graph (Juku); node colours from own rules by template / group / category, first match wins, saved in `project.json` (Juku); red links, categories and groups can each be shown as nodes, off by default (Juku); every line drawn, field names on lines from spoiler fields or spoiler text only with the eye switch on (Juku). Claude's defaults: one line per page pair, labels on hover, arrows off by default, layout and filters remembered per computer (not synced), Cmd+Alt+G.
- 2026-10-21 technical (planned for M11): WebGL drawing (sigma.js + graphology) with the force layout in a web worker, so thousands of nodes stay smooth; the build session confirms this with the speed test. Links inside `||…||` text need a spoiler flag in the link index (cache version bump).
