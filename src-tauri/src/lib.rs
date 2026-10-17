mod error;
mod fsutil;
mod pages;
mod projects;
mod settings;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};

use error::{AppError, AppResult};
use pages::{Page, PageInfo};
use projects::ProjectInfo;
use settings::Settings;

struct AppState {
    config_dir: PathBuf,
    settings: Mutex<Settings>,
}

impl AppState {
    fn library(&self) -> AppResult<PathBuf> {
        settings::library_dir(&self.settings.lock().unwrap())
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
    projects::rename_project(&state.library()?, &id, &name)
}

#[tauri::command]
fn delete_project(state: State<AppState>, id: String) -> AppResult<()> {
    projects::delete_project(&state.library()?, &id)
}

#[tauri::command]
fn list_pages(state: State<AppState>, project: String) -> AppResult<Vec<PageInfo>> {
    pages::list_pages(&state.library()?, &project)
}

#[tauri::command]
fn create_page(state: State<AppState>, project: String, title: String) -> AppResult<PageInfo> {
    pages::create_page(&state.library()?, &project, &title)
}

#[tauri::command]
fn read_page(state: State<AppState>, project: String, id: String) -> AppResult<Page> {
    pages::read_page(&state.library()?, &project, &id)
}

#[tauri::command]
fn save_page(state: State<AppState>, project: String, id: String, body: String) -> AppResult<()> {
    pages::save_page(&state.library()?, &project, &id, &body)
}

#[tauri::command]
fn rename_page(
    state: State<AppState>,
    project: String,
    id: String,
    title: String,
) -> AppResult<PageInfo> {
    pages::rename_page(&state.library()?, &project, &id, &title)
}

#[tauri::command]
fn delete_page(state: State<AppState>, project: String, id: String) -> AppResult<()> {
    pages::delete_page(&state.library()?, &project, &id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings = settings::load(&config_dir);
            app.manage(AppState {
                config_dir,
                settings: Mutex::new(settings),
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
            list_pages,
            create_page,
            read_page,
            save_page,
            rename_page,
            delete_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
