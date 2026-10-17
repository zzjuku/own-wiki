# Own WIKI — Spec (v0.4, 2026-10-17)

This file is the single source of truth for what the program is and why. Update the decision log whenever a decision changes.

Status: foundation decisions settled. Feature list still to come from Juku.

## Purpose
A blank, local desktop program for building personal wikis for fictional stories. The program is only the container. All content is created by the user inside it. Nothing story-specific is hardcoded.

## Settled decisions

### 1. Structure
- Top level: **Projects**. One project = one independent wiki (one story/world).
- The app ships **blank**. No built-in entity types such as "Character" or "Place". The user defines their own page types or templates (fields, infobox layout) per project.
- Projects are fully self-contained and can be copied, moved, or deleted as one folder.

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
    pages/              # one Markdown file per page, structured fields in YAML front matter
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

### 5. Users and privacy
- Single user. No accounts, no server, no cloud dependency.

### 6. Spoilers
- **Inline** spoiler markup inside page text. The text stays hidden until clicked to reveal.

### 7. Working mode
- Juku doesn't need to understand or maintain the code. Claude builds, tests, and documents. Explanations stay short and user-facing.
- Building happens in **Claude Code on Juku's Mac**, working in this repo. Planning and feature discussion happen in the claude.ai project "Own WIKI".
- This repo contains only program code, never story content. Test fixtures use neutral placeholder data.

## Milestones
Milestones are defined here before they are built. Later milestones get added after Juku's feature list.

### M1 — Foundation (built 2026-10-17; Windows installer pending first CI run)
- Tauri 2 app that launches on the Mac.
- Settings: choose the library folder (stored per machine).
- Projects: create, open, rename, delete. Each project is created with the folder layout from section 3.
- Pages: create, edit, view, rename, delete plain Markdown pages inside a project; a page list per project. Plain text editing is enough; no templates, links, images or spoilers yet.
- Safe writes (temp file + rename) for every file the app saves.
- GitHub Actions workflow that builds a Windows installer, so both platforms are proven from day one.
- Done when: tests pass, the Mac app is built and launched, every item above is clicked through on screen, and the Windows workflow produces an installer.
- Behaviour (Juku's choices, 2026-10-17):
  - Deleting a project or page moves it to the system Trash / Recycle Bin, after a confirmation.
  - Page edits autosave a moment after typing stops, and before switching pages, leaving the project or closing the window. No Save button.
  - A page opens as formatted text. **Edit** switches to a plain-text Markdown editor; **View** switches back. A nicer editor comes later.
- How it works on disk:
  - Page files are named after the page title (`Page A.md`); the real title is also stored as `title:` in the front matter, so titles may contain characters file names can't. Renaming a page renames its file. Other front-matter fields are kept untouched.
  - Project folders are named after the project; renaming a project renames its folder. `project.json` holds `name`, `formatVersion` and `templates`; unknown keys are kept.
  - Names that differ only in upper/lower case count as the same name (keeps projects valid across file systems).

### M2+ — to be defined
Templates, links between pages, search, images, spoilers, file watching / sync-conflict handling, export. Order and scope come from the feature list.

## Open items (from Juku)
- Feature list, split into v1 must-haves and later
- Visual references (wikis/apps he likes, and what he likes about them)
- App name

## Decision log
- 2026-10-15: projects as top level; blank app with user-defined templates; local-first Mac + Windows; content as plain files in project folders; images stored locally per project; sync via external folder sync; single user; inline spoilers.
- 2026-10-15: UI in English; sync via Google Drive for desktop (Mirror mode or folder available offline); library path is a per-machine setting.
- 2026-10-17: repo github.com/zzjuku/own-wiki (public). Coding happens in local Claude Code on the Mac; Windows builds via GitHub Actions. This SPEC.md in the repo replaces the claude.ai project copy as source of truth.
- 2026-10-17: milestone list added to SPEC; M1 = app shell, library folder, projects, basic Markdown pages, safe writes, Windows CI.
- 2026-10-17: M1 behaviour: delete = move to system Trash; autosave (no Save button); separate View and Edit modes, plain Markdown editor for now (better editor later).
- 2026-10-17: technical: Tauri 2 + React + TypeScript; Rust handles all file access. File/folder names follow the page/project name and change on rename. Per-machine settings in the OS app-config folder (`settings.json`). App id `io.github.zzjuku.ownwiki`, display name "Own WIKI" (placeholder until the app name is decided). Windows installer is NSIS, built by `.github/workflows/windows.yml` and attached to each run as an artifact.
