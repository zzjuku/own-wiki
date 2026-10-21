//! Catching edits that Google Drive silently overwrote (M10). Drive doesn't
//! always keep both versions when both computers changed a file: often the
//! upload that arrives last simply wins. So every page and category file the
//! app writes carries a small count of edits per computer in its front matter:
//!
//! ```yaml
//! edits: { a1b2c3d4: 17, e5f6a7b8: 9 }   # computer id -> how many saves
//! ```
//!
//! Each save reads the file fresh, so a version also carries the counts of the
//! versions it was made from. This computer also remembers (in its app-config
//! folder, never synced) its last write of each file: the counts and the whole
//! text. When the file later shows a lower count for this computer than it
//! wrote, this computer's last edit was overwritten by a version that never
//! saw it: its text is put back as a conflict copy next to the file, and the
//! Conflicts screen offers it. Once a version made on another computer
//! arrives that includes this computer's edit, the remembered text is dropped.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};

use crate::error::AppResult;
use crate::fsutil::{name_taken, safe_write, version_of};
use crate::pages::{parse, serialize};
use crate::projects::{CATEGORIES_DIR, PAGES_DIR, PROJECT_FILE};

pub const KEY: &str = "edits";

/// Edit counts per computer.
pub type Counts = BTreeMap<String, u64>;

struct Me {
    id: String,
    name: String,
    store: PathBuf,
}

static ME: OnceLock<Me> = OnceLock::new();

/// Sets this computer's id (short), its name (for the copies' file names)
/// and where its records are kept. Without it (tests), nothing is stamped.
pub fn init(id: &str, name: &str, config_dir: &Path) {
    let _ = ME.set(Me { id: id.chars().take(8).collect(), name: name.to_string(), store: config_dir.join("edits") });
}

fn me() -> Option<&'static Me> {
    ME.get()
}

pub fn counts(meta: &Mapping) -> Counts {
    match meta.get(KEY) {
        Some(Value::Mapping(m)) => m
            .iter()
            .filter_map(|(k, v)| Some((k.as_str()?.to_string(), v.as_u64()?)))
            .collect(),
        _ => Counts::new(),
    }
}

pub fn set_counts(meta: &mut Mapping, c: &Counts) {
    let mut m = Mapping::new();
    for (k, v) in c {
        m.insert(k.as_str().into(), (*v).into());
    }
    meta.insert(KEY.into(), Value::Mapping(m));
}

/// Both versions' counts, the higher of each (a version made from both).
pub fn merged(a: &Counts, b: &Counts) -> Counts {
    let mut out = a.clone();
    for (k, v) in b {
        let e = out.entry(k.clone()).or_insert(0);
        *e = (*e).max(*v);
    }
    out
}

/// The project folder and the file's path inside it ("pages/A/Page.md"), for page and category files.
fn locate(path: &Path) -> Option<(PathBuf, String)> {
    let mut dir = path.parent()?;
    let mut parts = vec![path.file_name()?.to_string_lossy().into_owned()];
    loop {
        let name = dir.file_name()?.to_string_lossy().into_owned();
        let up = dir.parent()?;
        parts.push(name.clone());
        if (name == PAGES_DIR || name == CATEGORIES_DIR) && up.join(PROJECT_FILE).is_file() {
            parts.reverse();
            return Some((up.to_path_buf(), parts.join("/")));
        }
        dir = up;
    }
}

#[derive(Serialize, Deserialize)]
struct Record {
    /// The file inside the project ("pages/A/Page.md").
    file: String,
    counts: Counts,
    /// The whole file as this computer wrote it last.
    text: String,
}

fn records_dir(store: &Path, project_dir: &Path) -> PathBuf {
    let key = project_dir.canonicalize().unwrap_or_else(|_| project_dir.to_path_buf());
    store.join(version_of(key.to_string_lossy().as_bytes()))
}

fn record_path(store: &Path, project_dir: &Path, file: &str) -> PathBuf {
    records_dir(store, project_dir).join(format!("{}.json", version_of(file.as_bytes())))
}

/// Writes a page or category file: counts one more edit by this computer
/// (files with front matter only; files without stay without) and remembers it.
pub fn write(path: &Path, meta: &mut Mapping, body: &str) -> AppResult<()> {
    write_as(me(), path, meta, body)
}

fn write_as(me: Option<&Me>, path: &Path, meta: &mut Mapping, body: &str) -> AppResult<()> {
    let Some(me) = me.filter(|_| !meta.is_empty()) else {
        safe_write(path, serialize(meta, body)?.as_bytes())?;
        return Ok(());
    };
    let mut c = counts(meta);
    *c.entry(me.id.clone()).or_insert(0) += 1;
    set_counts(meta, &c);
    let text = serialize(meta, body)?;
    safe_write(path, text.as_bytes())?;
    if let Some((project, file)) = locate(path) {
        let rec = Record { file: file.clone(), counts: c, text };
        let target = record_path(&me.store, &project, &file);
        // Remembering is a safety net: failing to keep it doesn't stop saving.
        if fs::create_dir_all(target.parent().unwrap()).is_ok() {
            if let Ok(json) = serde_json::to_vec(&rec) {
                let _ = safe_write(&target, &json);
            }
        }
    }
    Ok(())
}

/// What happened to this computer's last write of a file, seeing the file's counts now.
#[derive(Debug, PartialEq)]
enum Seen {
    /// Still our version (not yet seen by the other computer): keep remembering.
    Ours,
    /// A newer version that includes our edit: forget it.
    Included,
    /// Overwritten by a version that never saw our edit.
    Lost,
}

fn judge(mine: &Counts, now: &Counts, me: &str) -> Seen {
    if now == mine {
        Seen::Ours
    } else if now.get(me).copied().unwrap_or(0) >= mine.get(me).copied().unwrap_or(0) {
        Seen::Included
    } else {
        Seen::Lost
    }
}

/// Puts `text` (a lost version of `file`) back next to it as a conflict copy.
fn rescue(project_dir: &Path, file: &str, text: &str, computer: &str) -> AppResult<()> {
    let path = crate::fsutil::join_rel(project_dir, file);
    let dir = path.parent().unwrap_or(project_dir).to_path_buf();
    fs::create_dir_all(&dir)?;
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let base = crate::fsutil::to_file_name(&format!("{stem} (from {computer})")).unwrap_or_else(|_| format!("{stem} (copy)"));
    let name = (1..)
        .map(|n| if n == 1 { format!("{base}.md") } else { format!("{base} {n}.md") })
        .find(|f| !name_taken(&dir, f).unwrap_or(true))
        .unwrap();
    safe_write(&dir.join(name), text.as_bytes())?;
    Ok(())
}

/// Looks at the files this computer wrote last in `project_dir` (only `files`
/// if given, e.g. what the watcher saw change) and turns overwritten edits
/// into conflict copies. Returns how many were put back.
pub fn check(project_dir: &Path, files: Option<&[String]>) -> usize {
    me().map_or(0, |me| check_as(me, project_dir, files))
}

fn check_as(me: &Me, project_dir: &Path, files: Option<&[String]>) -> usize {
    let dir = records_dir(&me.store, project_dir);
    let paths: Vec<PathBuf> = match files {
        Some(list) => list.iter().map(|f| record_path(&me.store, project_dir, f)).filter(|p| p.is_file()).collect(),
        None => fs::read_dir(&dir).map(|l| l.flatten().map(|e| e.path()).collect()).unwrap_or_default(),
    };
    let mut put_back = 0;
    for rec_path in paths {
        let Some(rec) = fs::read(&rec_path).ok().and_then(|b| serde_json::from_slice::<Record>(&b).ok()) else { continue };
        let file = crate::fsutil::join_rel(project_dir, &rec.file);
        // Gone (deleted or moved on the other computer): nothing to compare with.
        let Ok(raw) = fs::read_to_string(&file) else {
            let _ = fs::remove_file(&rec_path);
            continue;
        };
        let Ok((meta, _)) = parse(&raw) else { continue };
        match judge(&rec.counts, &counts(&meta), &me.id) {
            Seen::Ours => {}
            Seen::Included => {
                let _ = fs::remove_file(&rec_path);
            }
            Seen::Lost => {
                if rescue(project_dir, &rec.file, &rec.text, &me.name).is_ok() {
                    put_back += 1;
                    let _ = fs::remove_file(&rec_path);
                }
            }
        }
    }
    put_back
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(pairs: &[(&str, u64)]) -> Counts {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn tells_ours_included_and_lost_apart() {
        let mine = c(&[("me", 6), ("other", 3)]);
        assert_eq!(judge(&mine, &mine, "me"), Seen::Ours);
        // The other computer saved after getting our version.
        assert_eq!(judge(&mine, &c(&[("me", 6), ("other", 4)]), "me"), Seen::Included);
        // The other computer's version never saw our 6th save: lost.
        assert_eq!(judge(&mine, &c(&[("me", 5), ("other", 4)]), "me"), Seen::Lost);
        assert_eq!(judge(&mine, &Counts::new(), "me"), Seen::Lost);
        assert_eq!(merged(&c(&[("a", 2), ("b", 1)]), &c(&[("b", 3)])), c(&[("a", 2), ("b", 3)]));
    }

    /// Mac and Windows both edit offline; Drive keeps Windows' version: the Mac's comes back as a copy.
    #[test]
    fn an_overwritten_edit_comes_back_as_a_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("Project A");
        fs::create_dir_all(p.join("pages")).unwrap();
        fs::write(p.join(PROJECT_FILE), "{}").unwrap();
        let mac = Me { id: "mac".into(), name: "Mac".into(), store: tmp.path().join("mac") };
        let win = Me { id: "win".into(), name: "PC".into(), store: tmp.path().join("win") };
        let path = p.join("pages/Page A.md");
        let file = |body: &str| {
            let mut meta = Mapping::new();
            meta.insert("title".into(), "Page A".into());
            (meta, body.to_string())
        };
        // Both start from the same version, written on the Mac and seen by Windows.
        let (mut m, b) = file("Start.");
        write_as(Some(&mac), &path, &mut m, &b).unwrap();
        let synced = fs::read_to_string(&path).unwrap();
        // Windows edits (from the synced version)…
        let (mut wm, _) = parse(&synced).unwrap();
        let win_path = tmp.path().join("win-copy/Project A/pages/Page A.md");
        fs::create_dir_all(win_path.parent().unwrap()).unwrap();
        fs::write(tmp.path().join("win-copy/Project A").join(PROJECT_FILE), "{}").unwrap();
        write_as(Some(&win), &win_path, &mut wm, "Windows text.").unwrap();
        // …the Mac edits too, then Drive brings Windows' version over the Mac's.
        let (mut mm, _) = parse(&synced).unwrap();
        write_as(Some(&mac), &path, &mut mm, "Mac text.").unwrap();
        assert_eq!(check_as(&mac, &p, None), 0, "still the Mac's own version");
        fs::copy(&win_path, &path).unwrap();
        assert_eq!(check_as(&mac, &p, Some(&["pages/Page A.md".to_string()])), 1);
        let copy = fs::read_to_string(p.join("pages/Page A (from Mac).md")).unwrap();
        assert!(copy.ends_with("Mac text.") && copy.contains("title: Page A"));
        // Remembered no more: checking again finds nothing.
        assert_eq!(check_as(&mac, &p, None), 0);

        // A later edit on Windows that includes the Mac's edit: nothing lost, the record goes.
        let (mut m2, _) = parse(&fs::read_to_string(&path).unwrap()).unwrap();
        write_as(Some(&mac), &path, &mut m2, "Mac again.").unwrap();
        let (mut w2, _) = parse(&fs::read_to_string(&path).unwrap()).unwrap();
        write_as(Some(&win), &win_path, &mut w2, "Windows after.").unwrap();
        fs::copy(&win_path, &path).unwrap();
        assert_eq!(check_as(&mac, &p, None), 0);
        assert!(fs::read_dir(records_dir(&mac.store, &p)).unwrap().next().is_none());
    }

    #[test]
    fn finds_the_file_inside_its_project() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("Project A");
        fs::create_dir_all(p.join("pages/Group A")).unwrap();
        fs::write(p.join(PROJECT_FILE), "{}").unwrap();
        let (dir, file) = locate(&p.join("pages/Group A/Page A.md")).unwrap();
        assert_eq!((dir, file.as_str()), (p.clone(), "pages/Group A/Page A.md"));
        assert_eq!(locate(&p.join("categories/Cat A.md")).unwrap().1, "categories/Cat A.md");
    }
}
