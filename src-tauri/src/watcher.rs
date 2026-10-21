//! Live reload (M10): while a project is open, its folder and the library's
//! `_themes/` are watched. Changes from outside the app (Google Drive bringing
//! files from the other computer, another program) bring the link index up to
//! date and are sent to the window as a `files-changed` event; the app's own
//! writes, renames and deletes are left out (fsutil remembers them). Events are
//! gathered until things are quiet for a moment, so hundreds of files arriving
//! at once are handled in one go.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::fsutil::is_own_change;
use crate::markers::MARKERS_DIR;
use crate::projects::{CACHE_DIR, CATEGORIES_DIR, PAGES_DIR, PROJECT_FILE};
use crate::themes::PROJECT_THEMES_DIR;
use crate::tree::is_page_file;

/// Wait until no event came for this long…
const QUIET: Duration = Duration::from_millis(300);
/// …but never longer than this after the first one.
const MAX_WAIT: Duration = Duration::from_millis(1500);

/// What changed, as the window needs to know it.
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub project: String,
    /// Page ids whose files changed or appeared.
    pub pages: Vec<String>,
    /// Page ids whose files are gone (deleted, moved or renamed).
    pub removed: Vec<String>,
    /// Groups (folders in `pages/`) appeared or went.
    pub groups: bool,
    pub categories: bool,
    /// `project.json`: templates, settings, main page.
    pub project_file: bool,
    pub project_themes: bool,
    pub app_themes: bool,
    pub assets: bool,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.pages.is_empty()
            && self.removed.is_empty()
            && !self.groups
            && !self.categories
            && !self.project_file
            && !self.project_themes
            && !self.app_themes
            && !self.assets
    }
}

/// Sorts changed paths into [`Changes`]. `own`: a path the app changed itself (left out).
pub fn classify(project_dir: &Path, app_themes: &Path, paths: &[PathBuf], own: impl Fn(&Path) -> bool) -> Changes {
    let mut c = Changes::default();
    for path in paths {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // Temp files of safe writes, Finder's notes.
        if (name.starts_with('.') && name.ends_with(".tmp")) || name == ".DS_Store" || own(path) {
            continue;
        }
        if path.starts_with(app_themes) {
            c.app_themes = true;
            continue;
        }
        let Ok(rel) = path.strip_prefix(project_dir) else { continue };
        let mut parts = rel.components().map(|p| p.as_os_str().to_string_lossy().into_owned());
        let Some(top) = parts.next() else { continue };
        match top.as_str() {
            CACHE_DIR | MARKERS_DIR => {}
            PROJECT_FILE => c.project_file = true,
            CATEGORIES_DIR => c.categories = true,
            PROJECT_THEMES_DIR => c.project_themes = true,
            crate::projects::ASSETS_DIR => c.assets = true,
            PAGES_DIR => {
                let rest: Vec<String> = parts.collect();
                if rest.is_empty() || rest.iter().any(|p| p.starts_with('.')) {
                    continue;
                }
                let id = rest.join("/");
                if !is_page_file(&name) {
                    c.groups = true;
                } else if path.is_file() {
                    if !c.pages.contains(&id) {
                        c.pages.push(id);
                    }
                } else if !c.removed.contains(&id) {
                    c.removed.push(id);
                }
            }
            // Conflict copies of project.json ("project (1).json") sit next to it.
            other if other.ends_with(".json") => c.project_file = true,
            _ => {}
        }
    }
    c
}

/// A running watch; dropping it stops watching.
pub struct Watch {
    _watcher: notify::RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Besides the system's change notices, the folders are looked over this
/// often: Drive doesn't always announce the files it brings in (e.g. Windows'
/// "Stream files" drive), so a change shows within about this long anyway.
const POLL: Duration = Duration::from_secs(2);

/// Modification time and size of a file, to tell whether it changed.
type Stamp = (Option<std::time::SystemTime>, u64);
type Snapshot = HashMap<PathBuf, Stamp>;

fn stamp_of(path: &Path) -> Option<Stamp> {
    let m = std::fs::metadata(path).ok().filter(|m| m.is_file())?;
    Some((m.modified().ok(), m.len()))
}

/// Every file under `folders` (caches, markers and hidden files left out), with its stamp.
fn scan(folders: &[PathBuf]) -> Snapshot {
    let mut out = Snapshot::new();
    let mut stack: Vec<PathBuf> = folders.iter().filter(|f| f.is_dir()).cloned().collect();
    while let Some(dir) = stack.pop() {
        let Ok(list) = std::fs::read_dir(&dir) else { continue };
        for e in list.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == MARKERS_DIR {
                continue;
            }
            match e.file_type() {
                Ok(t) if t.is_dir() => stack.push(e.path()),
                Ok(t) if t.is_file() => {
                    if let Ok(m) = e.metadata() {
                        out.insert(e.path(), (m.modified().ok(), m.len()));
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Files added, changed or gone between two looks.
fn differences(before: &Snapshot, now: &Snapshot) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = now.iter().filter(|(p, s)| before.get(*p) != Some(s)).map(|(p, _)| p.clone()).collect();
    out.extend(before.keys().filter(|p| !now.contains_key(*p)).cloned());
    out
}

/// Starts watching `project` (folder `dir`) and the library's `app_themes`.
pub fn start(app: AppHandle, project: String, dir: PathBuf, app_themes: PathBuf) -> notify::Result<Watch> {
    // Paths as the system reports them (folders resolved, e.g. /private/var on a Mac).
    let canonical_dir = dunce::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
    let canonical_themes = dunce::canonicalize(&app_themes).unwrap_or_else(|_| app_themes.clone());
    watch_batches(&[&dir, &app_themes], move |batch| {
        let mut changes = classify(&canonical_dir, &canonical_themes, &batch, is_own_change);
        if changes.is_empty() {
            return;
        }
        changes.project = project.clone();
        let state = app.state::<crate::AppState>();
        // Bring the link index up to date (only if this project's is loaded).
        let _ = state.refresh_open_index(&canonical_dir);
        let _ = app.emit("files-changed", &changes);
    })
}

/// Watches `folders` (those that exist) and calls `on_batch` with the changed
/// paths, gathered until things are quiet for a moment.
pub fn watch_batches(folders: &[&Path], on_batch: impl Fn(Vec<PathBuf>) + Send + 'static) -> notify::Result<Watch> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let notices = tx.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            for p in event.paths {
                let _ = notices.send(p);
            }
        }
    })?;
    for f in folders.iter().filter(|f| f.is_dir()) {
        watcher.watch(f, RecursiveMode::Recursive)?;
    }
    let roots: Vec<PathBuf> = folders.iter().map(|f| dunce::canonicalize(&f).unwrap_or_else(|_| f.to_path_buf())).collect();
    // What the files looked like when last reported: a change seen both as a
    // notice and by looking over the folders is reported once.
    let mut known = scan(&roots);
    let stop = Arc::new(AtomicBool::new(false));

    // Looking over the folders every few seconds (ends when the watch is dropped).
    let (poll_stop, poll_roots, poll_tx) = (stop.clone(), roots.clone(), tx);
    std::thread::spawn(move || {
        let mut before = scan(&poll_roots);
        while !poll_stop.load(Ordering::Relaxed) {
            std::thread::sleep(POLL);
            let now = scan(&poll_roots);
            for p in differences(&before, &now) {
                let _ = poll_tx.send(p);
            }
            before = now;
        }
    });

    std::thread::spawn(move || {
        // Ends when the watcher and the poller (the senders) are gone.
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            let start = Instant::now();
            while start.elapsed() < MAX_WAIT {
                match rx.recv_timeout(QUIET) {
                    Ok(p) => batch.push(p),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            batch.sort();
            batch.dedup();
            // Files already reported as they are now are left out (folders always pass).
            batch.retain(|p| {
                if p.is_dir() {
                    return true;
                }
                let now = stamp_of(p);
                let same = known.get(p) == now.as_ref();
                match now {
                    Some(s) => known.insert(p.clone(), s),
                    None => known.remove(p),
                };
                !same
            });
            if !batch.is_empty() {
                on_batch(batch);
            }
        }
    });
    Ok(Watch { _watcher: watcher, stop })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sorts_changes_and_leaves_out_own_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Project A");
        let themes = tmp.path().join("_themes");
        fs::create_dir_all(dir.join("pages/Group A")).unwrap();
        fs::write(dir.join("pages/Group A/Page A.md"), "a").unwrap();
        fs::write(dir.join("pages/Page B.md"), "b").unwrap();
        let paths: Vec<PathBuf> = [
            "pages/Group A/Page A.md",
            "pages/Page B.md",
            "pages/Page C.md",
            "pages/.Page A.md.123.tmp",
            "pages/Group A",
            "categories/Cat A.md",
            "project.json",
            "project (1).json",
            "assets/Picture A.png",
            ".cache/link-index.json",
            "_open/abc.json",
        ]
        .iter()
        .map(|p| dir.join(p))
        .chain([themes.join("Theme A/theme.json")])
        .collect();
        let own = |p: &Path| p.ends_with("Page B.md");
        let c = classify(&dir, &themes, &paths, own);
        assert_eq!(c.pages, vec!["Group A/Page A.md"]);
        assert_eq!(c.removed, vec!["Page C.md"]);
        assert!(c.groups && c.categories && c.project_file && c.assets && c.app_themes);
        assert!(!c.project_themes);
        // Only caches, markers and own writes: nothing to tell.
        let quiet = classify(&dir, &themes, &[dir.join(".cache/x"), dir.join("_open/m.json"), dir.join("pages/Page B.md")], own);
        assert!(quiet.is_empty());
    }

    /// Real files: a change shows within about 2 s, and 500 files arriving at once come in a few batches.
    #[test]
    fn notices_changes_on_disk_quickly_and_in_batches() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Project A");
        fs::create_dir_all(dir.join("pages")).unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = watch_batches(&[&dir], move |b| {
            let _ = tx.send(b);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let t = Instant::now();
        fs::write(dir.join("pages/Page A.md"), "outside").unwrap();
        let batch = rx.recv_timeout(Duration::from_secs(5)).expect("no change noticed");
        assert!(t.elapsed() < Duration::from_secs(2), "took {:?}", t.elapsed());
        assert!(batch.iter().any(|p| p.ends_with("Page A.md")));
        while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}

        let t = Instant::now();
        for i in 0..500 {
            fs::write(dir.join(format!("pages/Page {i}.md")), "x").unwrap();
        }
        let mut seen = std::collections::HashSet::new();
        let mut batches = 0;
        while seen.len() < 500 && t.elapsed() < Duration::from_secs(10) {
            if let Ok(b) = rx.recv_timeout(Duration::from_secs(3)) {
                batches += 1;
                seen.extend(b.into_iter().filter(|p| p.extension().is_some_and(|e| e == "md") && !p.ends_with("Page A.md")));
            }
        }
        println!("500 files: {batches} batches, {:?}", t.elapsed());
        assert_eq!(seen.len(), 500);
        assert!(batches <= 5, "{batches} batches");
    }

    #[test]
    fn looking_over_the_folders_finds_added_changed_and_gone_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        fs::create_dir_all(dir.join("pages/.hidden")).unwrap();
        fs::write(dir.join("pages/Page A.md"), "a").unwrap();
        fs::write(dir.join("pages/Page B.md"), "b").unwrap();
        fs::write(dir.join("pages/.hidden/x.md"), "x").unwrap();
        let before = scan(&[dir.clone()]);
        assert_eq!(before.len(), 2);
        fs::write(dir.join("pages/Page A.md"), "changed").unwrap();
        fs::remove_file(dir.join("pages/Page B.md")).unwrap();
        fs::write(dir.join("pages/Page C.md"), "c").unwrap();
        let mut d = differences(&before, &scan(&[dir.clone()]));
        d.sort();
        assert_eq!(d, vec![dir.join("pages/Page A.md"), dir.join("pages/Page B.md"), dir.join("pages/Page C.md")]);
    }

    #[test]
    fn own_safe_writes_are_recognised() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("Page A.md");
        crate::fsutil::safe_write(&path, b"mine").unwrap();
        assert!(is_own_change(&path));
        fs::write(&path, b"theirs").unwrap();
        assert!(!is_own_change(&path));
    }
}
