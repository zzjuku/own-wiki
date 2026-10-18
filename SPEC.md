# Own WIKI — Spec (v0.10, 2026-10-18)

This file is the single source of truth for what the program is and why. Update the decision log whenever a decision changes.

Status: M1–M5 done; M6 defined, next to build; roadmap M7–M16 drafted.

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
- A "reveal all spoilers" control exists (scope: see Open items).

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
  - Relations are entered once: reverse fields (e.g. children from other pages' parent fields) fill themselves (postponed from M5 on 2026-10-18; see Open items).
- **Categories:** easy to add per page, AWOIAF-style list at the bottom of the page, automatic category pages with optional own text, subcategories, and default categories from templates.
- **Embeds:** insert the content of one page into another (navboxes, item cards, stat blocks). Plain embeds first; embeds with parameters only if needed later. Embed loops are detected and blocked.
- **Health reports:** auto-generated reports (broken links, orphan pages, unlinked mentions, missing images, duplicate titles, sync conflicts, hidden template values…) with tools to fix them.
- **Graph view:** Obsidian-style interactive network of linked pages. Must handle thousands of pages: local graph (neighbours of the current page) plus a filterable global graph.
- **Themes:** user-created, selectable, editable themes. A theme is either app-wide or belongs to one project (stored in and synced with that project); a project can use its own theme instead of the app-wide one. UI styling uses CSS variables from the start so themes are cheap to add. Colours/fonts only vs. custom CSS: undecided, settle before M11. Themes set one look for all pages, infoboxes included; a page can still give its own infobox a different **colour** (not style).
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
Milestones are defined here before they are built. Later milestones get added after Juku's feature list.

### M1 — Foundation (done 2026-10-17)
- Tauri 2 app that launches on the Mac.
- Settings: choose the library folder (stored per machine).
- Projects: create, open, rename, delete. Each project is created with the folder layout from section 3.
- Pages: create, edit, view, rename, delete plain Markdown pages inside a project; a page list per project. Plain text editing is enough; no templates, links, images or spoilers yet.
- Safe writes (temp file + rename) for every file the app saves.
- GitHub Actions workflow that builds a Windows installer, so both platforms are proven from day one.
- Done when: tests pass, the Mac app is built and launched, every item above is clicked through on screen, the Windows workflow produces an installer, and Juku has reviewed the installed app and approved it.
- Behaviour (Juku's choices, 2026-10-17):
  - Deleting a project or page moves it to the system Trash / Recycle Bin, after a confirmation.
  - Page edits autosave a moment after typing stops, and before switching pages, leaving the project or closing the window. No Save button.
  - A page opens as formatted text. **Edit** switches to a plain-text Markdown editor; **View** switches back. A nicer editor comes later.
- How it works on disk:
  - Page files are named after the page title (`Page A.md`); the real title is also stored as `title:` in the front matter, so titles may contain characters file names can't. Renaming a page renames its file. Other front-matter fields are kept untouched.
  - Project folders are named after the project; renaming a project renames its folder. `project.json` holds `name`, `formatVersion` and `templates`; unknown keys are kept.
  - Names that differ only in upper/lower case count as the same name (keeps projects valid across file systems).

### Roadmap (draft, 2026-10-17)
Order follows dependencies: typed fields before maps/timelines/trees; links before graph and health reports. Each milestone gets its detailed scope here before it is built. Juku plans to start entering real content **after M7**.

**v1**
- **M2 Structure:** groups (nested folders), sidebar tree, move pages between groups, quick-open by title, project-wide unique titles, path-length warning. *(Detailed scope below.)*
- **M3 Editor:** split-screen live preview, toolbar + shortcuts, table of contents, tables, footnotes, paste with formatting, word count, Wikipedia-like page look, theme-ready styling (CSS variables). *(Detailed scope below.)*
- **M4 Links:** `[[ ]]` with autocomplete and display text, red links, backlinks, link rewrite on rename, hover previews, aliases/redirects, main page per project, back/forward. Introduces the link index in `.cache/`. *(Detailed scope below.)*
- **M5 Templates & infoboxes:** template editor, typed fields, AWOIAF-style infobox, image fields (reverse fields postponed, see Open items) (basic image import moved here from M6). Date fields are stored in a calendar-ready format (era, year, optional month/day, approximate flag, ranges) so M13 doesn't need a migration. *(Detailed scope below.)*
- **M6 Images & categories:** images in page text, captions, galleries, drag and drop, SVG, uniform infobox image frames, categories with automatic category pages, subcategories, default categories from templates, sort keys (image import into `assets/` itself arrived in M5). *(Detailed scope below.)*
- **M7 Spoilers & embeds.**

**M2 — Structure (done 2026-10-17)**
- Groups:
  - Create a group at the top level of a project or inside another group (any depth). Empty groups are allowed.
  - Rename a group (renames its folder).
  - Move a group into another group or to the top level. Moving a group into itself or one of its own subgroups is blocked.
  - Delete a group: after a confirmation that states how many pages and subgroups are inside, the whole group with its contents goes to the system Trash / Recycle Bin.
  - Group names are unique among siblings (case-insensitive). A move that would collide with a same-named group in the target is refused with a clear message (no merging).
- Pages:
  - Create a page at the top level or inside a group.
  - Move pages between groups and to the top level.
  - Existing M1 pages stay at the top level.
  - The page header shows the page's group path (breadcrumb).
- Moving (pages and groups): both **drag and drop** in the sidebar and a **"Move to…"** menu with a group picker.
- Sidebar tree: replaces M1's flat page list. Groups expand/collapse; expanded state is remembered per machine (not synced). Order is **alphabetical**, groups listed before pages. Must stay fast with thousands of pages.
- Selecting where new items go (Juku, 2026-10-17): clicking a group selects it (and still opens/closes it); **New page** and **New group** then create inside the selected group. With no group clicked, they go into the open page's group. Clicking the project name selects the top level. A line under the buttons shows where new items go. A newly created group becomes the selected group.
- Quick-open: **Cmd+O** (Ctrl+O on Windows) opens a search box that finds pages by title as you type and opens the chosen page.
- Unique titles: creating, renaming or moving a page checks the title against every page in the project (case-insensitive). If taken, the message names the existing page and its group.
- Path-length warning: when a create, rename or move would make a file path longer than ~240 characters, the app warns (applies on Mac too, because the files sync to Windows).
- Not in M2: group overview pages (later, see Open items), file watching/sync (M8).
- Done when: tests pass, the Mac app is built, installed and launched, every item above is clicked through on screen (including a test project with several hundred placeholder pages in nested groups to check speed), the Windows workflow produces an installer, and Juku has reviewed the installed app and approved it.

**M3 — Editor (done 2026-10-17)**
- Read and edit (Juku, 2026-10-17): a page opens in a full-width **read view**. **Edit** (or Cmd+E / Ctrl+E) opens the **split editor**: Markdown source on the left, live preview on the right; Cmd+E or **View** goes back. New pages still open in the editor; opening an existing page opens the read view (as in M2).
- Split editor:
  - The preview updates as you type and scrolls along with the editor.
  - Draggable divider between source and preview; its position is remembered per machine. A button hides/shows the preview (source full width).
  - The source side uses light highlighting (headings larger, bold shown bold, etc.) so it reads less like code.
  - Find & replace within the page: Cmd+F / Ctrl+F in the editor.
  - Autosave unchanged from M1.
- Toolbar: Heading, Subheading, Sub-subheading, Bold, Italic, Strikethrough, Bulleted list, Numbered list, Quote, Divider line, Insert table, Footnote, Undo, Redo. Buttons toggle (Bold on bold text removes it) and show when the cursor is inside that formatting. Tooltips show each shortcut.
  - Toolbar headings write `##`, `###`, `####` (the page title is the top heading, as on Wikipedia). A `#` typed by hand still renders as a heading.
  - No link button in M3; page links come in M4. Web addresses in the text open in the default browser when clicked.
- Shortcuts (Ctrl instead of Cmd on Windows): Cmd+B bold, Cmd+I italic, Cmd+Shift+X strikethrough, Cmd+Alt+1/2/3 headings, Cmd+Shift+8 bulleted list, Cmd+Shift+7 numbered list, Cmd+Z undo, Cmd+Shift+Z redo (Ctrl+Y also on Windows), Cmd+F find & replace, Cmd+E read/edit. Cmd+O stays quick-open.
- Typing behaviour:
  - One Enter = new line in the preview; an empty line = new paragraph (Obsidian's default). Files stay valid Markdown.
  - Lists continue on Enter; Enter on an empty item ends the list; Tab / Shift+Tab indent and outdent list items.
  - Undo/redo covers every toolbar action and shortcut.
- Tables: **Insert table** asks for rows and columns (default 3 × 3) and inserts a table with a header row. Tables display in a Wikipedia-style table look. Tables are edited in the source; no visual table editor.
- Footnotes: the **Footnote** button inserts a numbered marker at the cursor and an empty note at the end of the page, and puts the cursor in the note. Notes are listed under a "Notes" heading at the bottom of the page, numbered in order of appearance; clicking a number jumps to its note and back.
- Paste with formatting: text pasted from Word, Google Docs or web pages keeps bold, italics, strikethrough, headings, lists, quotes, tables and web links (converted to Markdown). Colours, fonts and images are dropped (images come in M6). Cmd+Shift+V / Ctrl+Shift+V pastes plain text.
- Word count: words and characters of the page text (without Markdown symbols), shown in the editor's status line.
- Table of contents (Juku, 2026-10-17, revised the same day after the first M3 review: AWOIAF-style left panel):
  - Built from the page's headings; shown when a page has 3 or more. Numbered (1, 1.1, …), entries jump to their section. Includes the Notes section.
  - **Read view:** a contents panel sits permanently at the left of the page text and stays in place while the page scrolls. The section being read is highlighted (bold, with a bar beside it). Sections with subsections fold open/closed with a small arrow; all open by default; folded sections are remembered per page on each computer (not synced). No contents box inside the text.
  - **Narrow windows:** when there's no room for the panel beside the text, the read view shows no contents.
  - **Editor preview:** shows a collapsible contents box after the opening text, before the first heading (no room for a panel in the split view).
  - Headings get stable anchor ids (lower-case, spaces → `-`, duplicates numbered `-2`, `-3`…) so M4 can link to `[[Page#Section]]` without changing them.
- Page look (Juku, 2026-10-17): **Wikipedia-like**: serif section headings (Georgia, present on Mac and Windows) with a line under main headings, sans-serif body text, limited text width (widened from ~880 px to ~1200 px on 2026-10-18, see M5).
- Theme-ready styling: every colour, font, size and spacing used by the app moves into CSS variables (no hard-coded colours left). The variable list is documented as the contract for M11 themes and already includes the infobox colours and layout, and the page layout leaves room for a right-floating infobox (infoboxes themselves: M5). Light/dark keeps following the system.
- Not in M3: page links (M4), infoboxes (M5, Juku confirmed 2026-10-17), images (M6), spoilers (M7), Obsidian-style inline live preview (later), page history.
- Checkpoint for Juku partway: split editor + toolbar + shortcuts, before tables, footnotes, paste, table of contents and styling.
- Done when: tests pass, the Mac app is built, installed and launched, every item above is clicked through on screen, a ~20,000-word placeholder page types and previews without noticeable lag, undo works after every toolbar action, the Windows workflow produces an installer, and Juku has reviewed the installed app and approved it. Windows shortcuts can't be clicked through by Claude; Juku checks them on the PC if he wants them verified.

**M4 — Links (done 2026-10-18)**
- Link syntax: `[[Page]]`, `[[Page|shown text]]`, `[[Page#Section]]`, `[[Page#Section|text]]`, and `[[#Section]]` for a section of the same page. Section links use M3's heading anchors.
  - Matching ignores upper/lower case (like titles).
  - Links work in text, lists, tables, quotes and footnotes. Text inside code (backticks) is never a link and never rewritten.
  - A link to the page it sits on shows as bold text, not a link (as on Wikipedia).
  - Pipe trick: `[[Page A (Example)|]]` shows "Page A" (the bracketed part at the end is dropped). The file keeps what was typed.
  - Word endings: letters directly after a link join it: `[[Page]]s` shows "Pages" as one link.
  - A section link to a heading that doesn't exist (any more) opens the top of the page. Renaming a heading does not update links to it (reported in M9).
- Following links: click in the read view or editor preview. Cmd+click (Ctrl+click on Windows) on a `[[link]]` in the source editor follows it. In the source, links are coloured; links to missing pages are red there too.
- Inserting links:
  - Typing `[[` opens a suggestion list of titles and aliases as you type, each with its group path. Enter inserts the link and closes it with `]]`. Picking an alias inserts `[[Alias]]`.
  - After `[[Page#`, the list shows that page's sections.
  - **Link** toolbar button and Cmd+K / Ctrl+K: with text selected, pick a page and the selection becomes the shown text; without a selection, it inserts a link.
  - **Edit link popup** (Juku, 2026-10-18, during the M4 review): clicking into a link in the source editor shows a small popup with **Links to** (with page suggestions) and **Text shown on the page** (empty = shows the page name). Enter or Apply rewrites the link; also **Unlink** (keeps the text) and **Open page**. Moving the cursor out, typing or scrolling closes it.
- Red links: a link to a page that doesn't exist is red, with a tooltip saying so. Clicking it opens a small dialog: title filled in from the link, group picker set to the linking page's group. One Enter creates the page and opens it in the editor.
- What links here: a button in the page header with the number of linking pages. It opens a list of every page that links here (alphabetical, with group path and the line containing the link), including links through an alias (the alias is named). Clicking an entry opens that page.
- Renaming a page (Juku, 2026-10-17: option a):
  - Every link to it in the project is rewritten: `[[Old]]` → `[[New]]` (shown text changes too), `[[Old#S]]` → `[[New#S]]`. Links with their own shown text keep it. Links through an alias are untouched. The main page setting follows the rename.
  - The rename dialog says how many links in how many pages will be updated and has a checkbox **Keep old title as alias** (off by default).
  - Every file is written safely (temp file + rename). If a file can't be written, the app names it.
- Deleting a page: the confirmation says how many pages link to it (and that it's the main page, if it is). Its links turn red afterwards.
- Hover previews: hovering a link for about 0.4 s shows a card with title, group path and the opening paragraph (for `#Section` links: the start of that section). Red links show "Page doesn't exist". Works in the read view and editor preview. Links inside a card don't open further cards. The card leaves room for an image (M6); spoilers will be hidden in it (M7).
- Aliases (redirects):
  - Stored as an `aliases:` list in the page's front matter (no separate redirect pages).
  - Edited on an **Aliases** line under the title in edit mode (add, remove).
  - Titles and aliases share one name space: a title or alias that matches any existing title or alias in the project (ignoring case) is refused; the message names the page that has it.
  - A link to an alias opens the page with a small "(Redirected from Alias)" note under the title.
  - Removing an alias that links still use warns how many links will turn red.
  - Quick-open (Cmd+O) also finds pages by alias.
- Main page per project:
  - New projects are created with an empty page "Main Page", set as the main page. Any page can be made the main page via **Set as main page**; the setting is stored in `project.json`.
  - Opening a project shows its main page. A home button at the top of the sidebar opens it.
  - Projects without a main page (made before M4, or after it was deleted) open as before; the home button then explains how to set one.
- Back/forward: buttons plus Cmd+[ / Cmd+] (Alt+Left / Alt+Right on Windows) move through the pages visited in this project since it was opened. Not remembered after closing.
- Title rule: `[`, `]`, `|` and `#` are not allowed in page titles and aliases (they break link syntax). Existing pages that use them show a notice in the header asking to rename.
- Link index: titles, aliases, headings, outgoing links and opening paragraphs of every page, kept in `.cache/` (never synced). Built when a project opens; later opens only re-read changed files. Updated on every save, rename, move and delete. Built so M5 link fields and the M10 graph can plug in. Files changed outside the app are picked up at the next project open (live reload: M8).
- Not in M4: unlinked mentions and broken-section-link reports (M9), links in infobox fields (M5), embeds (M7), graph (M10), automatic linking of plain words (never).
- Checkpoint for Juku partway: link syntax, autocomplete, Link button, red links incl. creating pages from them, following links, back/forward. Then: rename rewrite, backlinks, previews, aliases, main page, title rule.
- Done when: tests pass, the Mac app is built, installed and launched, every item above is clicked through on screen, a test project with 5,000 placeholder pages and ~20 links each reopens in under 1 s, autocomplete has no noticeable delay, renaming a page with 500 backlinks finishes within a few seconds and leaves no stale links, the Windows workflow produces an installer, and Juku has reviewed the installed app and approved it.

**M5 — Templates & infoboxes (done 2026-10-18)**
- Model (Juku, 2026-10-18): a template is a **starting point**. A page created from it gets its own copy of the template's fields, colour and starter text. Editing, renaming or deleting a template never changes existing pages by itself. Each page can add, remove, rename and reorder its own fields.
- Templates screen (per project):
  - Create, rename, copy and delete templates. Deleting a template leaves every page as it is.
  - Per template: a list of fields and section headings, reordered by dragging; each field has a label, a type, type options and an optional **hint** (a help line shown under the field in the Infobox tab).
  - Infobox colour per template, starter text (pre-fills the text of new pages, e.g. headings), and a live preview of the box.
  - **Pages using this template:** the pages created from it, each one clickable.
  - **Apply to existing pages…:** shows which pages would change (checkboxes, all on by default). It adds new fields, updates labels, types, hints, options and order, renames renamed fields (values move along), and hides fields removed from the template. Fields a page added itself are never touched, except one with the same name as a new template field: it becomes that field, keeping its value, so no field appears twice. A template field that was deleted on a page comes back (the page can be unticked). Pages that kept the template's colour get the new colour; pages with their own colour keep theirs. Starter text is never applied (page text is the page's own).
  - **Copy templates from another project:** pick a project, then the templates; a name already taken asks for a new name or skips.
- Field types:
  - **Text** (one line) and **Long text**: bold, italic and `[[links]]` work, with the same shortcuts (Cmd+B, Cmd+I, Cmd+K) and `[[` autocomplete as the editor. (Juku, 2026-10-18, checkpoint review:) each text field also shows **Bold**, **Italic** and **Link** buttons while in use, and clicking a link in a field opens the M4 Edit link popup.
  - **Number**, **Yes/No**, **Choice** (a dropdown with own options), **List** (several text entries).
  - **Page link**: one page or several (Juku, 2026-10-18: one type instead of separate Page link / Page links).
  - **Linked from** and **Two-way** fields: postponed (Juku, 2026-10-18), see Open items.
  - **Date:** year (whole number, negative allowed), era (short free text until M13), optional month and day (numbers until M13), qualifier exact / c. / before / after. Field option **allow ranges**: start and end date, the end can be open ("present"). Shown e.g. "c. 250 Era", "12.3.250 Era" (day.month.year, Juku 2026-10-18) or "283 – 298 Era". M13 maps eras and month numbers to the real calendar without a migration.
  - **Image:** pick an image file (PNG, JPG, GIF, WebP); it's copied into the project's `assets/` folder; with a caption. Removing it from the field doesn't delete the file (unused images: M9).
  - **Section heading:** a heading row inside the box (AWOIAF style).
- Pages:
  - The New page dialog and the red-link dialog offer a template picker (default: no template).
  - In edit mode the left side gets two tabs, **Text** and **Infobox**; the preview on the right shows the box live.
  - Infobox tab: fill in values; add, remove, rename and reorder this page's fields; change this page's infobox colour; **Add infobox** (from a template or empty), **Change template** (same-named fields keep their values, the rest become hidden values), **Remove infobox** (with confirmation).
  - **Hidden values (N)** section in the Infobox tab: restore (puts the field back) or discard.
  - Changing a field's type: values that don't fit stay in the file and get a warning in the form.
  - Deleting a field with a value on a single page asks first, then deletes the value.
- Infobox look: one box per page, AWOIAF-style, at the right edge of the page column in the read view and the preview; the text runs left of it and, below the box, across the full column width (Juku, 2026-10-18: page column widened to ~1200 px for this). Title bar = page title; image(s) with caption; section headings; label | value rows. Colour: the page's own colour, else the theme's infobox colour; colour changes title bar and section headings only (text colour picked automatically for contrast); everything else follows the theme. Empty fields are not shown; a section with no values isn't shown. In narrow windows the box sits above the text.
- Links in fields: link values work like links in the text: red links, hover previews, rename rewrite (links through an alias untouched), deleted pages turn them red. **What links here** includes them, marked "via infobox: *field*". Linked-from and two-way entries shown on a page are not counted as links from it.
- Hover cards show the page's first infobox image.
- Not in M5: spoilers in fields (M7; `||` is already stored as typed), images in the page text and galleries (M6), templates adding categories (to discuss in M6), search in fields (M8), unused images / hidden values reports (M9), calculated fields such as age (M13), map location fields (M12), editing theme colours (M11).
- Checkpoint for Juku partway: templates screen with text, long text, number, yes/no, choice, list and section headings; creating pages from templates; Infobox tab; the box with colour. Then: link fields, dates, images, Apply to existing pages, hidden values, page-own field editing, copying templates, Pages using this template.
- Done when: tests pass, the Mac app is built, installed and launched, every item above is clicked through on screen, a test project with 5,000 placeholder pages with infoboxes (several link fields each) reopens in under 1 s, Apply to 1,000 pages finishes within a few seconds, the Windows workflow produces an installer, and Juku has reviewed the installed app and approved it.

**M6 — Images & categories (defined 2026-10-18)**
- Images in page text:
  - Inserted with an **Image** toolbar button, by dragging files from Finder/Explorer into the editor (at the drop point), or by pasting an image (e.g. a screenshot). Every route copies the file into `assets/`; the same file imported twice is stored once (as in M5). Imported files keep their original name; a clash gets " (2)".
  - Formats: PNG, JPG, GIF, WebP and **SVG** (Juku, 2026-10-18). SVGs are shown as pictures only; code inside them never runs.
  - Each image has a caption (bold, italic and `[[links]]` work), a position (right like a Wikipedia thumbnail, left, centre, full width) and a size (small, medium, large). Images in the text keep their shape (no cropping).
  - Clicking an image in the source opens an **Edit image popup** (like the Edit link popup): caption, position, size, Replace, Remove. Juku never types image syntax.
  - Clicking an image in the read view or preview opens a **full-size viewer** (zoom, Esc closes; arrows step through the page's images).
  - Removing an image from a page never deletes its file (unused images: M9).
- Galleries: a **Gallery** toolbar button inserts a grid of images with captions (equal cells, images fitted inside). Clicking a gallery in the source opens a gallery dialog: add, remove, reorder by dragging, caption. The viewer steps through the gallery.
- Infobox images (Juku, 2026-10-18):
  - Every image in an infobox sits in the **same fixed frame** (width × height), filled and **cropped** to fit. The image file itself is never changed.
  - (Juku, 2026-10-18, checkpoint review:) per image, an **Adjust picture** window (from the Image field) shows the picture in its frame, large: a size slider from "whole picture visible" (leftover frame space shows the infobox background) to 4× closer, and dragging moves it in every direction; buttons Whole picture, Fill the frame, Centre. Stored with the field value.
  - The frame size is a **project setting** on the Templates screen; a template can use **its own size** instead (e.g. wider for locations than for characters). A page uses its template's size, else the project's.
  - The infobox grows wider when the frame is wider than the box, so images always fill it.
  - Image fields stay PNG, JPG, GIF and WebP (no SVG). Image files can also be dropped onto an Image field.
- Hover cards show the first infobox image, else the first image in the page text.
- Categories:
  - Stored as a `categories:` list in the page's front matter.
  - In edit mode a **Categories** line under Aliases: add (suggestions from existing categories; a new name creates the category) and remove.
  - The read view shows an AWOIAF-style box at the bottom of the page: "Categories: A · B · C". Categories can be added (+) and removed (×) there directly, without edit mode.
  - **Category pages** (automatic): title "Category: Name", optional **own text** (written with the normal editor; stored in `categories/Name.md`, created only when text or parents are added), then **Subcategories**, then **Pages** listed alphabetically under letter headings with a count. A switch **Include pages of subcategories** lists every page below it once.
  - **Subcategories:** a category can be put into parent categories (from its category page, same Categories line/box). Its pages don't appear in the parent's list unless the switch is on. A parent that would create a loop (a category inside itself) is refused.
  - **Sort as** (optional, per page): a line in edit mode next to Aliases and Categories, stored as `sort:` in front matter. Category pages sort and file the page under it; the sidebar keeps sorting by title.
  - `[[Category:Name]]` in the text links to a category page (hover card: start of its text and member count; red if the category doesn't exist, clicking creates it). What links here works on category pages.
  - Category names are their own name space (a page and a category may share a name), unique among categories ignoring case; `[`, `]`, `|`, `#` aren't allowed. Page titles and aliases can't start with "Category:" or "File:"; existing ones show the M4 rename notice.
  - A **Categories** entry in the sidebar opens a list of all categories with member counts and a filter box. Quick-open (Cmd+O) also finds categories.
  - **Rename a category:** updates every page, subcategory, `[[Category:…]]` link and template default; the dialog shows the counts first.
  - **Delete a category:** after a confirmation with counts, it's removed from every page and template, its subcategories lose it as parent, its file goes to the Trash; links to it turn red.
  - **Templates** (Juku, 2026-10-18: option a): a template has **default categories**; new pages get their own copy. **Apply to existing pages…** adds missing default categories (shown per page, untickable) and never removes any. Categories that follow field values: not planned.
- Not in M6: spoilers in captions (M7), unused-image report (M9), image file pages ("File:" pages with description), categories driven by field values, group overview pages (still open, see Open items).
- Checkpoint for Juku partway: images in text (toolbar, drag and drop, paste, SVG, popup, viewer), galleries, infobox image frames. Then: categories, category pages, subcategories, sort keys, template defaults, rename/delete.
- Done when: tests pass, the Mac app is built, installed and launched, every item above is clicked through on screen, a test project with 5,000 placeholder pages (~3 categories each) reopens in under 1 s, a category with 2,000 members opens without noticeable delay, renaming a category used on 1,000 pages finishes within a few seconds, a page with 30 large (8,000 px) images scrolls smoothly, the Windows workflow produces an installer, and Juku has reviewed the installed app and approved it.

**After v1 start**
- **M8 Search & sync safety:** full-text deep search; detect files changed by sync and reload; surface sync-conflict copies. Until M8 is done, Juku uses **only one computer** for real content.
- **M9 Health reports.**
- **M10 Graph view.**
- **M11 Themes.**
- **M12 Interactive maps.**
- **M13 Calendars & timelines.**
- **M14 Family trees.**
- **M15 Solar system map** (later version, scope to be defined).
- **M16 Export:** zip, static HTML site.

## Open items (from Juku)
- **Automatic relation fields** (postponed from M5, 2026-10-18): "Linked from" fields that fill themselves (e.g. *Children* lists every page whose *Father* or *Mother* field points here) and two-way link fields (*Spouse* set on A also shows A on B). Natural place: with M14 Family trees. The link index already records infobox links, so no data change is needed.
- **Spoilers:** scope of "reveal all" — per page, everywhere (global switch), or both? Needed before M7.
- **Themes:** colours + fonts only, or also custom CSS? Needed before M11.
- **Group overview pages** (a page per group listing its contents, maybe with own text): wanted later; overlaps with category pages (M6, which can have own text), decide where it fits after M6.
- Visual references (beyond Wikipedia/AWOIAF/Chronicler: what exactly he likes about them)
- App name

## Decision log
- 2026-10-15: projects as top level; blank app with user-defined templates; local-first Mac + Windows; content as plain files in project folders; images stored locally per project; sync via external folder sync; single user; inline spoilers.
- 2026-10-15: UI in English; sync via Google Drive for desktop (Mirror mode or folder available offline); library path is a per-machine setting.
- 2026-10-17: repo github.com/zzjuku/own-wiki (public). Coding happens in local Claude Code on the Mac; Windows builds via GitHub Actions. This SPEC.md in the repo replaces the claude.ai project copy as source of truth.
- 2026-10-17: milestone list added to SPEC; M1 = app shell, library folder, projects, basic Markdown pages, safe writes, Windows CI.
- 2026-10-17: M1 behaviour: delete = move to system Trash; autosave (no Save button); separate View and Edit modes, plain Markdown editor for now (better editor later).
- 2026-10-17: M1 done. Mac app clicked through; tests pass on Mac and Windows; first CI run produced `Own WIKI_0.1.0_x64-setup.exe`.
- 2026-10-17: technical: Tauri 2 + React + TypeScript; Rust handles all file access. File/folder names follow the page/project name and change on rename. Per-machine settings in the OS app-config folder (`settings.json`). App id `io.github.zzjuku.ownwiki`, display name "Own WIKI" (placeholder until the app name is decided). Windows installer is NSIS, built by `.github/workflows/windows.yml` and attached to each run as an artifact.
- 2026-10-17: every milestone ends with Juku's review on his Mac; the app is installed to Applications at each review handoff; out-of-scope feedback is either added or recorded for a later milestone, his choice.
- 2026-10-17: feature list from Juku recorded (section 8). Groups = nested folders, categories = tags, project-wide unique titles; manual `[[ ]]` links with display text; editor option A (Markdown + toolbar + live side preview); template changes propagate, deleted fields are hidden not deleted; Discord-style `||spoilers||`; maps with regions, nested maps and distance; custom calendars with fuzzy dates and ranges; family trees auto-generated, editable and manual, supporting complex relations; solar system map later. Roadmap M2–M16 drafted; real use starts after M7.
- 2026-10-17: one computer only until M8 (sync safety stays in M8); maps from a large exported PNG with tiled zoom and vector overlays, no SVG conversion; family-tree edits write back to infobox fields, placeholder people without pages allowed; spoilers hidden everywhere incl. search, previews and infoboxes, with a reveal-all control; themes app-wide or per project; all of Claude's proposed additions approved.
- 2026-10-17: M2 defined: moving via drag and drop and "Move to…"; deleting a non-empty group trashes it with its contents after a confirmation; alphabetical sidebar order (groups first); group overview pages postponed; M1 pages stay at top level.
- 2026-10-17: M2 technical: page and group ids are `/`-separated paths inside `pages/`. A group's name is its folder name (characters invalid in file names become `-`). If two different titles map to the same file name in one folder, the second file gets " (2)" etc.; the real title stays in the front matter. Path-length warning counts the path from the library folder plus 60 characters reserved for the library's location on Windows, warning above 240; the user can continue anyway. Sidebar order is natural alphabetical (ignores case and accents, "Page 2" before "Page 10"). Open/closed groups are remembered in the app's local browser storage on each computer. Drag and drop uses pointer events (the Windows webview intercepts HTML5 drag and drop). Moving a page whose title duplicates another page's is refused, as the unique-title rule says.
- 2026-10-17: M2 review: groups can be selected; New page / New group create in the selected group, else in the open page's group; project name = top level.
- 2026-10-17: M2 done. Approved by Juku; tests pass on Mac and Windows; Windows CI produced the installer.
- 2026-10-17: M3 defined: read view + split editor (source | live preview); toolbar with toggling buttons and shortcuts; one Enter = new line; toolbar headings start at `##`; no link button before M4, web links open in the browser; tables, footnotes, paste with formatting and word count added to M3; table of contents as box after the intro plus a right-side panel once the box scrolls away; Wikipedia-like page look; infoboxes stay in M5. Previously unassigned additions placed: tables and footnotes → M3, main page per project → M4.
- 2026-10-17: M3 technical: the editor uses CodeMirror 6 (undo across toolbar actions, base for `[[` autocomplete in M4 and a later inline live preview, fast on long pages).
- 2026-10-17: M3 review: table of contents changed to an AWOIAF-style panel left of the page text in the read view (sticky, highlights the current section, foldable sections remembered per page per computer); no contents box in the read view's text; hidden in narrow windows; the editor preview keeps the box.
- 2026-10-17: M3 technical: footnotes use `[^1]` markers and `[^1]: note` lines (numbered on the page in order of first use, whatever the label). Pasted HTML is converted with Turndown; pasted headings move one level down (page title is the top heading); HTML without any formatting is pasted as plain text. Table "rows" = rows below the header. Plain paste reads the clipboard through Tauri's clipboard plugin. Theme contract: every colour and font, the type scale and main layout widths are variables in `src/theme.css`, listed in `docs/theme-variables.md`; small control paddings stay fixed. Web links open through Tauri's opener plugin.
- 2026-10-17: M3 done. Approved by Juku; tests pass on Mac and Windows; Windows CI produced the installer.
- 2026-10-17: M4 defined: rename rewrites `[[Old]]` → `[[New]]` with optional "keep old title as alias"; red links create pages via a dialog prefilled with the linking page's group; "What links here" as a header button with count and a list with context lines; aliases edited under the title in edit mode, autocomplete inserts `[[Alias]]`, alias links show "Redirected from"; new projects get an empty "Main Page" and open on the main page; back/forward added; `[ ] | #` banned in titles and aliases; pipe trick and word endings added; Link button + Cmd+K.
- 2026-10-17: M4 technical: aliases live in front matter (`aliases:`), not in redirect pages; main page stored in `project.json` (`mainPage`, by title). The link index lives in `.cache/` with per-file modification time and size for incremental rebuilds. Links are parsed in Rust (index, rename rewrite) and TypeScript (rendering, editor); both run the same shared test cases so they can't disagree. In tables, the link's `|` is written as `\|` so it doesn't split the cell.
- 2026-10-18: M4 built (Claude's choices, open to Juku's review): a section link without its own text shows "Page § Section" (same-page: "§ Section"); back/forward and the main page button sit at the top of the sidebar; "Set as main page" is in the page's ⋯ menu and the sidebar menu; "Links here (N)" button in the page header; hover cards also show for red links ("Page doesn't exist"); the Link picker (Cmd+K) can also link to a page that doesn't exist yet (red link); quick-open lists aliases with "→ Title"; the mouse's back/forward buttons also work.
- 2026-10-18: M4 technical: the link index (`.cache/link-index.json`) also serves the page list (`get_tree`), so titles and aliases are read once; cache written at most every 10 s for small changes (a stale cache only costs re-reading changed files). Files without front matter stay without it when saved. Rename rewrites linking files in parallel. Measured (release build, 5,000 pages × 20 links): first index build 68 ms, reopen 16 ms, rename of a page with 519 links in 518 pages 1.4 s. The CodeMirror keys Cmd+[ / Cmd+] (indent) and, on Windows, Alt+Left/Right are given to back/forward.
- 2026-10-18: M4 review: Edit link popup added, so the shown text of a link (and where it points) can be changed without typing `[[Page|text]]` (Juku chose it over a second box in the Link dialog or a prompt after autocomplete).
- 2026-10-18: M4 done. Approved by Juku; tests pass on Mac and Windows; Windows CI produced the installer.
- 2026-10-18: M5 defined (Juku): templates are starting points: pages get their own copy of the fields, template changes reach existing pages only through **Apply to existing pages…**; deleting a template leaves pages unchanged; pages can edit their own fields. Basic image import moved from M6 into M5 (image fields). Dates: free-text era and numeric months until M13, qualifiers c./before/after, ranges. Automatic reverse fields ("Linked from") and two-way link fields so relations are entered once. Infobox values edited in an Infobox tab next to Text in edit mode. Templates can pre-fill page text. Switching template keeps same-named values, the rest become hidden values. Type changes keep values that don't fit, with a warning. One infobox per page. Infobox colour per template, changeable per page; themes give the universal look incl. infoboxes. Added: Pages using this template, copy templates from another project, field hints. Not added: default template per group.
- 2026-10-18: M5 checkpoint review (Juku): page column widened from ~880 px to ~1200 px (his choice over full width or full width only on pages with an infobox), so the infobox sits at the page's right edge and text below it fills the column; infobox text fields get visible Bold / Italic / Link buttons and the Edit link popup.
- 2026-10-18: M5 technical: template field keys are random ("f-k2j4"), never reused, so Apply can't mistake a deleted field for a new one; template ids are readable plus random ("template-a-54px"). Images are served to the page through a `wikiasset:` URL scheme that only reads a project's `assets/` folder.
- 2026-10-18: M5 checkpoint answers (Juku): dates shown day.month.year ("12.3.250 AC") until M13; Apply details left to Claude (re-adds template fields deleted on a page; a page's own field with the same name as a new template field becomes that field); Linked from and two-way fields postponed (Open items).
- 2026-10-18: M5 built (Claude's choices, open to Juku's review): Page link fields suggest titles and aliases as you type and show missing pages in red; date fields have boxes for qualifier, day, month, year and era, ranges add "To" with a "present" tick; image fields show a thumbnail with Replace/Remove (Remove keeps the file in `assets/`), the same image file imported twice is stored once; Apply shows per page what changes ("adds 2 fields · hides 1 value"); copying a template whose name is taken shows a box for a new name (untick = skip). Measured (release build, 5,000 pages with infoboxes): reopen 12 ms, Apply to 1,000 pages 3.2 s.
- 2026-10-18: M5 review (Juku): Page link and Page links merged into one **Page link** type that holds one page or several (stored as a list; fields of the older one-page type still read and edit).
- 2026-10-18: M5 done. Approved by Juku; tests pass on Mac and Windows; Windows CI produced the installer.
- 2026-10-18: M6 defined (Juku): subcategories yes; templates give default categories (copied to new pages, added by Apply, never removed); categories can be added/removed in the read view; per-page sort key included; SVG supported for images in page text, galleries and interactive maps (M12, replaces "not SVG"), not for infobox image fields; infobox images all in one fixed frame, filled and cropped, with a draggable crop position; frame size set per project, a template can override it. Claude's choices (Juku left them open): wiki-style image syntax; category pages can have own text, stored in a new `categories/` folder.
- 2026-10-18: M6 technical: images in text are written `[[File:Name.png|right|medium|Caption]]` (not standard Markdown, which has no room for position and size); galleries are a block of `File|Caption` lines between `<gallery>` and `</gallery>`. Displayed images use smaller cached copies in `.cache/`, never the full file. The infobox frame size isn't copied into pages (unlike colour), so changing it changes every infobox at once. Categories, parents and sort keys go into the link index.
- 2026-10-18: M6 checkpoint built (Claude's choices, open to Juku's review): new images go in as right / medium (small 160 px, medium 250 px, large 400 px wide); the Edit image popup applies changes at once (Done closes it); a `|` typed in a caption is stored as `&#124;` and an unfinished `[[` as `[`, so a caption can never break the image; an image on a line of its own floats beside the following text without leaving an empty line; pasted screenshots are named "Pasted image.png" ((2), (3)…); default infobox image frame 250 × 300 px; the crop position is stored with the Image field value as `crop: {x, y}` (percent, 50/50 = centre). Technical: smaller copies are made in widths 320/640/1280/2560 px (twice the shown size, for sharp screens) in `.cache/thumbs/`, at most 2 big images decoded at once; SVG and GIF are always shown as they are; SVG responses carry a policy that blocks scripts. The link index's hover-card image falls back to the first image in the text.
- 2026-10-18: M6 checkpoint review (Juku): infobox pictures get an Adjust picture window with a size slider (down to the whole picture, up to 4× closer) and dragging in every direction, instead of only dragging along the side that sticks out. Stored as `crop: {x, y, zoom, aspect}` (zoom 1 = fills the frame; aspect = the picture's width/height, so pages place it without loading it first); pictures without a zoom still simply fill the frame.
