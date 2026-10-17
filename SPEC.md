# Own WIKI — Spec (v0.5, 2026-10-17)

This file is the single source of truth for what the program is and why. Update the decision log whenever a decision changes.

Status: foundation and feature decisions settled; roadmap M2–M16 drafted; M2 defined and ready to build.

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
  - Changing a template updates the layout and fields of all existing pages that use it; values stay.
  - Deleting a field from a template **hides** the values on existing pages, it doesn't delete them.
- **Categories:** easy to add per page, AWOIAF-style list at the bottom of the page, automatic category pages.
- **Embeds:** insert the content of one page into another (navboxes, item cards, stat blocks). Plain embeds first; embeds with parameters only if needed later. Embed loops are detected and blocked.
- **Health reports:** auto-generated reports (broken links, orphan pages, unlinked mentions, missing images, duplicate titles, sync conflicts, hidden template values…) with tools to fix them.
- **Graph view:** Obsidian-style interactive network of linked pages. Must handle thousands of pages: local graph (neighbours of the current page) plus a filterable global graph.
- **Themes:** user-created, selectable, editable themes. A theme is either app-wide or belongs to one project (stored in and synced with that project); a project can use its own theme instead of the app-wide one. UI styling uses CSS variables from the start so themes are cheap to add. Colours/fonts only vs. custom CSS: undecided, settle before M11.
- **Interactive maps:** zoomable, pannable; pins linked to pages with hover preview; drawable regions; nested maps (a pin opens another map); distance measuring.
  - Map source is a painted image (Photoshop), not SVG. Juku exports a large PNG (ideally 8,000+ px on the long side); the app tiles it for smooth deep zoom. Pins, regions, labels and distance lines are vector overlays drawn by the app and stay sharp at any zoom.
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
- **M3 Editor:** split-screen live preview, toolbar + shortcuts, table of contents, theme-ready styling (CSS variables). Replaces M1's separate View/Edit modes for editing.
- **M4 Links:** `[[ ]]` with autocomplete and display text, red links, backlinks, link rewrite on rename, hover previews, aliases/redirects. Introduces the link index in `.cache/`.
- **M5 Templates & infoboxes:** template editor, typed fields, AWOIAF-style infobox. Date fields are stored in a calendar-ready format (era, year, optional month/day, approximate flag, ranges) so M13 doesn't need a migration.
- **M6 Images & categories:** image import into `assets/`, captions, galleries, categories with automatic category pages.
- **M7 Spoilers & embeds.**

**M2 — Structure (defined 2026-10-17, ready to build)**
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
- **Spoilers:** scope of "reveal all" — per page, everywhere (global switch), or both? Needed before M7.
- **Themes:** colours + fonts only, or also custom CSS? Needed before M11.
- **Group overview pages** (a page per group listing its contents, maybe with own text): wanted later; overlaps with category pages (M6), decide where it fits after M6.
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
