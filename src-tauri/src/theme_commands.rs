//! Theme and font commands (M8): app-wide and project themes, their fonts,
//! the chosen theme and the page edge kept with them.

use std::path::PathBuf;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::{fonts, projects, themes, AppState};

impl AppState {
    /// The themes folder: the library's `_themes/` (`project` = None) or the project's `themes/`.
    fn themes_dir(&self, project: Option<&str>) -> AppResult<PathBuf> {
        let library = self.library()?;
        Ok(match project {
            None => library.join(themes::APP_THEMES_DIR),
            Some(p) => projects::project_dir(&library, p)?.join(themes::PROJECT_THEMES_DIR),
        })
    }

    fn theme_dir(&self, project: Option<&str>, id: &str) -> AppResult<PathBuf> {
        themes::theme_dir(&self.themes_dir(project)?, id)
    }
}

/// A stored theme: app-wide (`project` = None) or a project's own.
#[derive(serde::Deserialize)]
pub(crate) struct ThemeSource {
    project: Option<String>,
    id: String,
}

#[tauri::command]
pub(crate) fn list_themes(state: State<AppState>, project: Option<String>) -> AppResult<Vec<themes::ThemeInfo>> {
    themes::list(&state.themes_dir(project.as_deref())?)
}

#[tauri::command]
pub(crate) fn read_theme(state: State<AppState>, project: Option<String>, id: String) -> AppResult<serde_json::Value> {
    themes::read(&state.themes_dir(project.as_deref())?, &id)
}

/// `from`: the stored theme being copied, whose font files come along;
/// `bundled`: fonts that come with the app (copying a built-in theme).
#[tauri::command]
pub(crate) fn create_theme(
    state: State<AppState>,
    project: Option<String>,
    name: String,
    data: serde_json::Value,
    from: Option<ThemeSource>,
    bundled: Option<Vec<themes::BundledFont>>,
) -> AppResult<themes::ThemeInfo> {
    let fonts_from = from.map(|f| state.theme_dir(f.project.as_deref(), &f.id)).transpose()?;
    themes::create(&state.themes_dir(project.as_deref())?, &name, data, fonts_from.as_deref(), &bundled.unwrap_or_default())
}

#[tauri::command]
pub(crate) fn save_theme(state: State<AppState>, project: Option<String>, id: String, data: serde_json::Value) -> AppResult<()> {
    themes::save(&state.themes_dir(project.as_deref())?, &id, data)
}

#[tauri::command]
pub(crate) fn rename_theme(state: State<AppState>, project: Option<String>, id: String, name: String) -> AppResult<themes::ThemeInfo> {
    themes::rename(&state.themes_dir(project.as_deref())?, &id, &name)
}

#[tauri::command]
pub(crate) fn delete_theme(state: State<AppState>, project: Option<String>, id: String) -> AppResult<()> {
    themes::delete(&state.themes_dir(project.as_deref())?, &id)
}

/// The app-wide theme in use ("builtin:default", "app:<folder>"); None = Default.
#[tauri::command]
pub(crate) fn get_app_theme(state: State<AppState>) -> AppResult<Option<String>> {
    Ok(themes::app_choice(&state.library()?))
}

#[tauri::command]
pub(crate) fn set_app_theme(state: State<AppState>, choice: Option<String>) -> AppResult<()> {
    themes::set_app_choice(&state.library()?, choice.as_deref())
}

/// The dragged page edge as a share of the window width (synced in the library).
#[tauri::command]
pub(crate) fn get_page_edge(state: State<AppState>) -> AppResult<Option<f64>> {
    Ok(themes::page_edge(&state.library()?))
}

#[tauri::command]
pub(crate) fn set_page_edge(state: State<AppState>, edge: Option<f64>) -> AppResult<()> {
    themes::set_page_edge(&state.library()?, edge)
}

#[tauri::command]
pub(crate) fn import_font(state: State<AppState>, project: Option<String>, id: String, path: String) -> AppResult<fonts::FontFile> {
    fonts::import(&state.theme_dir(project.as_deref(), &id)?, std::path::Path::new(&path))
}

/// Family names of the fonts installed on this computer (read once, off the main thread).
#[tauri::command]
pub(crate) async fn installed_fonts(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let mut cache = state.installed_fonts.lock().unwrap();
    let families = cache.get_or_insert_with(fonts::installed);
    Ok(families.keys().cloned().collect())
}

#[tauri::command]
pub(crate) async fn copy_installed_font(
    state: State<'_, AppState>,
    project: Option<String>,
    id: String,
    family: String,
) -> AppResult<Vec<fonts::FontFile>> {
    let theme = state.theme_dir(project.as_deref(), &id)?;
    let faces = {
        let mut cache = state.installed_fonts.lock().unwrap();
        cache.get_or_insert_with(fonts::installed).get(&family).cloned()
    };
    let faces = faces.ok_or_else(|| AppError::NotFound(format!("The font \"{family}\" isn't installed on this computer.")))?;
    fonts::copy_installed(&theme, &faces)
}

/// A theme's font file, as raw bytes.
#[tauri::command]
pub(crate) fn font_data(state: State<AppState>, project: Option<String>, id: String, file: String) -> AppResult<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(fonts::read(&state.theme_dir(project.as_deref(), &id)?, &file)?))
}

