# Own WIKI — Spec (v0.15, 2026-10-20)

This file is the single source of truth for what the program is and why. Update the decision log whenever a decision changes. Detailed scopes and decisions of finished milestones are in `docs/history.md`.

Status: M1–M8 done (M8 on 2026-10-20); M9 Relations: checkpoint built (2026-10-20), waiting for Juku's checkpoint review; roadmap M10–M17 drafted.

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
- Never hidden: page titles, aliases, category names, the sidebar, and the fact that one page links to another. A value hidden as a spoiler stays hidden wherever it shows up again (reverse fields in M9, search in M10, timelines, trees…).

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
- **Graph view:** Obsidian-style interactive network of linked pages. Must handle thousands of pages: local graph (neighbours of the current page) plus a filterable global graph.
- **Themes:** user-created, selectable, editable themes. A theme is either app-wide or belongs to one project (stored in and synced with that project); a project can use its own theme instead of the app-wide one. UI styling uses CSS variables from the start so themes are cheap to add. A theme sets colours, fonts (body text and headings separately), text size, line spacing and page width (2026-10-19). Fonts a theme uses are copied into the project/theme so Mac and Windows look the same. Custom CSS on top: not for now, can be added later (Juku, 2026-10-20). The app itself is always light on Mac and Windows, regardless of the system's dark mode (2026-10-19); other looks come only from themes. Themes set one look for all pages, infoboxes included; a page can still give its own infobox a different **colour** (not style).
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
- **M7 Spoilers & embeds** (done 2026-10-20), plus small additions (2026-10-19): AWOIAF-style quote box; separator line in text (toolbar button) and Divider infobox field with optional label; thinner Contents box; app always light; collapsible embed boxes.

**After v1 start**
- **M8 Themes** (done 2026-10-20), plus app-styled tooltips: built-in, app-wide and project themes; colours, a font for every part of the page, sizes and shapes (title position, heading lines, box frames, ornaments, shadows); AWOIAF built-in with its own fonts.
- **M9 Relations** (2026-10-19, pulled forward from Family trees): reverse fields that fill themselves (children from parent fields), two-way fields (spouse), automatic page lists at the bottom of pages (e.g. chapters that take place at a place). A field hidden as a spoiler stays hidden in the reverse field and page lists it fills (2026-10-20). Relations can be added from the reverse side too, writing the forward field on the other page (2026-10-20). Defined 2026-10-20, scope below.
- **M10 Search & sync safety:** full-text deep search; detect files changed by sync and reload; surface sync-conflict copies. Plus easier field moving in the infobox editors (page and template, 2026-10-21): the list scrolls by itself while a field is dragged near the top or bottom edge of a long box, and a field can be moved under another heading in one step ("Move to section…"). Until M10 is done, Juku uses **only one computer** for real content.
- **M11 Health reports.**
- **M12 Graph view.**
- **M13 Interactive maps.**
- **M14 Calendars & timelines.**
- **M15 Family trees** (builds on M9 Relations).
- **M16 Solar system map** (later version, scope to be defined).
- **M17 Export:** zip, static HTML site.

### M9 — Relations (defined 2026-10-20)
Builds on the M5 groundwork: the "Linked from" field type and the reserved `twoWay`/`from` options already exist in the code (display only).
- **Reverse fields** ("Linked from" type, set up in templates or on a page): e.g. *Children* = "pages whose *Father* or *Mother* points here". The fields it reads are named by field **name** (case-insensitive, `options.from`) and match those fields on pages of any template. Optional filter: only pages using certain templates (so a character's *Location* doesn't show up in a place's "Chapters set here"). Entries are links to the pages; links in Page link fields and `[[links]]` in text fields both count.
- **Two-way fields** (a Page link field ticked "Two-way", e.g. *Spouse*): A's *Spouse* → B shows A in B's *Spouse* field, if B's page has a field with that name (otherwise nothing is added to B). Entered on both sides = shown once.
- **Typed-in entries:** a reverse field can also hold names typed by hand (red links if the page doesn't exist). Computed and typed entries are merged; a page appears only once. Changing a Page link field (e.g. a hand-filled *Children*) to "Linked from" keeps its values as typed-in entries.
- **Entering from the reverse side** (Infobox tab): **Add** on Alex's *Children* → pick a page → "Alex is John's: Father / Mother" (one choice per name in `from`) → Alex is written into that field on John's page; nothing is stored on Alex's page. The dialog always says which page it writes to.
  - John has **no page** yet (Juku): the dialog offers "Create page John" (choose a template, created like a page from a red link), then fills the field in it. Typing a plain name instead stays possible (typed-in entry).
  - John's page has **no such field**: it's added as his page's own Page link field.
  - The field **already holds another page** (e.g. Bob) (Juku): "John's Father is already Bob." — **Replace Bob** / **Add Alex too** / Cancel.
  - **Removing** an entry from the reverse side removes Alex from John's field (write-back, with confirmation). Same for two-way fields: removing a spouse that was entered on the other page edits that page.
  - The write-back is one shared function, reused by family-tree edits (M15). Written safely like every save; John's link index entry is updated at once.
- **Sort order** (Juku: per field): by title (natural order, default) or by a date or number field of the listed pages (e.g. *Born*, *Chapter no.*); pages without that value come last, by title. Same choice for page lists.
- **Automatic page lists** (Juku: both ways):
  - As an option of a reverse field: "Show: in the infobox / as a list at the bottom of the page", with a heading (e.g. "Chapters that take place here"). Lives in templates like any field, so Apply to existing pages pushes it; the heading appears in Contents.
  - As a line in the page text, placed anywhere: a Page list dialog writes a `<pagelist …>` line (fields, template filter, sort; format decided when built); clicking it in the source reopens the dialog. Lists pages pointing to the page it's on (also when that page is embedded: the list belongs to the embedded page).
  - An empty list shows nothing (no heading).
- **Spoilers:** an entry coming from a field hidden as a spoiler (or a `||[[link]]||` in a text field) is a spoiler in the reverse field and page list (hidden until clicked, as everywhere). What links here keeps the link (existence of links is never hidden) but no longer shows the field name of a spoiler field (today it shows "via infobox: Father", which leaks it).
- **Field renames:** renaming a field in a template also renames it in every "Linked from" `from` list and template filter of all templates; pages pick it up through Apply, as usual. Without this, every *Children* field would silently go empty.
- **Relations table** (Juku, 2026-10-20): a normal **Relations** item in the project (next to Templates and Categories), to check that relations work. One row per stored relation: page, field, the page it points to, and where it shows up (e.g. "Alex → Children", "Mara → Spouse (two-way)"). Filter by page or field. Flags problems: target page missing (red link), target page has no field that shows it, a "Linked from" field whose `from` names match no field on any page. Spoiler fields stay hidden as everywhere. Can move into Health reports (M11) later.
- The child's chosen parent field exists but isn't a Page link (e.g. a Text field *Father*): that choice is greyed out with a note to change the field to Page link (Juku, 2026-10-20). Nothing is ever written into text.
- **Checkpoint:** reverse fields, two-way fields, typed-in entries, entering/removing from the reverse side incl. create page / replace or add, sort order, spoilers, field renames. Then: page lists (infobox option and text line), final review.
- **Progress (2026-10-20, checkpoint):** done: reverse fields (from, template filter, sort by title or a number/date field), two-way fields, typed-in entries, Add/remove from the reverse side (incl. create page, replace/add, greyed-out wrong type, new field on pages without it), spoilers in reverse fields and What links here, field renames across templates, Linked from offered as a field type; Rust, unit and UI tests (`tests/ui/m9.spec.ts`), speed check (1,000 incoming entries < 1 ms, 5,000-page reopen 11 ms). Left after the checkpoint review: page lists (reverse-field option "as a list at the bottom of the page", `<pagelist>` line in the text, page list speed with 2,000 entries), Relations table, final review.
- **Done when:** the points above work; new features have Playwright UI tests (reverse field shows children, two-way spouse, add from the reverse side writes the other page incl. create page and replace/add, remove writes back, sort by field, page list at the bottom and as a text line, spoiler entries hidden, What links here without spoiler field names) and pass with the Rust and unit tests (incoming fields with template filter and sort, write-back into another page's file, field rename across templates, Relations table rows and problem flags); screenshots check the reverse-side Add dialog, the Relations table, the infobox with reverse fields and both page lists; a page with 1,000 incoming entries and a page list with 2,000 entries open without noticeable delay, a 5,000-page project still reopens in under 1 s if the index changes; this milestone's diff reviewed once for bugs and duplicated code; the Mac app built, installed and checked once on screen; the Windows workflow produces an installer; Juku has reviewed the installed app and approved it.

### How every milestone is written
- **Done when** always includes: new features have automated UI tests (Playwright smoke tests in `tests/ui/`) and pass with the Rust and unit tests; screenshots check how new or changed screens look; speed targets only if the milestone touches loading, the index, search or big lists; this milestone's diff reviewed once for bugs and duplicated code; the Mac app built, installed and checked once on screen; the Windows workflow produces an installer; Juku has reviewed the installed app and approved it.
- A milestone may name a **checkpoint** partway for Juku. A session that ends partway adds a short **Progress** note (done / left / open questions) to the milestone here.

## Rules from finished milestones (M1–M8)
Everything later work must keep working. Reasons and full detail: `docs/history.md` (search it).

**Stack and code**
- Tauri 2 + React + TypeScript. Rust does all file access (commands in `src-tauri/src/lib.rs`, typed wrappers in `src/api.ts`). Editor: CodeMirror 6. Pasted HTML → Markdown via Turndown. Web links open through the opener plugin; plain paste reads the clipboard plugin.
- Links are parsed in both Rust (index, rewrites) and TypeScript (rendering, editor); both run `shared-tests/links.json`, so change both together.
- Theme contract: every colour and font, the type scale and main layout widths are CSS variables in `src/theme.css`, listed in `docs/theme-variables.md` and offered by the editor in `src/themes/vars.ts` (keep all three in sync). No hard-coded colours. The app is always light, title bar included (window `theme: "Light"`); the system's dark mode is ignored; other looks only from themes.
- Per-machine settings (library path) live in `settings.json` in the OS app-config folder. Per-computer UI state (open groups, editor divider, folded contents sections, "Include pages of subcategories", the global "show all spoilers" switch, the hidden sidebar, where the page's right edge was dragged to) lives in browser local storage. Neither is ever synced.
- App id `io.github.zzjuku.ownwiki`, display name "Own WIKI" (placeholder). Windows installer: NSIS, built by `.github/workflows/windows.yml`. Builds unsigned.

**Folders and files**
- Project folder: `project.json`, `pages/`, `assets/`, `categories/`, `.cache/` (rebuildable, never synced or exported). Project folder named after the project; renaming renames it.
- Every write: temp file + rename. Every delete (project, page, group, category file) goes to the system Trash / Recycle Bin after a confirmation that states what's affected.
- `project.json` keys: `name`, `formatVersion` (1), `templates`, `mainPage` (title), `infoboxImage` (project frame `{width, height}`, default 250 × 300), `hideCategoryBox`, `presentDay` (a date: the story's "today", for ages). Unknown keys are kept, everywhere (project.json, front matter, fields).
- Pages: `pages/…/Title.md`; groups are subfolders (nested). Page and group ids are `/`-separated paths inside `pages/`. A group's name is its folder name (characters invalid in file names become `-`). Two titles mapping to one file name in a folder: the second gets " (2)" etc. Renaming a page renames its file. Files without front matter stay without it when saved.
- Page front matter keys: `title` (the real title), `aliases` (list), `categories` (list), `sort` ("Sort as"), `infobox` (`template`, `color`, `ownColor`, `fields`, `hidden`).
- Category files: `categories/Name.md` (named like pages, " (2)" on clashes) with own text and `parents`; created when a category gets text or parents, or is created from a red link / New category. A category exists while a page, template default, subcategory or its own file uses it.
- Link index: `.cache/link-index.json` (cache version 6; bump when its format changes), per-file modification time and size for incremental rebuilds. Holds titles, aliases, headings, outgoing links (text and infobox), embeds (kept apart from links), opening paragraphs (quote boxes and embed lines left out, never cut inside a spoiler), hover-card image (not a spoiler image), categories, parents and sort keys; also serves the page tree. Updated on every save, rename, move and delete; written at most every 10 s for small changes. Files changed outside the app are picked up at next project open (live reload: M8).
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
- Renaming a page rewrites `[[Old]]` → `[[New]]`, `[[Old#S]]` → `[[New#S]]` and embeds `{{Old…}}` → `{{New…}}` in pages, category texts and infobox fields; links with own text keep it; links through an alias are untouched; `mainPage` follows; optional "keep old title as alias". Renaming a heading doesn't rewrite links. Deleting a page turns its links red.
- New projects get an empty "Main Page" set as main page.

**Images**
- In text: `[[File:Name.png|right|medium|Caption]]`; positions `right` (default), `left`, `center`, `full`; sizes `small` 160, `medium` (default) 250, `large` 400 px; option `spoiler` (blurred until clicked). In captions `|` is stored as `&#124;` (read back as `|`, so `||spoilers||` work there) and an unfinished `[[` as `[`. Galleries: `<gallery>` (or `<gallery spoiler>`) … one `File|Caption` line per image … `</gallery>`.
- Import (button, drag and drop, paste, Image fields) copies into `assets/`, keeps the original name (" (2)" on clashes), the same file twice is stored once, pasted images are named "Pasted image.png". Removing an image never deletes its file.
- Formats: PNG, JPG, GIF, WebP, SVG in text and galleries; Image fields: no SVG.

**Templates and infobox fields**
- Field: `key` (template field it came from; absent = the page's own), `label`, `type`, `hint`, `options` (`choices`, `ranges`, reserved `twoWay`/`from`, `place`), `value`.
- `options.place` (2026-10-21): Text, Choice and List fields can show `above` or `below` the infobox title (titles, nicknames; smaller), Image fields `beside` it (small pictures left and right; one picture shows on both sides, two go one each side). Such fields aren't repeated as rows unless ticked "Also show it in the box" (`options.inBox`, above/below only), and a picture beside the title is never the hover-card picture. Types: `text`, `longtext`, `number`, `yesno`, `choice`, `list`, `links` ("Page link": one page or several, stored as a list; the older one-page `link` type still reads and edits but isn't offered), `date`, `dateplace` ("Date, place": a date or range, then a place after a comma), `datetext` ("Date, text": a date or range, then a smaller note; value `{date, text}`, a list of them with option `multiple` "Several entries"; the text may hold links, which count like links in text fields; the date sorts reverse fields), `image`, `heading`, `divider` (a line in the box, optional label, no value); `linkedfrom` reserved (M8). A page's field may have `spoiler: true` (whole value hidden until clicked; templates can't set it; Apply keeps it).
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
- App-wide themes: library folder `_themes/<Name>/` (theme.json, `fonts/`), chosen one in `_themes/settings.json` (`active`: "builtin:<id>" / "app:<folder>"), all synced. Project themes: `<project>/themes/<Name>/`; project.json `theme` ("builtin:<id>" / "project:<folder>", absent = app theme). A project's theme wins while it's open; the library uses the app theme. `_themes` is no project and not allowed as a project name.
- Built-ins (Default, Parchment, AWOIAF) live in code, can't be edited or deleted, only copied. Their fonts come with Mac and Windows or with the app (`src/themes/fonts/`, OFL); copying a theme copies its fonts.
- Fonts used by a theme are always copied into its folder (installed fonts incl. faces out of .ttc collections, or imported .ttf/.otf/.woff/.woff2) and loaded with the FontFace API under a generated one-word name per theme and family. Every part of the page has its own font variable (`--font-title`, `--font-infobox-…`, `--font-toc`, …), following the page or headings font when unset.
- Theme names unique per place (case-insensitive); deleting goes to the Trash; a deleted theme in use falls back to Default / the app theme. Edits save automatically and show live when the theme is in use.
- Infobox look settings (2026-10-21): `--infobox-heading-style` (`bar` / `lined`: larger, thin lines above and below), `--infobox-label-weight`, `--infobox-row-space` (row spacing); the ornate infobox frame has AWOIAF's corner ornament at all four corners. Default infobox width 24em. Copying a built-in theme writes its fonts from the app itself (built into the program), never through the window.
- Tooltips: every `title` shows as an app-styled tooltip (`src/Tooltip.tsx`; the title moves to `data-tip` while hovered); page links have no title and keep their hover cards. Shortcuts stay in the text. Colours `--tooltip-bg`/`--tooltip-text`.

**Behaviour to keep**
- Autosave a moment after typing stops and before switching pages, leaving the project or closing the window; no Save button.
- Pages open in the read view; new pages open in the editor. Shortcuts in use (Ctrl on Windows): Cmd+O quick-open, Cmd+E read/edit, Cmd+B/I bold/italic, Cmd+Shift+X strikethrough, Cmd+Shift+S spoiler, Cmd+Alt+1/2/3 headings, Cmd+Shift+8/7 lists, Cmd+K link, Cmd+F find, Cmd+Z / Cmd+Shift+Z undo/redo, Cmd+Shift+V plain paste, Cmd+[ / Cmd+] back/forward (Alt+Left/Right on Windows), Cmd+click follows a link in the source.
- One Enter = new line in the preview; an empty line = new paragraph.

**Promised to later milestones (from M1–M8 scopes)**
- M9: `linkedfrom` fields and the reserved `twoWay`/`from` options; a field hidden as a spoiler stays hidden in the reverse fields and page lists it fills.
- M10: search in infobox fields and aliases (spoilers stay hidden in results); live reload of files changed outside the app.
- M11: unlinked mentions, broken section links (incl. renamed headings), unused images, hidden template values.
- M13: map location fields; SVG maps.
- M14: calculated fields (e.g. age); eras and month numbers mapped to real calendars without a data migration.
- Later / undecided: a frame option per theme for plain (seamless) embeds (asked in M8, not answered); hover card rework to look more like AWOIAF's (e.g. bigger picture, wider card; details to define), Obsidian-style inline live preview, page history/undo of edits, image file pages ("File:" pages with description), group overview pages (Open items). Not planned: categories driven by field values, automatic linking of plain words.

## Open items (from Juku)
- **Group overview pages** (a page per group listing its contents, maybe with own text): wanted later; overlaps with category pages (M6, which can have own text), decide where it fits after M6.
- Visual references (beyond Wikipedia/AWOIAF/Chronicler: what exactly he likes about them)
- App name
- **Spoiler levels per book** ("reveal up to Book 2"): proposed by Claude 2026-10-20, undecided; the `||` format can be extended later without changing existing spoilers.


## Decision log
- Entries up to 2026-10-18 (M1–M6), the M7 entries (2026-10-19 – 2026-10-20) and the M8 entries (2026-10-20): see `docs/history.md`.
- 2026-10-18 (maintenance, not a milestone): SPEC.md trimmed; finished scopes and the old decision log moved to `docs/history.md` unchanged, SPEC.md keeps a "Rules from finished milestones" summary. `src/styles.css` split into `src/styles/*.css` by area, imported in the original order from `src/main.tsx` (pure move: the built CSS is byte-identical, screenshots unchanged).
- 2026-10-18 technical: automated UI tests with **Playwright** (Chromium) against the Vite dev server (port 1430) on `tests/ui/harness.html`, which installs an in-memory backend (`tests/ui/mock/`, via Tauri's `mockIPC`) before the app; images answer with a placeholder picture. tauri-driver isn't used (no macOS support). The real file and index logic stays covered by the Rust tests. `npm test` = unit + Rust (also in Windows CI); `npm run test:ui` = type-check + Playwright (Mac only for now). Smoke tests cover opening a project, creating/editing a page, links, infobox from a template, image in text and categories.
- 2026-10-19 (planning): Juku's list of small additions placed. M7 gains an AWOIAF-style quote box (inserted by hand), a separator line in text + Divider infobox field (optional label), a thinner Contents box, and the app is always light on Mac and Windows (replaces "follows the system"). Automatic relation fields pulled forward from Family trees into a new **M8 Relations** (calculated from the link index, never written into other files; parents → children, two-way for spouse), together with automatic page lists such as "Chapters that take place at …". Themes (now M12) also set fonts (body, headings), text size, line spacing and page width; fonts are copied into the project. Later milestones renumbered +1 (old M8 → M9 … M16 → M17); `docs/history.md` keeps the old numbers. Edit/read hotkey already exists (Cmd+E).
- 2026-10-20 (planning): AWOIAF-style rework of the hover cards moved to a later version (listed under "Later / undecided"); the current M4/M6 hover cards stay as they are.
- 2026-10-20 (planning): embed boxes get their own look per theme (frame/box appearance, background, colours), added to M12 Themes.
- 2026-10-20 (planning, Juku chose option A of two): relations can be entered from either side. Adding a child on a parent's page asks which parent field of the child it fills and writes it into the child's page; storage stays one-directional (the child's parent field), so *Father* / *Mother* stay separate fields. This lifts M9's "never written into another page's file" rule for exactly this case; the write-back is shared with M15 Family trees. Rejected: one neutral *Parents* field paired two-way with *Children* (simpler, but loses Father/Mother).
- 2026-10-20 (planning): **M9 Relations defined** (scope above). Juku: adding a child that has no page offers to create the page and fills its parent field; a parent field already holding another page asks Replace / Add / Cancel; page lists both as a reverse-field option (bottom of the page, pushed by Apply) and as a `<pagelist>` line in the text; sort order chosen per field (title, or a date/number field of the listed pages). Claude, accepted with the scope: template filter for reverse fields; typed-in entries merged with computed ones; a missing parent field is added as the child's own field; removing from the reverse side writes back; What links here hides the field name of spoiler fields; renaming a field updates `from` lists in all templates.
- 2026-10-20 (planning, Juku): M9 gains a **Relations table** as a normal project menu item (one row per stored relation, where it shows up, problems flagged) instead of a picture of the relations; a drawn tree stays in M15. Changing a field to "Linked from" keeps its values as typed-in entries.
- 2026-10-20 (M9, Juku): a parent field of the wrong type (e.g. Text) is greyed out in the Add dialog with a note to change it to Page link; the app never writes into text.
- 2026-10-20 (M9 technical): Linked from options are `from` (field names), `templates` (template ids; renaming a template changes nothing) and `sortBy` (a field name); typed-in entries are the field's `value` (list of names) and count as links (renames rewrite them, What links here lists them). Sort keys come from the link index (cache version 7, `values`): numbers, and dates as year/month/day of the start (eras not compared until M14); values of spoiler fields are left out, so the order never gives a hidden value away. A two-way link shows on the other page if it has a Page link field of that name, ticked two-way or not. The Add dialog preselects the first usable field in `from` order (a taken one shows "already …" rather than another field being picked quietly). Entries from text fields (`[[links]]`) can't be removed from the reverse side; the dialog says where to change them. A field rename takes effect when the label box is left; while another template still has a field with the old name, the new name is added next to it in `from` lists. What links here says "a spoiler field" instead of the name. Embedded infoboxes show their Linked from entries too. New commands `relations`, `set_relation` (replaces `incoming_fields`); write-back in `src-tauri/src/relations.rs`, entries in `src/relations.ts`.
- 2026-10-21 (planning, Juku): M10 gains easier field moving in the infobox editors (page and template): auto-scroll while dragging in a long box, and "Move to section…" to put a field under another heading in one step. Reordering the pages inside a Page link field not wanted for now.
- 2026-10-21 (Juku, during the M9 checkpoint, done before continuing M9): copying the AWOIAF theme failed ("No font data": the font bytes didn't arrive when the window used its fallback message channel); fixed by building the app's own fonts into the program and writing them when a built-in theme is copied (a failed copy leaves nothing behind); pasted images accept both forms of the bytes. AWOIAF look: infobox section headings larger with thin lines above and below and the text centred, roomier rows, grey semi-bold labels, double frame with AWOIAF's corner ornament at all four corners (Juku: the bottom ornament, at the top too). Every theme's standard infobox a little wider (Default 22em → 24em, AWOIAF 23em → 25.5em). New field option "Show": above/below the title (titles, nicknames) or beside it (pictures such as a coat of arms), chosen per field so templates and Apply carry it (Juku chose this over two plain boxes per page).
- 2026-10-21 (Juku, M9 checkpoint review, done before continuing M9): a page name that doesn't exist yet in a Page link field offers **Create page…** right there (title, group, template; you stay on the page you're editing). Pages created from a page (red links, that button) get the open page's template preselected, still changeable, and are only created on Create. Enter in a List or Page link entry starts the next entry (not after an empty one). The sidebar can be hidden (button at its top, ⌘\ / Ctrl+\, remembered per computer). Juku chose dragging the page's right edge to set the page width: all projects, per computer, overriding the theme's page width; double-click the edge for the theme's width again. Fields shown above or below the infobox title can also keep their row in the box.
- 2026-10-21 (Juku, M9 checkpoint review): Add on a Linked from field uses the same **Create page…** button under the name as Page link fields (open page's template suggested); after creating, the dialog goes on with "Alex is John's: …". The dialog's own template/group section is gone. New field types **Date, place** and **Date, text** (Claude: place after a comma, the text after the date in a smaller font; "Allow ranges" and "Several entries" as options; a Date field changed to either keeps its date). The dragged page width now remembers where the page's right edge sits on screen: the infobox stays put when the sidebar is hidden or shown, and the text and Contents take the room (replaces the fixed width from earlier today).
- 2026-10-21 (M9, from Juku's setup): a Linked from field whose `from` names only Linked from fields (e.g. Father reading Children while Children reads Father) stores nothing, so nothing can be added. The template editor and the Infobox tab now warn about it (and about `from` names no template has); the Add dialog says the other page's field "is a Linked from field; make it a Page link field". Sort-by choices include Date, place / Date, text fields.
- 2026-10-21 (Juku: "quick select multiple pages", all three places): **Sidebar**: ⌘/Ctrl-click picks pages one by one (the open page counts), Shift-click a run of them; a bar below the tree moves them to a group, adds a category to all, or moves them to the Trash (one confirmation); dragging a picked page moves all picked pages; a plain click or Escape lets go. **Page link fields**: "+ Add several…" opens a list with tick boxes and a search (Enter ticks the best match). **Linked from fields**: "+ Add several…" ticks pages, then one choice ("Alex is their: Father") for all, a line per page saying what happens, and for pages whose field already holds another page: add next to it, replace, or leave that page alone.
- 2026-10-21 (Juku): Date, place shows the place on its own line under the date. **Ages** (pulled forward from M14's calculated fields): Date and Date, place fields get a setting "Age: Birth date / Death date" (`options.age`; Juku chose this over going by the names "Born"/"Died"); Project settings get a **Present day** (`presentDay`). A birth date shows "(age N)" counted to the present day while no death field has anything in it; a death date shows "(aged N)". Whole years, one less before the birthday when months/days are known; "c." when either date is approximate; nothing when the eras differ by name (calendars: M14) or no present day is set; an age at death from a birth date hidden as a spoiler is hidden too. AWOIAF row spacing 0.42em → 0.55em.
