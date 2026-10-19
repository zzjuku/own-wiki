# Own WIKI — Spec (v0.13, 2026-10-20)

This file is the single source of truth for what the program is and why. Update the decision log whenever a decision changes. Detailed scopes and decisions of finished milestones are in `docs/history.md`.

Status: M1–M6 done; M7 defined (2026-10-20), next to build; roadmap M8–M17 drafted.

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
    .cache/             # search index etc. Rebuildable, never synced, never exported.
  ```
- All projects live in one **library folder**. The user chooses its location in the app settings.
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
  - keep caches/indexes out of the synced data (`.cache/`)
  - write files safely (write a temp file, then rename) so a half-synced file can't corrupt a page
- Limitation: don't edit the same page on both machines at the same time.
- Windows path limit (~260 characters): deeply nested groups plus long titles inside the Drive folder can exceed it. The app warns when a path gets close to the limit.

### 5. Users and privacy
- Single user. No accounts, no server, no cloud dependency.

### 6. Spoilers
- **Inline**, Discord-style: `||hidden text||`. The text stays hidden until clicked to reveal.
- Spoilers stay hidden everywhere their text appears: page text, infobox fields, hover previews, embeds and search results.
- "Reveal all spoilers" exists both per page and as a global switch for everywhere (2026-10-19). Per page: lasts until the page is left. Global switch: stays on until switched off, remembered per computer (browser local storage, never synced).
- Every infobox field on a page can be hidden as a whole with a **Spoiler** toggle, whatever its type (2026-10-20). Images and galleries in page text can be spoilers (blurred until clicked).
- Never hidden: page titles, aliases, category names, the sidebar, and the fact that one page links to another. A value hidden as a spoiler stays hidden wherever it shows up again (reverse fields in M8, search in M9, timelines, trees…).

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
  - Relations are entered once: reverse fields fill themselves (M8 Relations, 2026-10-19). Example: John's *Father* field links Alex → Alex's *Children* shows John. Shown from the link index, never written into the other page's file. Works from the specific to the general only: parents are entered on the child (a *Children* list can't fill *Father*, the app can't tell father from mother). Two-way fields (e.g. *Spouse*) work both ways. Children typed in by hand still work; duplicates are merged.
  - **Divider** field type: a thin separating line in the infobox, with an optional label.
- **Categories:** easy to add per page, AWOIAF-style list at the bottom of the page, automatic category pages with optional own text, subcategories, and default categories from templates.
- **Embeds:** insert the content of one page into another (navboxes, item cards, stat blocks). Plain embeds first; embeds with parameters only if needed later. Embed loops are detected and blocked.
- **Automatic page lists:** a section at the bottom of a page listing the pages whose fields link here, e.g. "Chapters that take place at …" on a place page, filled from the chapter pages' place fields (M8).
- **Quote boxes:** AWOIAF-style quote box (quote + attribution), inserted by hand in the text. "Quotes by" / "Quotes about" are ordinary sections the user writes (e.g. in a template's starter text); no automatic collection.
- **Separator lines in text:** thin horizontal line (`---`), with a toolbar button.
- **Health reports:** auto-generated reports (broken links, orphan pages, unlinked mentions, missing images, duplicate titles, sync conflicts, hidden template values…) with tools to fix them.
- **Graph view:** Obsidian-style interactive network of linked pages. Must handle thousands of pages: local graph (neighbours of the current page) plus a filterable global graph.
- **Themes:** user-created, selectable, editable themes. A theme is either app-wide or belongs to one project (stored in and synced with that project); a project can use its own theme instead of the app-wide one. UI styling uses CSS variables from the start so themes are cheap to add. A theme sets colours, fonts (body text and headings separately), text size, line spacing and page width (2026-10-19). Fonts a theme uses are copied into the project/theme so Mac and Windows look the same. Custom CSS on top: undecided, settle before M12. The app itself is always light on Mac and Windows, regardless of the system's dark mode (2026-10-19); other looks come only from themes. Themes set one look for all pages, infoboxes included; a page can still give its own infobox a different **colour** (not style).
- **Interactive maps:** zoomable, pannable; pins linked to pages with hover preview; drawable regions; nested maps (a pin opens another map); distance measuring.
  - Map source (changed 2026-10-18) is either a painted image (Photoshop) exported as a large PNG (ideally 8,000+ px on the long side), which the app tiles for smooth deep zoom, or an **SVG**, which stays sharp at any zoom without tiling (very detailed SVGs can zoom slowly; PNG stays the safe choice for big painted maps). Pins, regions, labels and distance lines are vector overlays drawn by the app and stay sharp at any zoom.
- **Timelines** with **custom calendars** (own months, eras), fuzzy dates ("c. 250") and date ranges (e.g. reigns).
- **Family trees:** generated automatically from infobox link fields, editable, and also creatable manually. Must support multiple spouses, unknown parents, intermarriage and incest (the "tree" is really a graph).
  - Editing a relation in the tree writes it back to the infobox fields of the pages involved (one source of truth).
  - Trees may contain people without a page (placeholders); a placeholder can later be turned into a page.
- **Deep search:** full-text search across page text, infobox fields and aliases; finds every mention.
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
- **M7 Spoilers & embeds**, plus small additions (2026-10-19): AWOIAF-style quote box; separator line in text (toolbar button) and Divider infobox field with optional label; thinner Contents box; app always light.

**After v1 start**
- **M8 Relations** (2026-10-19, pulled forward from Family trees): reverse fields that fill themselves (children from parent fields), two-way fields (spouse), automatic page lists at the bottom of pages (e.g. chapters that take place at a place). A field hidden as a spoiler stays hidden in the reverse field and page lists it fills (2026-10-20).
- **M9 Search & sync safety:** full-text deep search; detect files changed by sync and reload; surface sync-conflict copies. Until M9 is done, Juku uses **only one computer** for real content.
- **M10 Health reports.**
- **M11 Graph view.**
- **M12 Themes:** colours, fonts (body and headings), text size, line spacing, page width.
- **M13 Interactive maps.**
- **M14 Calendars & timelines.**
- **M15 Family trees** (builds on M8 Relations).
- **M16 Solar system map** (later version, scope to be defined).
- **M17 Export:** zip, static HTML site.

### M7 — Spoilers & embeds, plus small additions (defined 2026-10-20)
Juku's answers (2026-10-20) are noted as (Juku).

**Spoilers**
- `||text||` hides text until it's clicked. A **Spoiler** toolbar button (Cmd+Shift+S) wraps the selection, in the editor and in infobox text fields; Juku never types `||`.
- Hidden everywhere their text appears: page text, headings (incl. the Contents panel), tables, footnotes, captions (images, galleries, infobox images), quote boxes, infobox text / long text / list fields, category page text, hover cards and the link index's previews, What links here context lines, embeds.
- (Juku) **Images and galleries in page text** can be spoilers: blurred until clicked (Edit image popup / gallery dialog: "Spoiler").
- (Juku) **Infobox fields:** each field on a page has a **Spoiler** toggle that hides its whole value until clicked, for every type (choice, date, page link, image, yes/no…). Stored on the page's field (`spoiler: true`); templates can't set it.
- Never hidden: page titles, aliases, category names, the sidebar, and the fact that one page links to another.
- (Juku) Clicking a hidden spoiler reveals it until the page is left; a link inside isn't followed by that click. Hover cards never reveal.
- Revealed spoilers keep a faint background so they stay recognisable.
- (Juku) The **editor preview** shows spoilers revealed but marked.
- **Reveal all:** button in the page header (until the page is left) and a global eye switch (stays on until switched off, per computer, never synced); while it's on, a visible marker shows it.
- Spoiler colours are theme variables.

**Embeds**
- An **Embed** toolbar button: pick a page (autocomplete), then (Juku) what to show: **whole page** (infobox + text), **one section**, or **infobox only**. Stored as `{{Page}}`, `{{Page#Section}}`, `{{Page|infobox}}` (Claude's choice; `[[ ]]` stays links only). Clicking an embed in the source opens a popup: Open, Change, Remove.
- An embed always shows the source page's current content; never a copy.
- (Juku) Look: **seamless**, no frame; a small "open page" link appears on hover.
- (Juku) Links inside an embed **don't count as links of the host page** (backlinks, later health reports and graph ignore them; they still show red when missing). The source page's What links here lists **Embedded in** separately.
- Renaming the source page updates its embeds (incl. section embeds). A missing page shows a red box; clicking creates it.
- Embeds inside embeds work up to 5 levels; loops and self-embeds are blocked and show a small warning box instead.
- Headings inside an embed aren't in the host's Contents panel; the embedded page's categories don't carry over; spoilers stay spoilers and the host's Reveal all covers them.
- Embeds work in page text and category page text, not in infobox fields. No parameters.

**Small additions**
- (Juku) **Quote box**, AWOIAF style: centred, large quotation marks, "— By, Source" right-aligned underneath. A **Quote** toolbar button opens a dialog: Quote (bold, italic, links, spoilers), By (optional; text or a page link), Source (optional). Clicking a quote box in the source reopens the dialog. Stored as a block in the page text (format Claude's choice).
- **Separator line:** toolbar button inserting a thin horizontal line, with the spacing handled so it never turns the line above into a heading.
- **Divider** infobox field type: a thin line with an optional label, no value. Available in templates and as a page's own field; Apply to existing pages treats it like any field.
- (Juku) **Contents panel** in the read view becomes narrower than today's 230 px; exact width settled at the checkpoint.
- **App always light** on Mac and Windows, incl. the window title bar; the system's dark mode is ignored.

- Not in M7: spoiler levels per book (see Open items), embeds with parameters, embeds in infobox fields.
- Checkpoint for Juku partway: always light, Contents panel, separator, Divider, quote box, spoilers everywhere incl. infobox toggle, images and Reveal all. Then: embeds.
- **Progress (2026-10-20):** checkpoint approved by Juku ("all fine"; Hide spoilers now also hides spoilers revealed one by one). Embeds built: Embed button and dialog (whole page / one section / infobox only), popup on click (Open, Change…, Remove), seamless look with an "open page" link on hover, red box for missing pages, warning boxes for self-embeds, loops and more than 5 levels, "Embedded in" in What links here, renames rewrite embeds. Speed: 50 embeds render in ~70 ms; renaming a page embedded on 1,000 pages ~3.6 s; a 5,000-page project reopens in ~10–20 ms. Waiting for Juku's final review.
- Done when: new features have Playwright UI tests and pass with the unit and Rust tests; screenshots check the new and changed screens; a page with 50 embeds opens without noticeable delay, renaming a page embedded on 1,000 pages finishes within a few seconds, a 5,000-page project still reopens in under 1 s after the index change; this milestone's diff reviewed once for bugs and duplicated code; the Mac app built, installed and checked once on screen; the Windows workflow produces an installer; Juku has reviewed the installed app and approved it.

### How every milestone is written
- **Done when** always includes: new features have automated UI tests (Playwright smoke tests in `tests/ui/`) and pass with the Rust and unit tests; screenshots check how new or changed screens look; speed targets only if the milestone touches loading, the index, search or big lists; this milestone's diff reviewed once for bugs and duplicated code; the Mac app built, installed and checked once on screen; the Windows workflow produces an installer; Juku has reviewed the installed app and approved it.
- A milestone may name a **checkpoint** partway for Juku. A session that ends partway adds a short **Progress** note (done / left / open questions) to the milestone here.

## Rules from finished milestones (M1–M6)
Everything later work must keep working. Reasons and full detail: `docs/history.md` (search it).

**Stack and code**
- Tauri 2 + React + TypeScript. Rust does all file access (commands in `src-tauri/src/lib.rs`, typed wrappers in `src/api.ts`). Editor: CodeMirror 6. Pasted HTML → Markdown via Turndown. Web links open through the opener plugin; plain paste reads the clipboard plugin.
- Links are parsed in both Rust (index, rewrites) and TypeScript (rendering, editor); both run `shared-tests/links.json`, so change both together.
- Theme contract: every colour and font, the type scale and main layout widths are CSS variables in `src/theme.css`, listed in `docs/theme-variables.md`. No hard-coded colours. Light/dark followed the system through M6; from M7 the app is always light (2026-10-19).
- Per-machine settings (library path) live in `settings.json` in the OS app-config folder. Per-computer UI state (open groups, editor divider, folded contents sections, "Include pages of subcategories") lives in browser local storage. Neither is ever synced.
- App id `io.github.zzjuku.ownwiki`, display name "Own WIKI" (placeholder). Windows installer: NSIS, built by `.github/workflows/windows.yml`. Builds unsigned.

**Folders and files**
- Project folder: `project.json`, `pages/`, `assets/`, `categories/`, `.cache/` (rebuildable, never synced or exported). Project folder named after the project; renaming renames it.
- Every write: temp file + rename. Every delete (project, page, group, category file) goes to the system Trash / Recycle Bin after a confirmation that states what's affected.
- `project.json` keys: `name`, `formatVersion` (1), `templates`, `mainPage` (title), `infoboxImage` (project frame `{width, height}`, default 250 × 300), `hideCategoryBox`. Unknown keys are kept, everywhere (project.json, front matter, fields).
- Pages: `pages/…/Title.md`; groups are subfolders (nested). Page and group ids are `/`-separated paths inside `pages/`. A group's name is its folder name (characters invalid in file names become `-`). Two titles mapping to one file name in a folder: the second gets " (2)" etc. Renaming a page renames its file. Files without front matter stay without it when saved.
- Page front matter keys: `title` (the real title), `aliases` (list), `categories` (list), `sort` ("Sort as"), `infobox` (`template`, `color`, `ownColor`, `fields`, `hidden`).
- Category files: `categories/Name.md` (named like pages, " (2)" on clashes) with own text and `parents`; created when a category gets text or parents, or is created from a red link / New category. A category exists while a page, template default, subcategory or its own file uses it.
- Link index: `.cache/link-index.json` (cache version 4; bump when its format changes), per-file modification time and size for incremental rebuilds. Holds titles, aliases, headings, outgoing links (text and infobox), opening paragraphs, hover-card image, categories, parents and sort keys; also serves the page tree. Updated on every save, rename, move and delete; written at most every 10 s for small changes. Files changed outside the app are picked up at next project open (live reload: M8).
- Image thumbnails: `.cache/thumbs/`, widths 320/640/1280/2560 px; at most 2 big images decoded at once; SVG and GIF shown as they are. Images reach the page only through the `wikiasset:` URL scheme, which reads only a project's `assets/`; SVG responses carry a policy that blocks scripts.

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
- Renaming a page rewrites `[[Old]]` → `[[New]]` and `[[Old#S]]` → `[[New#S]]` in pages, category texts and infobox fields; links with own text keep it; links through an alias are untouched; `mainPage` follows; optional "keep old title as alias". Renaming a heading doesn't rewrite links. Deleting a page turns its links red.
- New projects get an empty "Main Page" set as main page.

**Images**
- In text: `[[File:Name.png|right|medium|Caption]]`; positions `right` (default), `left`, `center`, `full`; sizes `small` 160, `medium` (default) 250, `large` 400 px. In captions `|` is stored as `&#124;` and an unfinished `[[` as `[`. Galleries: `<gallery>` … one `File|Caption` line per image … `</gallery>`.
- Import (button, drag and drop, paste, Image fields) copies into `assets/`, keeps the original name (" (2)" on clashes), the same file twice is stored once, pasted images are named "Pasted image.png". Removing an image never deletes its file.
- Formats: PNG, JPG, GIF, WebP, SVG in text and galleries; Image fields: no SVG.

**Templates and infobox fields**
- Field: `key` (template field it came from; absent = the page's own), `label`, `type`, `hint`, `options` (`choices`, `ranges`, reserved `twoWay`/`from`), `value`. Types: `text`, `longtext`, `number`, `yesno`, `choice`, `list`, `links` ("Page link": one page or several, stored as a list; the older one-page `link` type still reads and edits but isn't offered), `date`, `image`, `heading`; `linkedfrom` reserved (M8).
- Date value: `{year, era, month, day, qualifier: c|before|after}`, or with ranges `{start: {…}, end: {…} | "present"}`. Shown day.month.year until M13 maps eras and months to calendars.
- Image value: `{file, caption, crop: {x, y, zoom, aspect}}` (x/y in percent, zoom 1 = fills the frame, aspect = width/height; no zoom = simply fills). Every infobox image sits in one frame size: the template's `imageFrame`, else the project's `infoboxImage`; never copied into pages.
- Text fields allow bold, italic, `[[links]]`; `||` is stored as typed (spoilers M7).
- Template field keys are random ("f-k2j4") and never reused; template ids are readable + random ("template-a-54px").
- A template is a starting point: a new page copies its fields, colour, starter text and default categories. Editing, renaming or deleting a template never changes pages by itself.
- **Apply to existing pages…** (per page, untickable; dry run shows the changes): adds new fields; updates labels, types, hints, options and order; renamed fields keep their values; fields removed from the template become **hidden values** (never deleted); fields the page added itself are untouched, except one named like a new template field, which becomes it with its value; template fields deleted on a page come back; colour only on pages without their own (`ownColor`); starter text never; default categories added, never removed.
- Change template: same-named fields keep values, the rest become hidden values. Changing a field's type keeps values that don't fit, with a warning. Values are never lost silently.

**Behaviour to keep**
- Autosave a moment after typing stops and before switching pages, leaving the project or closing the window; no Save button.
- Pages open in the read view; new pages open in the editor. Shortcuts in use (Ctrl on Windows): Cmd+O quick-open, Cmd+E read/edit, Cmd+B/I bold/italic, Cmd+Shift+X strikethrough, Cmd+Alt+1/2/3 headings, Cmd+Shift+8/7 lists, Cmd+K link, Cmd+F find, Cmd+Z / Cmd+Shift+Z undo/redo, Cmd+Shift+V plain paste, Cmd+[ / Cmd+] back/forward (Alt+Left/Right on Windows), Cmd+click follows a link in the source.
- One Enter = new line in the preview; an empty line = new paragraph.

**Promised to later milestones (from M1–M6 scopes)**
- M7: spoilers in infobox fields, captions, hover cards and the link index's previews; embeds.
- M8: `linkedfrom` fields and the reserved `twoWay`/`from` options.
- M9: search in infobox fields and aliases; live reload of files changed outside the app.
- M10: unlinked mentions, broken section links (incl. renamed headings), unused images, hidden template values.
- M12: editing theme colours (variables already in place, incl. infobox colours).
- M13: map location fields; SVG maps.
- M14: calculated fields (e.g. age); eras and month numbers mapped to real calendars without a data migration.
- Later / undecided: Obsidian-style inline live preview, page history/undo of edits, image file pages ("File:" pages with description), group overview pages (Open items). Not planned: categories driven by field values, automatic linking of plain words.

## Open items (from Juku)
- **Themes:** custom CSS on top of the theme settings, yes or no? Needed before M12.
- **Group overview pages** (a page per group listing its contents, maybe with own text): wanted later; overlaps with category pages (M6, which can have own text), decide where it fits after M6.
- Visual references (beyond Wikipedia/AWOIAF/Chronicler: what exactly he likes about them)
- App name
- **Spoiler levels per book** ("reveal up to Book 2"): proposed by Claude 2026-10-20, undecided; the `||` format can be extended later without changing existing spoilers.


## Decision log
- Entries up to 2026-10-18 (M1–M6): see `docs/history.md`.
- 2026-10-18 (maintenance, not a milestone): SPEC.md trimmed; finished scopes and the old decision log moved to `docs/history.md` unchanged, SPEC.md keeps a "Rules from finished milestones" summary. `src/styles.css` split into `src/styles/*.css` by area, imported in the original order from `src/main.tsx` (pure move: the built CSS is byte-identical, screenshots unchanged).
- 2026-10-18 technical: automated UI tests with **Playwright** (Chromium) against the Vite dev server (port 1430) on `tests/ui/harness.html`, which installs an in-memory backend (`tests/ui/mock/`, via Tauri's `mockIPC`) before the app; images answer with a placeholder picture. tauri-driver isn't used (no macOS support). The real file and index logic stays covered by the Rust tests. `npm test` = unit + Rust (also in Windows CI); `npm run test:ui` = type-check + Playwright (Mac only for now). Smoke tests cover opening a project, creating/editing a page, links, infobox from a template, image in text and categories.
- 2026-10-19 (planning): Juku's list of small additions placed. M7 gains an AWOIAF-style quote box (inserted by hand), a separator line in text + Divider infobox field (optional label), a thinner Contents box, and the app is always light on Mac and Windows (replaces "follows the system"). Automatic relation fields pulled forward from Family trees into a new **M8 Relations** (calculated from the link index, never written into other files; parents → children, two-way for spouse), together with automatic page lists such as "Chapters that take place at …". Themes (now M12) also set fonts (body, headings), text size, line spacing and page width; fonts are copied into the project. Later milestones renumbered +1 (old M8 → M9 … M16 → M17); `docs/history.md` keeps the old numbers. Edit/read hotkey already exists (Cmd+E).
- 2026-10-19 (planning): "Reveal all spoilers" works both per page and globally (everywhere).
- 2026-10-19 (planning, Claude decided at Juku's request): per-page reveal lasts until the page is left; the global switch stays on until switched off, remembered per computer.
- 2026-10-20 technical (M7): spoiler rule `||text||` = first character not `|` or a space, shortest text up to `||` not ending in `\`, one line only (TS `SPOILER_AT_START`, Rust `spoiler_at`); in table rows `\|\|`. Spoiler images `[[File:…|spoiler|…]]`, `<gallery spoiler>`; infobox fields `spoiler: true`; `|` in image captions now reads back from `&#124;`. Quote box block: `<quote>` text lines, optional `<by>…</by>` and `<source>…</source>` lines, `</quote>`. Embeds: a line holding only `{{Page}}`, `{{Page#Section}}` or `{{Page|infobox}}`; the link index keeps embeds apart from links (cache version 6); renames rewrite embeds like links; embed content comes from the new `embed_sources` command (Rust follows embeds up to 5 levels), "Embedded in" from `embedded_in`. Embedded headings lose their ids and footnote ids get a prefix, so they don't clash with the host's. Divider field type `divider` (no value; label optional).
- 2026-10-20 (planning): M7 defined. Spoilers: infobox fields get a per-field Spoiler toggle for all types; images and galleries in text can be spoilers; the editor preview shows spoilers revealed but marked; a revealed spoiler stays revealed until the page is left; titles, categories and the existence of links are never hidden; spoiler-hidden values stay hidden where they reappear (M8 reverse fields etc.). Embeds: whole page, one section or infobox only; seamless look; links inside embeds don't count for the host, the source lists "Embedded in"; up to 5 levels; syntax `{{Page}}` (Claude). Quote box AWOIAF style; Contents panel narrower. Spoiler levels per book added to Open items.
