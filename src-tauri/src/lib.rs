mod assets;
mod categories;
mod conflicts;
mod edits;
mod error;
mod family;
mod fonts;
mod fsutil;
mod graph;
mod groups;
mod index;
mod infobox;
mod library;
mod markers;
mod pages;
mod projects;
mod relations;
mod relink;
mod search;
mod searchtext;
mod settings;
mod templating;
mod textimages;
mod theme_commands;
mod themes;
mod tree;
mod watcher;
mod wikilinks;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};

use error::{AppError, AppResult};
use index::ProjectIndex;
use infobox::{Infobox, Template};
use pages::Page;
use projects::ProjectInfo;
use relink::{Backlink, LinkCount, Preview, RenameResult};
use templating::ApplyResult;
use settings::Settings;
use tree::{GroupInfo, PageInfo, Tree};
use wikilinks::{Heading, norm};

pub(crate) struct AppState {
    config_dir: PathBuf,
    settings: Mutex<Settings>,
    /// Fonts installed on this computer, by family (read once, when first asked).
    installed_fonts: Mutex<Option<std::collections::BTreeMap<String, Vec<fonts::InstalledFace>>>>,
    /// Link index of the open project (one at a time).
    index: Mutex<Option<ProjectIndex>>,
    /// Search index of the open project (built on first use, see search.rs).
    search: Mutex<Option<search::SearchIndex>>,
    /// Watches the open project for changes from outside (watcher.rs).
    watch: Mutex<Option<watcher::Watch>>,
    /// The folder of the project marked as open here (its marker goes when the app quits).
    marked: Mutex<Option<PathBuf>>,
    /// The window has saved everything and the app may quit now.
    may_exit: std::sync::atomic::AtomicBool,
}

impl AppState {
    fn library(&self) -> AppResult<PathBuf> {
        settings::library_dir(&self.settings.lock().unwrap())
    }

    /// Runs `f` with the project's link index, loading it first if another
    /// project's (or none) is loaded. With `refresh`, files changed on disk
    /// are re-read first.
    fn with_index<R>(
        &self,
        project: &str,
        refresh: bool,
        f: impl FnOnce(&std::path::Path, &mut ProjectIndex) -> AppResult<R>,
    ) -> AppResult<R> {
        let library = self.library()?;
        let dir = projects::project_dir(&library, project)?;
        let mut guard = self.index.lock().unwrap();
        match guard.as_mut() {
            Some(idx) if idx.dir == dir => {
                if refresh {
                    idx.refresh(&[])?;
                }
            }
            _ => {
                let mut idx = ProjectIndex::open(&dir)?;
                // Edits of this computer that Drive overwrote while the project was closed come back as copies.
                if edits::check(&dir, None) > 0 {
                    idx.refresh(&[])?;
                }
                *guard = Some(idx);
            }
        }
        f(&library, guard.as_mut().unwrap())
    }

    /// Re-reads changed files into the link index, if project `dir`'s is loaded (the watcher calls this).
    pub(crate) fn refresh_open_index(&self, dir: &std::path::Path) -> AppResult<()> {
        let mut guard = self.index.lock().unwrap();
        match guard.as_mut() {
            Some(idx) if dunce::canonicalize(&idx.dir).ok().as_deref() == Some(dir) || idx.dir == dir => {
                idx.refresh(&[])?;
                // An edit of this computer overwritten by the other's version comes back as a copy.
                if edits::check(&idx.dir, None) > 0 {
                    idx.refresh(&[])?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn forget_index(&self) {
        if let Some(mut idx) = self.index.lock().unwrap().take() {
            idx.save_cache(true);
        }
        if let Some(mut s) = self.search.lock().unwrap().take() {
            s.save_cache(true);
        }
    }

    /// Runs `f` with the project's search index, brought up to date with the
    /// files the link index knows. The link index is only held while its
    /// file list is copied, so reading many files doesn't hold up other commands.
    fn with_search<R>(&self, project: &str, f: impl FnOnce(&search::SearchIndex, &[search::Source]) -> R) -> AppResult<R> {
        let (dir, sources) = self.with_index(project, false, |_, idx| Ok((idx.dir.clone(), search::sources(idx))))?;
        let mut guard = self.search.lock().unwrap();
        if guard.as_ref().is_none_or(|s| s.dir != dir) {
            if let Some(mut old) = guard.take() {
                old.save_cache(true);
            }
            *guard = Some(search::SearchIndex::open(&dir));
        }
        let s = guard.as_mut().unwrap();
        s.sync(&sources);
        s.save_cache(false);
        Ok(f(s, &sources))
    }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_library_path(state: State<AppState>, path: String) -> AppResult<Settings> {
    if !PathBuf::from(&path).is_dir() {
        return Err(AppError::NotFound(format!("Folder not found: {path}")));
    }
    state.forget_index();
    let mut current = state.settings.lock().unwrap();
    let mut next = current.clone();
    next.library_path = Some(path);
    settings::save(&state.config_dir, &next)?;
    *current = next.clone();
    Ok(next)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryMove {
    settings: Settings,
    /// Where the library is (or, with `dry_run`, would be) after the move.
    target: String,
    /// Where the library was (its folders are left there as a backup).
    old: String,
    /// The folders copied (projects and `_themes`).
    folders: Vec<String>,
    files: u64,
}

/// Copies the library into `dest` (or a new folder in it, see library.rs),
/// checks the copy and uses it from now on. The old folder stays.
/// `dry_run`: only say where it would go (or why it can't).
#[tauri::command(async)]
fn move_library(state: State<'_, AppState>, dest: String, dry_run: bool) -> AppResult<LibraryMove> {
    let old = state.library()?;
    let target = library::move_target(&old, std::path::Path::new(&dest))?;
    let show = |p: &std::path::Path| p.to_string_lossy().into_owned();
    let folders = library::wiki_folders(&old)?
        .iter()
        .map(|f| f.file_name().unwrap_or_default().to_string_lossy().into_owned())
        .collect();
    if dry_run {
        let settings = state.settings.lock().unwrap().clone();
        return Ok(LibraryMove { settings, target: show(&target), old: show(&old), folders, files: 0 });
    }
    state.forget_index();
    let count = library::copy_library(&old, &target)?;
    let mut current = state.settings.lock().unwrap();
    let mut next = current.clone();
    next.library_path = Some(target.to_string_lossy().into_owned());
    settings::save(&state.config_dir, &next)?;
    *current = next.clone();
    Ok(LibraryMove { settings: next, target: show(&target), old: show(&old), folders, files: count.files })
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> AppResult<Vec<ProjectInfo>> {
    projects::list_projects(&state.library()?)
}

#[tauri::command]
fn create_project(state: State<AppState>, name: String) -> AppResult<ProjectInfo> {
    projects::create_project(&state.library()?, &name)
}

#[tauri::command]
fn rename_project(state: State<AppState>, id: String, name: String) -> AppResult<ProjectInfo> {
    state.forget_index();
    projects::rename_project(&state.library()?, &id, &name)
}

#[tauri::command]
fn delete_project(state: State<AppState>, id: String) -> AppResult<()> {
    state.forget_index();
    projects::delete_project(&state.library()?, &id)
}

// Commands that use the link index run off the main thread (`async`), so a
// big project being indexed doesn't freeze the window.

#[tauri::command(async)]
fn get_tree(state: State<'_, AppState>, project: String) -> AppResult<Tree> {
    state.with_index(&project, true, |library, idx| {
        Ok(Tree {
            groups: idx.groups.clone(),
            pages: idx.page_infos(),
            main_page: projects::main_page(&idx.dir),
            conflicts: conflicts::list(library, idx).len(),
        })
    })
}

#[tauri::command(async)]
fn create_page(
    state: State<'_, AppState>,
    project: String,
    group: String,
    title: String,
    allow_long: bool,
    template: Option<String>,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let template = match template {
            Some(id) => Some(
                projects::templates(&idx.dir)?
                    .into_iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| AppError::NotFound("That template doesn't exist any more.".into()))?,
            ),
            None => None,
        };
        let info =
            pages::create_page(library, &project, &group, &title, allow_long, &idx.page_infos(), template.as_ref())?;
        idx.refresh(&[&info.id])?;
        Ok(info)
    })
}

#[tauri::command]
fn read_page(state: State<AppState>, project: String, id: String) -> AppResult<Page> {
    pages::read_page(&state.library()?, &project, &id)
}

#[tauri::command(async)]
fn save_page(state: State<'_, AppState>, project: String, id: String, body: String, version: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        pages::save_page(library, &project, &id, &body, version.as_deref())?;
        idx.reload_page(&id);
        Ok(())
    })
}

#[tauri::command(async)]
fn save_infobox(
    state: State<'_, AppState>,
    project: String,
    id: String,
    infobox: Option<Infobox>,
    version: Option<String>,
) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        pages::save_infobox(library, &project, &id, infobox.as_ref(), version.as_deref())?;
        idx.reload_page(&id);
        Ok(())
    })
}

/// Templates of any project (also another one, for copying templates).
#[tauri::command]
fn get_templates(state: State<AppState>, project: String) -> AppResult<Vec<Template>> {
    projects::templates(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command(async)]
fn set_templates(state: State<'_, AppState>, project: String, templates: Vec<Template>, version: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |_, idx| projects::set_templates(&idx.dir, &templates, version.as_deref()))
}

/// The open project's templates and project.json's version (for saving them back).
#[tauri::command]
fn project_templates(state: State<AppState>, project: String) -> AppResult<projects::VersionedTemplates> {
    projects::templates_versioned(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command(async)]
fn template_pages(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<PageInfo>> {
    state.with_index(&project, true, |_, idx| Ok(templating::template_pages(idx, &id)))
}

#[tauri::command(async)]
fn apply_template(
    state: State<'_, AppState>,
    project: String,
    id: String,
    pages: Option<Vec<String>>,
    dry_run: bool,
) -> AppResult<ApplyResult> {
    state.with_index(&project, true, |library, idx| {
        templating::apply(library, &project, idx, &id, pages.as_deref(), dry_run)
    })
}

/// What other pages' fields add to page `id`; `typed`: names typed into its
/// Linked from fields (their sortable values come along).
#[tauri::command(async)]
fn relations(state: State<'_, AppState>, project: String, id: String, typed: Vec<String>) -> AppResult<relations::Relations> {
    state.with_index(&project, false, |_, idx| relations::relations(idx, &id, &typed))
}

/// Pages that show page `id` through relations stored on it ("What links here").
#[tauri::command(async)]
fn shown_on(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<relations::ShownOn>> {
    state.with_index(&project, false, |_, idx| relations::shown_on(idx, &id))
}

/// Every stored relation, where it shows up, and what doesn't work.
#[tauri::command(async)]
fn relations_table(state: State<'_, AppState>, project: String) -> AppResult<relations::RelationsTable> {
    state.with_index(&project, true, |_, idx| Ok(relations::table(idx)))
}

/// Writes page `source` into (or out of) field `field` of page `target`.
#[tauri::command(async)]
fn set_relation(
    state: State<'_, AppState>,
    project: String,
    target: String,
    field: String,
    source: String,
    edit: relations::Edit,
) -> AppResult<()> {
    state.with_index(&project, true, |library, idx| {
        relations::set_relation(library, &project, idx, &target, &field, &source, edit)
    })
}

/// Copies an image file into the project. `svg`: SVG is allowed (page text, galleries).
#[tauri::command(async)]
fn import_image(state: State<'_, AppState>, project: String, path: String, svg: bool) -> AppResult<String> {
    assets::import_image(&state.library()?, &project, std::path::Path::new(&path), svg)
}

/// Stores a pasted image. The bytes are the request body; `project` and
/// `name` come as percent-encoded headers.
#[tauri::command(async)]
fn import_image_data(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> AppResult<String> {
    let data = request_bytes(&request).ok_or_else(|| AppError::Invalid("No image data.".into()))?;
    let header = |k: &str| {
        request.headers().get(k).and_then(|v| v.to_str().ok()).map(assets::percent_decode).unwrap_or_default()
    };
    assets::import_image_data(&state.library()?, &header("project"), &header("name"), &data, true)
}

/// Writes a family tree image (M12, Save as image) to the file the user chose
/// in the save dialog. The bytes are the request body; `path` comes as a
/// percent-encoded header. Only .png and .svg files are written.
#[tauri::command(async)]
fn save_image_file(request: tauri::ipc::Request<'_>) -> AppResult<()> {
    let data = request_bytes(&request).ok_or_else(|| AppError::Invalid("No image data.".into()))?;
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).map(assets::percent_decode).unwrap_or_default();
    let path = std::path::PathBuf::from(path);
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    if !path.is_absolute() || !matches!(ext.as_deref(), Some("png") | Some("svg")) {
        return Err(AppError::Invalid("Images can only be saved as .png or .svg files.".into()));
    }
    Ok(fsutil::safe_write(&path, &data)?)
}

/// The bytes sent with a command: raw, or, when the window had to fall back
/// to its second message channel, the same bytes as a JSON list of numbers.
fn request_bytes<'a>(request: &'a tauri::ipc::Request<'_>) -> Option<std::borrow::Cow<'a, [u8]>> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => Some(std::borrow::Cow::Borrowed(data)),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(list)) => list
            .iter()
            .map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect::<Option<Vec<u8>>>()
            .map(std::borrow::Cow::Owned),
        _ => None,
    }
}

#[tauri::command]
fn get_project_settings(state: State<AppState>, project: String) -> AppResult<projects::ProjectSettings> {
    projects::settings(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command]
fn set_project_settings(state: State<AppState>, project: String, settings: projects::ProjectSettings) -> AppResult<()> {
    projects::set_settings(&projects::project_dir(&state.library()?, &project)?, &settings)
}

#[tauri::command]
fn get_image_frame(state: State<AppState>, project: String) -> AppResult<projects::Frame> {
    projects::image_frame(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command]
fn set_image_frame(state: State<AppState>, project: String, frame: projects::Frame) -> AppResult<()> {
    projects::set_image_frame(&projects::project_dir(&state.library()?, &project)?, frame)
}

#[tauri::command(async)]
fn rename_page(
    state: State<'_, AppState>,
    project: String,
    id: String,
    title: String,
    allow_long: bool,
    keep_alias: bool,
) -> AppResult<RenameResult> {
    state.with_index(&project, true, |library, idx| {
        relink::rename_with_links(library, &project, idx, &id, &title, allow_long, keep_alias)
    })
}

#[tauri::command(async)]
fn move_page(
    state: State<'_, AppState>,
    project: String,
    id: String,
    target: String,
    allow_long: bool,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let info = pages::move_page(library, &project, &id, &target, allow_long, &idx.page_infos())?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn delete_page(state: State<'_, AppState>, project: String, id: String) -> AppResult<()> {
    state.with_index(&project, true, |library, idx| {
        let title = idx.pages.get(&id).map(|e| e.title.clone());
        pages::delete_page(library, &project, &id)?;
        // Deleting the main page leaves the project without one.
        if let (Some(t), Some(m)) = (title, projects::main_page(&idx.dir)) {
            if norm(&t) == norm(&m) {
                projects::set_main_page(&idx.dir, None)?;
            }
        }
        idx.refresh(&[])
    })
}

#[tauri::command(async)]
fn set_aliases(
    state: State<'_, AppState>,
    project: String,
    id: String,
    aliases: Vec<String>,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let info = pages::set_aliases(library, &project, &id, &aliases, &idx.page_infos())?;
        idx.reload_page(&id);
        Ok(info)
    })
}

#[tauri::command(async)]
fn set_main_page(state: State<'_, AppState>, project: String, title: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |_, idx| projects::set_main_page(&idx.dir, title.as_deref()))
}

#[tauri::command(async)]
fn page_sections(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<Heading>> {
    state.with_index(&project, false, |_, idx| relink::sections(idx, &id))
}

#[tauri::command(async)]
fn link_preview(
    state: State<'_, AppState>,
    project: String,
    id: String,
    section: Option<String>,
) -> AppResult<Preview> {
    state.with_index(&project, false, |library, idx| {
        relink::preview(library, &project, idx, &id, section.as_deref())
    })
}

#[tauri::command(async)]
fn backlinks(
    state: State<'_, AppState>,
    project: String,
    id: String,
    context: bool,
) -> AppResult<Vec<Backlink>> {
    state.with_index(&project, false, |library, idx| relink::backlinks(library, &project, idx, &id, context))
}

#[tauri::command(async)]
fn embedded_in(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<relink::EmbedHost>> {
    state.with_index(&project, false, |_, idx| relink::embedded_in(idx, &id))
}

#[tauri::command(async)]
fn embed_sources(state: State<'_, AppState>, project: String, ids: Vec<String>) -> AppResult<Vec<relink::EmbedSource>> {
    state.with_index(&project, false, |library, idx| relink::embed_sources(library, &project, idx, &ids))
}

#[tauri::command(async)]
fn link_count(state: State<'_, AppState>, project: String, name: String) -> AppResult<LinkCount> {
    state.with_index(&project, false, |_, idx| Ok(relink::link_count(idx, &name)))
}

#[tauri::command(async)]
fn create_group(
    state: State<'_, AppState>,
    project: String,
    parent: String,
    name: String,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    state.with_index(&project, false, |library, idx| {
        let info = groups::create_group(library, &project, &parent, &name, allow_long)?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn rename_group(
    state: State<'_, AppState>,
    project: String,
    id: String,
    name: String,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    state.with_index(&project, false, |library, idx| {
        let info = groups::rename_group(library, &project, &id, &name, allow_long)?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn move_group(
    state: State<'_, AppState>,
    project: String,
    id: String,
    target: String,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    state.with_index(&project, false, |library, idx| {
        let info = groups::move_group(library, &project, &id, &target, allow_long)?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn delete_group(state: State<'_, AppState>, project: String, id: String) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        groups::delete_group(library, &project, &id)?;
        idx.refresh(&[])
    })
}

// ---- sync safety (M10) ----

/// Starts watching the project (and the library's `_themes/`) for changes from outside.
#[tauri::command]
fn watch_project(app: tauri::AppHandle, state: State<AppState>, project: String) -> AppResult<()> {
    let library = state.library()?;
    let dir = projects::project_dir(&library, &project)?;
    let mut guard = state.watch.lock().unwrap();
    *guard = None;
    let w = watcher::start(app.clone(), project, dir, library.join(themes::APP_THEMES_DIR))
        .map_err(|e| AppError::Invalid(format!("Can't watch the project folder for changes: {e}")))?;
    *guard = Some(w);
    Ok(())
}

#[tauri::command]
fn unwatch_project(state: State<AppState>) {
    *state.watch.lock().unwrap() = None;
}

/// Other computers that have the project open right now.
#[tauri::command]
fn open_elsewhere(state: State<AppState>, project: String) -> AppResult<Vec<markers::Marker>> {
    let dir = projects::project_dir(&state.library()?, &project)?;
    Ok(markers::others(&dir, &settings::machine_id(&state.config_dir), markers::now_ms()))
}

/// Marks the project as open on this computer (and refreshes the mark).
#[tauri::command]
fn mark_open(state: State<AppState>, project: String) -> AppResult<()> {
    let dir = projects::project_dir(&state.library()?, &project)?;
    markers::mark_open(&dir, &settings::machine_id(&state.config_dir), &markers::computer_name(), markers::now_ms())?;
    *state.marked.lock().unwrap() = Some(dir);
    Ok(())
}

#[tauri::command]
fn mark_closed(state: State<AppState>, project: String) -> AppResult<()> {
    let dir = projects::project_dir(&state.library()?, &project)?;
    markers::mark_closed(&dir, &settings::machine_id(&state.config_dir));
    *state.marked.lock().unwrap() = None;
    Ok(())
}

/// The window saved everything after "exit-requested": quit now.
#[tauri::command]
fn exit_app(app: tauri::AppHandle, state: State<AppState>) {
    state.may_exit.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// Has the open page's file changed (or gone) since `version` was loaded?
#[tauri::command]
fn page_disk_state(state: State<AppState>, project: String, id: String, version: String) -> AppResult<pages::DiskState> {
    pages::disk_state(&state.library()?, &project, &id, &version)
}

/// "Keep mine" for a page changed on disk: theirs to the Trash, mine written. Returns the new version.
#[tauri::command(async)]
fn keep_mine(state: State<'_, AppState>, project: String, id: String, mine: pages::Mine) -> AppResult<String> {
    state.with_index(&project, false, |library, idx| {
        let v = pages::keep_mine(library, &project, &id, &mine)?;
        idx.reload_page(&id);
        Ok(v)
    })
}

/// "Use the other version": mine to the Trash (as a file), the one on disk stays.
#[tauri::command]
fn trash_mine(state: State<AppState>, project: String, id: String, title: String, mine: pages::Mine) -> AppResult<()> {
    pages::trash_mine(&state.library()?, &project, &id, &title, &mine)
}

/// A version not kept (e.g. category text changed on disk while edited) goes to the Trash as a file.
#[tauri::command]
fn trash_text(state: State<AppState>, project: String, name: String, text: String) -> AppResult<()> {
    pages::trash_as_file(&projects::project_dir(&state.library()?, &project)?, &name, &text)
}

/// "Keep it" for a page deleted on disk while open. Returns the new version.
#[tauri::command(async)]
fn restore_page(state: State<'_, AppState>, project: String, id: String, page: pages::Restored) -> AppResult<String> {
    state.with_index(&project, false, |library, idx| {
        let v = pages::restore_page(library, &project, &id, &page)?;
        idx.refresh(&[])?;
        Ok(v)
    })
}

/// Conflict copies waiting to be resolved.
#[tauri::command(async)]
fn conflicts(state: State<'_, AppState>, project: String) -> AppResult<Vec<conflicts::Conflict>> {
    state.with_index(&project, true, |library, idx| Ok(conflicts::list(library, idx)))
}

/// One file of a conflict pair (`path` relative to the library), to show the differences.
#[tauri::command]
fn conflict_side(state: State<AppState>, kind: conflicts::Kind, path: String) -> AppResult<conflicts::Side> {
    conflicts::side(&state.library()?, kind, &path)
}

#[tauri::command(async)]
fn resolve_conflict(
    state: State<'_, AppState>,
    project: String,
    conflict: conflicts::Conflict,
    keep: conflicts::Keep,
) -> AppResult<()> {
    state.with_index(&project, true, |library, idx| conflicts::resolve(library, idx, &conflict, keep))
}

// ---- search (M10) ----

/// Reads every file into the search index ahead of the first search.
#[tauri::command(async)]
fn search_prepare(state: State<'_, AppState>, project: String) -> AppResult<()> {
    state.with_search(&project, |_, _| ())
}

#[tauri::command(async)]
fn search(state: State<'_, AppState>, project: String, request: search::Request) -> AppResult<search::Results> {
    state.with_search(&project, |s, sources| s.search(sources, &request))
}

// ---- categories ----

/// Every page and line for the graph view (M11), unless the window has them already.
#[tauri::command(async)]
fn graph_data(state: State<'_, AppState>, project: String, known: Option<String>) -> AppResult<graph::GraphReply> {
    state.with_index(&project, false, |_, idx| Ok(graph::reply(idx, known.as_deref())))
}

/// Every family relation (M12), or only the fingerprint when `known` is still current.
#[tauri::command(async)]
fn family_data(state: State<'_, AppState>, project: String, known: Option<String>) -> AppResult<family::FamilyReply> {
    state.with_index(&project, false, |_, idx| Ok(family::reply(idx, &family::FamilySettings::read(&idx.dir), known.as_deref())))
}

/// Names of the fields of these types that pages have (Family tree settings).
#[tauri::command(async)]
fn field_names(state: State<'_, AppState>, project: String, kinds: Vec<String>) -> AppResult<Vec<String>> {
    state.with_index(&project, false, |_, idx| Ok(family::field_names(idx, &kinds)))
}

/// Where the graph's nodes were left on this computer (none yet: null).
#[tauri::command]
fn graph_layout(state: State<AppState>, project: String) -> AppResult<Option<serde_json::Value>> {
    Ok(graph::layout(&projects::project_dir(&state.library()?, &project)?))
}

#[tauri::command]
fn save_graph_layout(state: State<AppState>, project: String, layout: serde_json::Value) -> AppResult<()> {
    graph::save_layout(&projects::project_dir(&state.library()?, &project)?, &layout)
}

#[tauri::command(async)]
fn list_categories(state: State<'_, AppState>, project: String) -> AppResult<Vec<categories::CategoryInfo>> {
    state.with_index(&project, true, |_, idx| categories::list(idx))
}

#[tauri::command(async)]
fn category_page(state: State<'_, AppState>, project: String, name: String, include_sub: bool) -> AppResult<categories::CategoryPage> {
    state.with_index(&project, true, |_, idx| categories::page(idx, &name, include_sub))
}

#[tauri::command(async)]
fn set_page_categories(state: State<'_, AppState>, project: String, id: String, categories: Vec<String>) -> AppResult<Vec<String>> {
    state.with_index(&project, false, |library, idx| categories::set_page_categories(library, &project, idx, &id, &categories))
}

#[tauri::command(async)]
fn set_page_sort(state: State<'_, AppState>, project: String, id: String, sort: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| categories::set_page_sort(library, &project, idx, &id, sort.as_deref()))
}

#[tauri::command(async)]
fn create_category(state: State<'_, AppState>, project: String, name: String) -> AppResult<String> {
    state.with_index(&project, true, |_, idx| categories::create(idx, &name))
}

#[tauri::command(async)]
fn save_category_text(state: State<'_, AppState>, project: String, name: String, text: String, version: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |_, idx| categories::save_text(idx, &name, &text, version.as_deref()))
}

#[tauri::command(async)]
fn set_category_parents(state: State<'_, AppState>, project: String, name: String, parents: Vec<String>) -> AppResult<Vec<String>> {
    state.with_index(&project, true, |_, idx| categories::set_parents(idx, &name, &parents))
}

/// Renames (`new_name`) or deletes (none) a category; `dry_run` only counts.
#[tauri::command(async)]
fn change_category(
    state: State<'_, AppState>,
    project: String,
    name: String,
    new_name: Option<String>,
    dry_run: bool,
) -> AppResult<categories::CategoryChange> {
    state.with_index(&project, true, |library, idx| {
        categories::rename_or_delete(library, &project, idx, &name, new_name.as_deref(), dry_run)
    })
}

#[tauri::command(async)]
fn category_backlinks(state: State<'_, AppState>, project: String, name: String, context: bool) -> AppResult<Vec<Backlink>> {
    state.with_index(&project, false, |library, idx| categories::backlinks(library, &project, idx, &name, context))
}

#[tauri::command(async)]
fn category_preview(state: State<'_, AppState>, project: String, name: String) -> AppResult<categories::CategoryPreview> {
    state.with_index(&project, false, |_, idx| categories::preview(idx, &name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Images in a project's assets/ folder: wikiasset://localhost/<project>%2F<file>
        // (http://wikiasset.localhost/… on Windows). "?w=640" asks for a copy
        // about that wide (made once, kept in .cache/). Answered off the main
        // thread, since shrinking a big image takes a moment.
        .register_asynchronous_uri_scheme_protocol("wikiasset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let state = app.state::<AppState>();
                let found = state.library().and_then(|lib| assets::resolve_url_path(&lib, request.uri().path()));
                let width = assets::query_width(request.uri().query());
                let file = found.map(|(dir, path)| match width {
                    Some(w) => assets::display_file(&dir, &path, w),
                    None => path,
                });
                let response = match file.and_then(|path| Ok((std::fs::read(&path)?, path))) {
                    Ok((data, path)) => tauri::http::Response::builder()
                        .header("Content-Type", assets::mime_type(&path.to_string_lossy()))
                        .header("Cache-Control", "no-cache")
                        // SVGs are pictures only: nothing inside them runs.
                        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
                        .body(data),
                    Err(_) => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(response.unwrap_or_else(|_| tauri::http::Response::new(Vec::new())));
            });
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings = settings::load(&config_dir);
            edits::init(&settings::machine_id(&config_dir), &markers::computer_name(), &config_dir);
            projects::set_cache_root(app.path().app_cache_dir()?.join("projects"));
            app.manage(AppState {
                config_dir,
                settings: Mutex::new(settings),
                installed_fonts: Mutex::new(None),
                index: Mutex::new(None),
                search: Mutex::new(None),
                watch: Mutex::new(None),
                marked: Mutex::new(None),
                may_exit: std::sync::atomic::AtomicBool::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_library_path,
            move_library,
            list_projects,
            create_project,
            rename_project,
            delete_project,
            get_tree,
            create_page,
            read_page,
            save_page,
            rename_page,
            move_page,
            delete_page,
            create_group,
            rename_group,
            move_group,
            delete_group,
            set_aliases,
            set_main_page,
            page_sections,
            link_preview,
            backlinks,
            link_count,
            embedded_in,
            embed_sources,
            save_infobox,
            get_templates,
            project_templates,
            set_templates,
            template_pages,
            apply_template,
            relations,
            relations_table,
            shown_on,
            set_relation,
            import_image,
            import_image_data,
            get_image_frame,
            get_project_settings,
            set_project_settings,
            set_image_frame,
            list_categories,
            category_page,
            set_page_categories,
            set_page_sort,
            create_category,
            save_category_text,
            set_category_parents,
            change_category,
            category_backlinks,
            category_preview,
            search_prepare,
            search,
            graph_data,
            family_data,
            field_names,
            save_image_file,
            graph_layout,
            save_graph_layout,
            watch_project,
            unwatch_project,
            open_elsewhere,
            mark_open,
            mark_closed,
            page_disk_state,
            keep_mine,
            trash_mine,
            trash_text,
            restore_page,
            exit_app,
            conflicts,
            conflict_side,
            resolve_conflict,
            theme_commands::list_themes,
            theme_commands::read_theme,
            theme_commands::create_theme,
            theme_commands::save_theme,
            theme_commands::rename_theme,
            theme_commands::delete_theme,
            theme_commands::get_app_theme,
            theme_commands::set_app_theme,
            theme_commands::get_page_edge,
            theme_commands::set_page_edge,
            theme_commands::import_font,
            theme_commands::installed_fonts,
            theme_commands::copy_installed_font,
            theme_commands::font_data,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| match event {
            // Quitting (⌘Q, the menu): let the window save unsaved edits first; it calls
            // exit_app when done. If it doesn't answer, quit anyway after a few seconds.
            tauri::RunEvent::ExitRequested { api, .. } => {
                let state = app.state::<AppState>();
                if !state.may_exit.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    use tauri::Emitter;
                    let _ = app.emit("exit-requested", ());
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(4));
                        handle.state::<AppState>().may_exit.store(true, std::sync::atomic::Ordering::SeqCst);
                        handle.exit(0);
                    });
                }
            }
            // This computer no longer has the project open.
            tauri::RunEvent::Exit => {
                let state = app.state::<AppState>();
                if let Some(dir) = state.marked.lock().unwrap().take() {
                    markers::mark_closed(&dir, &settings::machine_id(&state.config_dir));
                }
                state.forget_index();
            }
            _ => {}
        });
}
