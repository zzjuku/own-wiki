//! Themes (M8): one folder per theme, `theme.json` plus the font files it uses
//! in `fonts/`. App-wide themes live in the library folder (`_themes/`, so they
//! sync between computers), a project's own themes in its `themes/` folder.
//! The contents of `theme.json` belong to the UI (src/themes/); this side
//! keeps the folder, the name and any keys it doesn't know.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_id, move_to_trash, name_taken, safe_write, to_file_name};
use crate::wikilinks::norm;

/// App-wide themes inside the library folder. Not a project.
pub const APP_THEMES_DIR: &str = "_themes";
/// A project's own themes inside its folder.
pub const PROJECT_THEMES_DIR: &str = "themes";
const THEME_FILE: &str = "theme.json";
pub const FONTS_DIR: &str = "fonts";
/// Which app-wide theme is in use (in `_themes/`, so it syncs too).
const CHOICE_FILE: &str = "settings.json";
const FORMAT_VERSION: u64 = 1;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ThemeInfo {
    /// Folder name.
    pub id: String,
    pub name: String,
}

/// The folder of theme `id` inside the themes folder `dir`.
pub fn theme_dir(dir: &Path, id: &str) -> AppResult<PathBuf> {
    check_id(id)?;
    let path = dir.join(id);
    if !path.join(THEME_FILE).is_file() {
        return Err(AppError::NotFound(format!("Theme not found: {id}")));
    }
    Ok(path)
}

fn read_file(theme: &Path) -> AppResult<Map<String, Value>> {
    match serde_json::from_str(&fs::read_to_string(theme.join(THEME_FILE))?)? {
        Value::Object(map) => Ok(map),
        _ => Err(AppError::Invalid("The theme file is damaged.".into())),
    }
}

fn write_file(theme: &Path, map: &Map<String, Value>) -> AppResult<()> {
    let mut json = serde_json::to_string_pretty(map)?;
    json.push('\n');
    safe_write(&theme.join(THEME_FILE), json.as_bytes())?;
    Ok(())
}

/// The themes in `dir`, sorted by name. A missing folder has none; a theme
/// whose file can't be read still shows (under its folder name).
pub fn list(dir: &Path) -> AppResult<Vec<ThemeInfo>> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else { return Ok(out) };
    for entry in entries {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') || !entry.path().join(THEME_FILE).is_file() {
            continue;
        }
        let name = read_file(&entry.path())
            .ok()
            .and_then(|m| m.get("name").and_then(Value::as_str).map(str::to_string))
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| id.clone());
        out.push(ThemeInfo { id, name });
    }
    out.sort_by_key(|t| t.name.to_lowercase());
    Ok(out)
}

/// Key in [`read`]'s answer with theme.json's version; [`save`] checks and drops it.
const VERSION_KEY: &str = "_version";

pub fn read(dir: &Path, id: &str) -> AppResult<Value> {
    let theme = theme_dir(dir, id)?;
    let mut map = read_file(&theme)?;
    map.entry("name").or_insert_with(|| Value::String(id.to_string()));
    if let Some(v) = crate::fsutil::file_version(&theme.join(THEME_FILE)) {
        map.insert(VERSION_KEY.into(), Value::String(v));
    }
    Ok(Value::Object(map))
}

fn as_object(data: Value) -> AppResult<Map<String, Value>> {
    match data {
        Value::Object(map) => Ok(map),
        _ => Err(AppError::Invalid("Invalid theme data.".into())),
    }
}

fn check_name_free(dir: &Path, name: &str, except: Option<&str>) -> AppResult<String> {
    let name = name.trim();
    let id = to_file_name(name)?;
    let clash = list(dir)?
        .into_iter()
        .any(|t| Some(t.id.as_str()) != except && (norm(&t.name) == norm(name) || t.id.to_lowercase() == id.to_lowercase()));
    let folder_clash = except.is_none_or(|e| e.to_lowercase() != id.to_lowercase()) && dir.is_dir() && name_taken(dir, &id)?;
    if clash || folder_clash {
        return Err(AppError::Exists(format!("A theme named \"{name}\" already exists here.")));
    }
    Ok(id)
}

/// A font that comes with the app, for a copy of a built-in theme.
#[derive(Debug, Deserialize)]
pub struct BundledFont {
    pub family: String,
    pub file: String,
}

/// Creates theme `name` in `dir` with `data` (the theme's settings). With
/// `fonts_from`, the font files of that theme folder are copied along;
/// `bundled` fonts (a built-in theme's) are written from the app and added
/// to the theme's font list. Nothing is left behind if any of it fails.
pub fn create(dir: &Path, name: &str, data: Value, fonts_from: Option<&Path>, bundled: &[BundledFont]) -> AppResult<ThemeInfo> {
    let id = check_name_free(dir, name, None)?;
    let name = name.trim().to_string();
    let mut map = as_object(data)?;
    map.remove(VERSION_KEY);
    map.insert("name".into(), Value::String(name.clone()));
    map.insert("formatVersion".into(), FORMAT_VERSION.into());
    let theme = dir.join(&id);
    fs::create_dir_all(&theme)?;
    let result = (|| {
        if let Some(src) = fonts_from.map(|f| f.join(FONTS_DIR)).filter(|f| f.is_dir()) {
            let dst = theme.join(FONTS_DIR);
            fs::create_dir_all(&dst)?;
            for entry in fs::read_dir(src)? {
                let entry = entry?;
                if entry.file_type()?.is_file() && !entry.file_name().to_string_lossy().starts_with('.') {
                    fs::copy(entry.path(), dst.join(entry.file_name()))?;
                }
            }
        }
        for b in bundled {
            let data = crate::fonts::bundled(&b.file)
                .ok_or_else(|| AppError::NotFound(format!("The font file \"{}\" doesn't come with this app version.", b.file)))?;
            let f = crate::fonts::import_data(&theme, Path::new(&b.file), data)?;
            let entry = serde_json::json!({ "family": b.family, "file": f.file, "weight": f.weight, "style": f.style });
            match map.entry("fonts").or_insert_with(|| Value::Array(Vec::new())) {
                Value::Array(list) => list.push(entry),
                other => *other = Value::Array(vec![entry]),
            }
        }
        write_file(&theme, &map)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&theme);
    }
    result?;
    Ok(ThemeInfo { id, name })
}

/// Saves the theme's settings. The name stays (renaming is [`rename`]); keys
/// the UI doesn't send are kept.
pub fn save(dir: &Path, id: &str, data: Value) -> AppResult<()> {
    let theme = theme_dir(dir, id)?;
    let mut data = as_object(data)?;
    let version = data.remove(VERSION_KEY);
    crate::fsutil::check_version(&theme.join(THEME_FILE), version.as_ref().and_then(Value::as_str))?;
    let mut map = read_file(&theme).unwrap_or_default();
    let name = map.get("name").cloned().unwrap_or_else(|| Value::String(id.to_string()));
    for (k, v) in data {
        map.insert(k, v);
    }
    map.insert("name".into(), name);
    map.insert("formatVersion".into(), FORMAT_VERSION.into());
    write_file(&theme, &map)
}

/// Renames the theme and its folder.
pub fn rename(dir: &Path, id: &str, name: &str) -> AppResult<ThemeInfo> {
    let theme = theme_dir(dir, id)?;
    let new_id = check_name_free(dir, name, Some(id))?;
    let mut map = read_file(&theme)?;
    map.insert("name".into(), Value::String(name.trim().to_string()));
    write_file(&theme, &map)?;
    if new_id != id {
        crate::fsutil::rename(&theme, dir.join(&new_id))?;
    }
    Ok(ThemeInfo { id: new_id, name: name.trim().to_string() })
}

/// Moves the theme folder (with its fonts) to the Trash.
pub fn delete(dir: &Path, id: &str) -> AppResult<()> {
    move_to_trash(&theme_dir(dir, id)?)
}

/// The library-wide look settings (`_themes/settings.json`, synced): the
/// app theme in use (`active`) and where the page's right edge was dragged
/// to (`pageEdge`). Unknown keys are kept.
fn library_settings(library: &Path) -> Map<String, Value> {
    fs::read_to_string(library.join(APP_THEMES_DIR).join(CHOICE_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn set_library_setting(library: &Path, key: &str, value: Option<Value>) -> AppResult<()> {
    let dir = library.join(APP_THEMES_DIR);
    fs::create_dir_all(&dir)?;
    let mut map = library_settings(library);
    match value {
        Some(v) => map.insert(key.into(), v),
        None => map.remove(key),
    };
    let mut json = serde_json::to_string_pretty(&map)?;
    json.push('\n');
    safe_write(&dir.join(CHOICE_FILE), json.as_bytes())?;
    Ok(())
}

/// The app-wide theme in use ("builtin:default", "app:<folder>"), if chosen.
pub fn app_choice(library: &Path) -> Option<String> {
    library_settings(library).get("active").and_then(Value::as_str).map(str::to_string)
}

pub fn set_app_choice(library: &Path, choice: Option<&str>) -> AppResult<()> {
    set_library_setting(library, "active", choice.map(|c| Value::String(c.into())))
}

/// Where the page's right edge was dragged to, as a share of the window's
/// width (0–1), the same on every computer; None = the theme's page width.
pub fn page_edge(library: &Path) -> Option<f64> {
    library_settings(library).get("pageEdge").and_then(Value::as_f64).filter(|e| (0.0..=1.0).contains(e))
}

pub fn set_page_edge(library: &Path, edge: Option<f64>) -> AppResult<()> {
    let edge = edge.filter(|e| e.is_finite()).map(|e| e.clamp(0.0, 1.0));
    set_library_setting(library, "pageEdge", edge.and_then(serde_json::Number::from_f64).map(Value::Number))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn page_edge_lives_next_to_the_app_theme() {
        let lib = tempfile::tempdir().unwrap();
        set_app_choice(lib.path(), Some("app:Theme A")).unwrap();
        set_page_edge(lib.path(), Some(0.75)).unwrap();
        assert_eq!((app_choice(lib.path()).as_deref(), page_edge(lib.path())), (Some("app:Theme A"), Some(0.75)));
        set_page_edge(lib.path(), None).unwrap();
        assert_eq!((app_choice(lib.path()).as_deref(), page_edge(lib.path())), (Some("app:Theme A"), None));
    }

    #[test]
    fn copy_of_builtin_theme_writes_bundled_fonts() {
        let lib = tempfile::tempdir().unwrap();
        let dir = lib.path().join(APP_THEMES_DIR);
        let fonts = [BundledFont { family: "Marcellus".into(), file: "Marcellus-Regular.ttf".into() }];
        let t = create(&dir, "Theme A", json!({ "vars": {}, "fonts": [] }), None, &fonts).unwrap();
        let data = read(&dir, &t.id).unwrap();
        assert_eq!(data["fonts"][0]["family"], "Marcellus");
        assert_eq!(data["fonts"][0]["file"], "Marcellus-Regular.ttf");
        assert!(dir.join("Theme A/fonts/Marcellus-Regular.ttf").is_file());
        // An unknown font: the half-made theme is removed again.
        let bad = [BundledFont { family: "X".into(), file: "Missing.ttf".into() }];
        assert!(create(&dir, "Theme B", json!({}), None, &bad).is_err());
        assert!(!dir.join("Theme B").exists());
    }

    #[test]
    fn create_list_read_save_rename_delete() {
        let lib = tempfile::tempdir().unwrap();
        let dir = lib.path().join(APP_THEMES_DIR);
        assert!(list(&dir).unwrap().is_empty());

        let t = create(&dir, " Theme A ", json!({ "vars": { "--bg": "#000000" } }), None, &[]).unwrap();
        assert_eq!(t, ThemeInfo { id: "Theme A".into(), name: "Theme A".into() });
        create(&dir, "Theme B", json!({}), None, &[]).unwrap();
        assert!(matches!(create(&dir, "theme a", json!({}), None, &[]), Err(AppError::Exists(_))));
        let names: Vec<_> = list(&dir).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(names, ["Theme A", "Theme B"]);

        // Unknown keys survive a save; the name can't be changed by saving.
        let mut file = read(&dir, "Theme A").unwrap();
        file["future"] = json!(1);
        save(&dir, "Theme A", file).unwrap();
        save(&dir, "Theme A", json!({ "name": "Other", "vars": { "--bg": "#111111" } })).unwrap();
        let read_back = read(&dir, "Theme A").unwrap();
        assert_eq!(read_back["name"], "Theme A");
        assert_eq!(read_back["future"], 1);
        assert_eq!(read_back["vars"]["--bg"], "#111111");
        assert_eq!(read_back["formatVersion"], 1);

        assert!(matches!(rename(&dir, "Theme A", "Theme B"), Err(AppError::Exists(_))));
        let r = rename(&dir, "Theme A", "Theme C").unwrap();
        assert_eq!(r.id, "Theme C");
        assert!(dir.join("Theme C/theme.json").is_file() && !dir.join("Theme A").exists());
        // Only the letter case changes: same folder.
        rename(&dir, "Theme C", "theme c").unwrap();
        assert_eq!(read(&dir, "Theme C").unwrap()["name"], "theme c");

        delete(&dir, "Theme B").unwrap();
        assert_eq!(list(&dir).unwrap().len(), 1);
        assert!(read(&dir, "../x").is_err());
    }

    #[test]
    fn copy_takes_fonts_along() {
        let lib = tempfile::tempdir().unwrap();
        let dir = lib.path().join(APP_THEMES_DIR);
        create(&dir, "Theme A", json!({}), None, &[]).unwrap();
        fs::create_dir_all(dir.join("Theme A/fonts")).unwrap();
        fs::write(dir.join("Theme A/fonts/Font A.ttf"), b"font").unwrap();
        let project_themes = lib.path().join("Project A").join(PROJECT_THEMES_DIR);
        create(&project_themes, "Theme A", json!({}), Some(&dir.join("Theme A")), &[]).unwrap();
        assert_eq!(fs::read(project_themes.join("Theme A/fonts/Font A.ttf")).unwrap(), b"font");
    }

    #[test]
    fn app_choice_round_trip() {
        let lib = tempfile::tempdir().unwrap();
        assert_eq!(app_choice(lib.path()), None);
        set_app_choice(lib.path(), Some("app:Theme A")).unwrap();
        assert_eq!(app_choice(lib.path()).as_deref(), Some("app:Theme A"));
        set_app_choice(lib.path(), None).unwrap();
        assert_eq!(app_choice(lib.path()), None);
        // The themes folder is not a project.
        assert!(crate::projects::list_projects(lib.path()).unwrap().is_empty());
    }
}
