mod error;
mod fsutil;
mod groups;
mod index;
mod pages;
mod projects;
mod relink;
mod settings;
mod tree;
mod wikilinks;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};

use error::{AppError, AppResult};
use index::ProjectIndex;
use pages::Page;
use projects::ProjectInfo;
use relink::{Backlink, LinkCount, Preview, RenameResult};
use settings::Settings;
use tree::{GroupInfo, PageInfo, Tree};
use wikilinks::{Heading, norm};

struct AppState {
    config_dir: PathBuf,
    settings: Mutex<Settings>,
    /// Link index of the open project (one at a time).
    index: Mutex<Option<ProjectIndex>>,
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
            _ => *guard = Some(ProjectIndex::open(&dir)?),
        }
        f(&library, guard.as_mut().unwrap())
    }

    fn forget_index(&self) {
        if let Some(mut idx) = self.index.lock().unwrap().take() {
            idx.save_cache(true);
        }
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
    state.with_index(&project, true, |_, idx| {
        Ok(Tree { groups: idx.groups.clone(), pages: idx.page_infos(), main_page: projects::main_page(&idx.dir) })
    })
}

#[tauri::command(async)]
fn create_page(
    state: State<'_, AppState>,
    project: String,
    group: String,
    title: String,
    allow_long: bool,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let info = pages::create_page(library, &project, &group, &title, allow_long, &idx.page_infos())?;
        idx.refresh(&[&info.id])?;
        Ok(info)
    })
}

#[tauri::command]
fn read_page(state: State<AppState>, project: String, id: String) -> AppResult<Page> {
    pages::read_page(&state.library()?, &project, &id)
}

#[tauri::command(async)]
fn save_page(state: State<'_, AppState>, project: String, id: String, body: String) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        pages::save_page(library, &project, &id, &body)?;
        idx.reload_page(&id);
        Ok(())
    })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings = settings::load(&config_dir);
            app.manage(AppState {
                config_dir,
                settings: Mutex::new(settings),
                index: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_library_path,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
