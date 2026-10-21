//! File-system helpers shared by projects, pages and settings.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    } else {
        own_writes().insert(own_key(path), version_of(contents));
    }
    result
}

// ---- versions and the app's own writes (M10) ----
//
// A file's version is a hash of its bytes. Saves from the UI send the version
// they loaded; a file that changed on disk since then (another computer, via
// Drive) is not overwritten. The app remembers what it wrote last to each
// file, so its own saves (text and infobox save separately) never count as
// outside changes, and the file watcher can ignore them.

/// A version for these bytes (FNV-1a, 64 bit, as hex).
pub fn version_of(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// The file's version now (None if it can't be read).
pub fn file_version(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| version_of(&b))
}

fn own_writes() -> std::sync::MutexGuard<'static, HashMap<PathBuf, String>> {
    static OWN: std::sync::LazyLock<Mutex<HashMap<PathBuf, String>>> = std::sync::LazyLock::new(Default::default);
    // A poisoned lock only means a panic elsewhere; the map is still usable.
    OWN.lock().unwrap_or_else(|e| e.into_inner())
}

/// Paths the app itself renamed, moved, created or put in the Trash just now.
fn own_recent() -> std::sync::MutexGuard<'static, Vec<(PathBuf, Instant)>> {
    static RECENT: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());
    RECENT.lock().unwrap_or_else(|e| e.into_inner())
}

/// How long a rename, move or delete by the app counts as its own for the watcher.
const OWN_WINDOW: Duration = Duration::from_secs(5);

/// The same file always gets the same key (folder resolved, so symlinks and
/// the watcher's paths agree).
pub fn own_key(path: &Path) -> PathBuf {
    match (path.parent().and_then(|p| p.canonicalize().ok()), path.file_name()) {
        (Some(dir), Some(name)) => dir.join(name),
        _ => path.to_path_buf(),
    }
}

/// What the app last wrote to this file.
pub fn own_version(path: &Path) -> Option<String> {
    own_writes().get(&own_key(path)).cloned()
}

/// The app is about to rename, move, create or delete `path` (and what's in it).
pub fn note_own_change(path: &Path) {
    let mut recent = own_recent();
    recent.retain(|(_, at)| at.elapsed() < OWN_WINDOW);
    recent.push((own_key(path), Instant::now()));
}

/// Did the app itself change this file (by content), or rename, move or delete it (or a folder around it) just now?
pub fn is_own_change(path: &Path) -> bool {
    let key = own_key(path);
    if own_recent().iter().any(|(p, at)| at.elapsed() < OWN_WINDOW && key.starts_with(p)) {
        return true;
    }
    match (own_writes().get(&key), file_version(path)) {
        (Some(own), Some(now)) => *own == now,
        _ => false,
    }
}

/// Refuses to overwrite a file that changed on disk since the app loaded
/// version `expected` (None: no check). The app's own last write counts as unchanged.
pub fn check_version(path: &Path, expected: Option<&str>) -> AppResult<()> {
    let Some(expected) = expected else { return Ok(()) };
    match file_version(path) {
        None => Err(AppError::Changed("This was deleted on another computer (or by another program).".into())),
        Some(now) if now == expected || own_version(path).as_deref() == Some(now.as_str()) => Ok(()),
        Some(_) => Err(AppError::Changed("This was changed on another computer (or by another program) since it was opened.".into())),
    }
}

/// `fs::rename`, noted as the app's own change.
pub fn rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
    let (from, to) = (from.as_ref(), to.as_ref());
    note_own_change(from);
    note_own_change(to);
    fs::rename(from, to)
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

/// Rejects relative paths from the UI ("Group A/Page A.md") that could point
/// outside their folder. Parts are separated by `/` on every platform.
pub fn check_rel(rel: &str) -> AppResult<()> {
    if rel.is_empty() {
        return Err(AppError::Invalid("Invalid name: (empty)".into()));
    }
    for part in rel.split('/') {
        check_id(part).map_err(|_| AppError::Invalid(format!("Invalid name: {rel}")))?;
    }
    Ok(())
}

/// Joins a relative `/`-separated path onto `base`. `rel` may be empty.
pub fn join_rel(base: &Path, rel: &str) -> PathBuf {
    let mut out = base.to_path_buf();
    for part in rel.split('/').filter(|p| !p.is_empty()) {
        out.push(part);
    }
    out
}

/// Joins two `/`-separated relative paths; either may be empty.
pub fn rel_join(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_string(),
        (_, true) => a.to_string(),
        _ => format!("{a}/{b}"),
    }
}

/// The parent part of a relative path ("" at the top).
pub fn rel_parent(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("")
}

/// The last part of a relative path.
pub fn rel_name(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(_, n)| n).unwrap_or(rel)
}

/// Paths longer than this (counted from the library folder, plus
/// [`WINDOWS_LIBRARY_ALLOWANCE`]) get a warning, because Windows can't open
/// paths over ~260 characters by default.
pub const PATH_WARN_LEN: usize = 240;
/// Room left for where the library folder sits on Windows
/// (e.g. `C:\Users\Name\My Drive\Library\`). The Mac's own prefix isn't used,
/// because the files sync to Windows where it's different.
pub const WINDOWS_LIBRARY_ALLOWANCE: usize = 60;

/// Path length as Windows counts it (UTF-16 units).
pub fn windows_len(rel_to_library: &str) -> usize {
    rel_to_library.encode_utf16().count()
}

/// Refuses with [`AppError::LongPath`] when `longest` (a path inside the
/// library) would be too long for Windows, unless the user already agreed.
pub fn check_path_len(longest: usize, allow_long: bool) -> AppResult<()> {
    let total = longest + WINDOWS_LIBRARY_ALLOWANCE;
    if allow_long || total <= PATH_WARN_LEN {
        return Ok(());
    }
    Err(AppError::LongPath(format!(
        "This makes a file path about {total} characters long. Windows may not be able to open \
         files with paths over 260 characters. Shorter names or fewer nested groups avoid this."
    )))
}

/// Length (Windows count) of the longest path inside `dir`, relative to `dir`
/// and including the leading separator. 0 for an empty folder.
pub fn longest_inside(dir: &Path) -> io::Result<usize> {
    let mut longest = 0;
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    while let Some((d, len)) = stack.pop() {
        for entry in fs::read_dir(&d)? {
            let entry = entry?;
            let l = len + 1 + windows_len(&entry.file_name().to_string_lossy());
            longest = longest.max(l);
            if entry.file_type()?.is_dir() {
                stack.push((entry.path(), l));
            }
        }
    }
    Ok(longest)
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
    note_own_change(path);
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
    note_own_change(path);
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
    fn rel_paths() {
        assert!(check_rel("Group A/Page A.md").is_ok());
        for bad in ["", "/a", "a/", "a//b", "a/../b", "a/.x", "a\\b"] {
            assert!(check_rel(bad).is_err(), "{bad}");
        }
        assert_eq!(rel_join("", "b"), "b");
        assert_eq!(rel_join("a", ""), "a");
        assert_eq!(rel_join("a", "b"), "a/b");
        assert_eq!((rel_parent("a/b/c"), rel_name("a/b/c")), ("a/b", "c"));
        assert_eq!((rel_parent("c"), rel_name("c")), ("", "c"));
        assert_eq!(join_rel(Path::new("/x"), "a/b"), Path::new("/x/a/b"));
        assert_eq!(join_rel(Path::new("/x"), ""), Path::new("/x"));
    }

    #[test]
    fn long_paths_warn_unless_allowed() {
        let limit = PATH_WARN_LEN - WINDOWS_LIBRARY_ALLOWANCE;
        assert!(check_path_len(limit, false).is_ok());
        assert!(matches!(check_path_len(limit + 1, false), Err(AppError::LongPath(_))));
        assert!(check_path_len(limit + 1, true).is_ok());
        // Counted like Windows does: one unit per BMP character.
        assert_eq!(windows_len("Ünï/名前"), 6);
    }

    #[test]
    fn longest_inside_counts_nested() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(longest_inside(dir.path()).unwrap(), 0);
        fs::create_dir_all(dir.path().join("ab/cde")).unwrap();
        fs::write(dir.path().join("ab/cde/f.md"), "").unwrap();
        fs::write(dir.path().join("short.md"), "").unwrap();
        assert_eq!(longest_inside(dir.path()).unwrap(), "/ab/cde/f.md".len());
    }

    #[test]
    fn name_taken_ignores_case() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Page A.md"), "").unwrap();
        assert!(name_taken(dir.path(), "page a.md").unwrap());
        assert!(!name_taken(dir.path(), "Page B.md").unwrap());
    }
}
