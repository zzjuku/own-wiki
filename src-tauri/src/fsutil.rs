//! File-system helpers shared by projects, pages and settings.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};

const MAX_NAME_LEN: usize = 120;
const FORBIDDEN_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Writes `contents` to `path` without ever leaving a half-written file behind:
/// the data goes to a hidden temp file in the same folder, is flushed to disk,
/// and is then renamed over the target in one step.
pub fn safe_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?
        .to_string_lossy();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let unique = format!(
        "{}-{}-{}",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let tmp = dir.join(format!(".{file_name}.{unique}.tmp"));

    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Turns a user-typed name into a file or folder name that is valid on both
/// macOS and Windows. The result stays readable ("Page A" -> "Page A").
pub fn to_file_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("Name can't be empty.".into()));
    }
    let mut out: String = trimmed
        .chars()
        .map(|c| {
            if FORBIDDEN_CHARS.contains(&c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    // Leading dots would hide the file; trailing dots/spaces are invalid on Windows.
    out = out
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' '])
        .to_string();
    if out.chars().count() > MAX_NAME_LEN {
        out = out.chars().take(MAX_NAME_LEN).collect::<String>();
        out = out.trim_end_matches(['.', ' ']).to_string();
    }
    if out.is_empty() {
        return Err(AppError::Invalid(
            "Name needs at least one letter or number.".into(),
        ));
    }
    let stem = out.split('.').next().unwrap_or("").to_ascii_uppercase();
    if WINDOWS_RESERVED.contains(&stem.as_str()) {
        out.push('_');
    }
    Ok(out)
}

/// Rejects ids from the UI that could point outside their folder.
pub fn check_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.starts_with('.')
        || id.contains('/')
        || id.contains('\\')
        || id.contains('\0')
    {
        return Err(AppError::Invalid(format!("Invalid name: {id}")));
    }
    Ok(())
}

/// True if `dir` already has an entry named `name`, ignoring letter case.
/// Case is ignored so a project stays valid when synced between file systems
/// that treat case differently.
pub fn name_taken(dir: &Path, name: &str) -> io::Result<bool> {
    let wanted = name.to_lowercase();
    for entry in fs::read_dir(dir)? {
        if entry?.file_name().to_string_lossy().to_lowercase() == wanted {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Moves a file or folder to the system Trash / Recycle Bin.
#[cfg(not(test))]
pub fn move_to_trash(path: &Path) -> AppResult<()> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // The default Finder method needs an automation permission prompt.
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| AppError::Trash(e.to_string()))
}

/// Tests must not fill the real Trash, so they delete directly.
#[cfg(test)]
pub fn move_to_trash(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_write_creates_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        safe_write(&path, b"one").unwrap();
        safe_write(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        // No temp files left behind.
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn safe_write_fails_cleanly_without_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("a.txt");
        assert!(safe_write(&path, b"x").is_err());
    }

    #[test]
    fn file_names_are_portable() {
        assert_eq!(to_file_name("  Page A ").unwrap(), "Page A");
        assert_eq!(to_file_name("A/B: C?").unwrap(), "A-B- C-");
        assert_eq!(to_file_name("...hidden").unwrap(), "hidden");
        assert_eq!(to_file_name("trailing. ").unwrap(), "trailing");
        assert_eq!(to_file_name("con").unwrap(), "con_");
        assert_eq!(to_file_name("Ünïcödé 名前").unwrap(), "Ünïcödé 名前");
        assert!(to_file_name("   ").is_err());
        assert!(to_file_name("...").is_err());
        assert_eq!(to_file_name(&"x".repeat(300)).unwrap().len(), MAX_NAME_LEN);
    }

    #[test]
    fn ids_cannot_escape() {
        assert!(check_id("Page A.md").is_ok());
        for bad in ["", "..", ".hidden", "a/b", "a\\b"] {
            assert!(check_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn name_taken_ignores_case() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Page A.md"), "").unwrap();
        assert!(name_taken(dir.path(), "page a.md").unwrap());
        assert!(!name_taken(dir.path(), "Page B.md").unwrap());
    }
}
