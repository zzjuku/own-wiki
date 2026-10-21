//! Per-machine app settings, stored in the OS app-config folder — never in
//! the (synced) library, because library paths differ between Mac and Windows.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::fsutil::safe_write;

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub library_path: Option<String>,
}

pub fn load(config_dir: &Path) -> Settings {
    fs::read_to_string(config_dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(config_dir: &Path, settings: &Settings) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    let mut json = serde_json::to_string_pretty(settings)?;
    json.push('\n');
    safe_write(&config_dir.join(SETTINGS_FILE), json.as_bytes())?;
    Ok(())
}

/// A random id for this computer (its "open on another computer" marker),
/// made once and kept in the app-config folder.
pub fn machine_id(config_dir: &Path) -> String {
    let file = config_dir.join("machine-id");
    if let Some(id) = fs::read_to_string(&file).ok().map(|t| t.trim().to_string()).filter(|t| t.len() >= 8) {
        return id;
    }
    let seed = format!("{:?}-{}-{:?}", std::time::SystemTime::now(), std::process::id(), config_dir);
    let id = crate::fsutil::version_of(seed.as_bytes());
    let _ = fs::create_dir_all(config_dir);
    let _ = safe_write(&file, id.as_bytes());
    id
}

/// The library folder, if one is set and currently reachable.
pub fn library_dir(settings: &Settings) -> AppResult<PathBuf> {
    let path = settings
        .library_path
        .as_deref()
        .ok_or_else(|| AppError::NotFound("No library folder chosen yet.".into()))?;
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err(AppError::NotFound(format!(
            "Library folder not found: {}",
            path.display()
        )));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        assert_eq!(load(&config), Settings::default());
        let s = Settings { library_path: Some("/x/y".into()) };
        save(&config, &s).unwrap();
        assert_eq!(load(&config), s);
        let text = fs::read_to_string(config.join(SETTINGS_FILE)).unwrap();
        assert!(text.contains("\"libraryPath\""));
    }

    #[test]
    fn library_must_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(library_dir(&Settings::default()).is_err());
        let missing = Settings { library_path: Some(dir.path().join("nope").display().to_string()) };
        assert!(library_dir(&missing).is_err());
        let ok = Settings { library_path: Some(dir.path().display().to_string()) };
        assert_eq!(library_dir(&ok).unwrap(), dir.path());
    }
}
