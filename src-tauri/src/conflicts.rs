//! Conflict copies (M10). When both computers change the same file before
//! Drive has synced, Drive keeps both: the second one as a copy, named in
//! various ways ("Page A (1).md", "Copy of Page A.md", "Page A [Conflict].md").
//! The app doesn't rely on those names:
//!
//! - Two page files with the same title (front matter, or the file name for
//!   files without one) are a conflict pair; the same for category files with
//!   the same name. The original is the file whose name matches its title,
//!   else the older one; the other is the copy, left out of the sidebar,
//!   links, search and relations until it's resolved (index.rs).
//! - `project.json` and `theme.json`: other `.json` files named like them in
//!   the same folder are copies.
//!
//! Resolving keeps one (the other goes to the Trash) or, for pages and
//! categories, both (the copy gets a new title). Image files aren't checked.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_rel, join_rel, move_to_trash, name_taken, rel_name, safe_write, to_file_name};
use crate::index::{Entry, ProjectIndex};
use crate::infobox::Infobox;
use crate::pages::{meta_infobox, parse, serialize};
use crate::projects::{CATEGORIES_DIR, PAGES_DIR, PROJECT_FILE};
use crate::themes::{APP_THEMES_DIR, PROJECT_THEMES_DIR};
use crate::tree::EXT;
use crate::wikilinks::norm;

/// Is file `id` named after `title` ("Page A" -> "Page A.md")?
fn named_after(id: &str, title: &str) -> bool {
    to_file_name(title).is_ok_and(|f| rel_name(id).eq_ignore_ascii_case(&format!("{f}{EXT}")))
}

/// The ids in `entries` that are conflict copies of another entry with the same title.
pub fn copies(entries: &BTreeMap<String, Entry>) -> Vec<String> {
    let mut by_title: HashMap<String, Vec<(&String, &Entry)>> = HashMap::new();
    for (id, e) in entries {
        by_title.entry(norm(&e.title)).or_default().push((id, e));
    }
    let mut out = Vec::new();
    for mut group in by_title.into_values().filter(|g| g.len() > 1) {
        // The original first: named after its title, then the oldest, then by id.
        group.sort_by(|a, b| {
            named_after(b.0, &b.1.title)
                .cmp(&named_after(a.0, &a.1.title))
                .then(a.1.mtime.cmp(&b.1.mtime))
                .then(a.0.cmp(b.0))
        });
        out.extend(group.into_iter().skip(1).map(|(id, _)| id.clone()));
    }
    out.sort();
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Page,
    Category,
    /// `project.json` (templates and project settings).
    Project,
    Theme,
}

/// A conflict pair. Paths are relative to the library folder, `/`-separated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub kind: Kind,
    /// The page or category title, the theme's folder name; "project.json".
    pub title: String,
    pub original: String,
    pub copy: String,
}

/// `.json` files in `dir` named like `stem.json` but not it ("project (1).json").
fn json_copies(dir: &Path, stem: &str) -> Vec<PathBuf> {
    let Ok(list) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<PathBuf> = list
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            name.ends_with(".json") && name != format!("{stem}.json") && name.contains(stem) && !name.starts_with('.')
        })
        .map(|e| e.path())
        .collect();
    out.sort();
    out
}

fn rel_to(library: &Path, path: &Path) -> String {
    path.strip_prefix(library)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Every conflict pair in the project (and in the library's app themes).
pub fn list(library: &Path, idx: &ProjectIndex) -> Vec<Conflict> {
    let rel = |p: &Path| rel_to(library, p);
    let mut out = Vec::new();
    let original_of = |entries: &BTreeMap<String, Entry>, title: &str| {
        entries.iter().find(|(_, e)| norm(&e.title) == norm(title)).map(|(id, _)| id.clone())
    };
    for (id, e) in &idx.copies {
        if let Some(orig) = original_of(&idx.pages, &e.title) {
            let pages = idx.dir.join(PAGES_DIR);
            out.push(Conflict { kind: Kind::Page, title: e.title.clone(), original: rel(&join_rel(&pages, &orig)), copy: rel(&join_rel(&pages, id)) });
        }
    }
    for (file, e) in &idx.cat_copies {
        if let Some(orig) = original_of(&idx.cats, &e.title) {
            let cats = idx.dir.join(CATEGORIES_DIR);
            out.push(Conflict { kind: Kind::Category, title: e.title.clone(), original: rel(&cats.join(orig)), copy: rel(&cats.join(file)) });
        }
    }
    for copy in json_copies(&idx.dir, "project") {
        out.push(Conflict { kind: Kind::Project, title: PROJECT_FILE.into(), original: rel(&idx.dir.join(PROJECT_FILE)), copy: rel(&copy) });
    }
    for themes in [idx.dir.join(PROJECT_THEMES_DIR), library.join(APP_THEMES_DIR)] {
        let Ok(list) = fs::read_dir(&themes) else { continue };
        let mut dirs: Vec<PathBuf> = list.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for dir in dirs {
            for copy in json_copies(&dir, "theme") {
                let title = dir.file_name().unwrap_or_default().to_string_lossy().into_owned();
                out.push(Conflict { kind: Kind::Theme, title, original: rel(&dir.join("theme.json")), copy: rel(&copy) });
            }
        }
    }
    out
}

/// One side of a pair, for showing the differences.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    /// Page or category text; the JSON file as text.
    pub text: String,
    pub infobox: Option<Infobox>,
    /// Last changed (ms since 1970).
    pub modified: u64,
}

/// A path inside the library from the UI, checked.
fn inside(library: &Path, rel: &str) -> AppResult<PathBuf> {
    check_rel(rel)?;
    Ok(join_rel(library, rel))
}

pub fn side(library: &Path, kind: Kind, rel: &str) -> AppResult<Side> {
    let path = inside(library, rel)?;
    let raw = fs::read_to_string(&path)?;
    let modified = fs::metadata(&path)?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Ok(match kind {
        Kind::Page | Kind::Category => match parse(&raw) {
            Ok((meta, body)) => Side { text: body, infobox: meta_infobox(&meta).ok().flatten(), modified },
            Err(_) => Side { text: raw, infobox: None, modified },
        },
        Kind::Project | Kind::Theme => {
            let text = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| serde_json::to_string_pretty(&v).ok())
                .unwrap_or(raw);
            Side { text, infobox: None, modified }
        }
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Keep {
    Original,
    Copy,
    /// Pages and categories: the copy gets a new title.
    Both,
}

/// A title like `title` that no name in `taken` (normalized) has: "Page A (copy)", "Page A (copy 2)"…
fn free_title(title: &str, taken: &[String]) -> String {
    (1..)
        .map(|n| if n == 1 { format!("{title} (copy)") } else { format!("{title} (copy {n})") })
        .find(|t| !taken.contains(&norm(t)))
        .unwrap()
}

/// Resolves a pair: the file not kept goes to the Trash ("keep the copy"
/// puts the copy in the original's place, under the original's file name).
pub fn resolve(library: &Path, idx: &mut ProjectIndex, c: &Conflict, keep: Keep) -> AppResult<()> {
    let original = inside(library, &c.original)?;
    let copy = inside(library, &c.copy)?;
    let ours = |p: &Path| p.starts_with(&idx.dir) || p.starts_with(library.join(APP_THEMES_DIR));
    if !ours(&original) || !ours(&copy) || !copy.is_file() {
        return Err(AppError::NotFound("This conflict is gone (it may have been resolved on the other computer).".into()));
    }
    match keep {
        Keep::Original => move_to_trash(&copy)?,
        Keep::Copy => {
            if original.exists() {
                move_to_trash(&original)?;
            }
            crate::fsutil::rename(&copy, &original)?;
        }
        Keep::Both => {
            if !matches!(c.kind, Kind::Page | Kind::Category) {
                return Err(AppError::Invalid("Only pages and categories can keep both versions.".into()));
            }
            let (mut meta, body) = parse(&fs::read_to_string(&copy)?)
                .map_err(|_| AppError::Invalid("The copy can't be read, so it can't get a new title.".into()))?;
            let taken: Vec<String> = match c.kind {
                Kind::Page => idx.pages.values().flat_map(|e| std::iter::once(&e.title).chain(&e.aliases)).map(|n| norm(n)).collect(),
                _ => idx.cats.values().map(|e| norm(&e.title)).collect(),
            };
            let title = free_title(&c.title, &taken);
            meta.insert("title".into(), title.as_str().into());
            let dir = copy.parent().unwrap_or(&idx.dir).to_path_buf();
            let stem = to_file_name(&title)?;
            let name = (1..)
                .map(|n| if n == 1 { format!("{stem}{EXT}") } else { format!("{stem} ({n}){EXT}") })
                .find(|f| !name_taken(&dir, f).unwrap_or(true))
                .unwrap();
            safe_write(&dir.join(&name), serialize(&meta, &body)?.as_bytes())?;
            crate::fsutil::note_own_change(&copy);
            fs::remove_file(&copy)?;
        }
    }
    idx.refresh(&[])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// A library with Project A: Page A and Drive's copy of it, a category
    /// and its copy, a project.json copy and an app theme copy.
    fn setup() -> (tempfile::TempDir, PathBuf, ProjectIndex) {
        let tmp = tempfile::tempdir().unwrap();
        let lib = tmp.path().to_path_buf();
        let dir = lib.join("Project A");
        write(&dir.join("project.json"), r#"{"name":"Project A","formatVersion":1}"#);
        write(&dir.join("project (1).json"), r#"{"name":"Project A","formatVersion":1,"mainPage":"Page A"}"#);
        write(&dir.join("pages/Page A.md"), "---\ntitle: Page A\n---\nOriginal text.\n");
        std::thread::sleep(std::time::Duration::from_millis(20));
        // Drive's copy: named differently, newer.
        write(&dir.join("pages/Page A [Conflict].md"), "---\ntitle: Page A\n---\nOther text.\n");
        write(&dir.join("pages/Page B.md"), "No front matter.\n");
        write(&dir.join("categories/Cat A.md"), "---\ntitle: Cat A\n---\nCat text.\n");
        write(&dir.join("categories/Cat A (1).md"), "---\ntitle: Cat A\n---\nOther cat text.\n");
        write(&lib.join("_themes/Theme A/theme.json"), r#"{"name":"Theme A","vars":{}}"#);
        write(&lib.join("_themes/Theme A/theme (1).json"), r##"{"name":"Theme A","vars":{"--bg":"#000"}}"##);
        let idx = ProjectIndex::open(&dir).unwrap();
        (tmp, lib, idx)
    }

    #[test]
    fn finds_pairs_and_keeps_copies_out_of_the_project() {
        let (_t, lib, idx) = setup();
        let pairs = list(&lib, &idx);
        let short: Vec<(Kind, &str, &str)> = pairs.iter().map(|c| (c.kind, c.original.as_str(), c.copy.as_str())).collect();
        assert_eq!(
            short,
            vec![
                (Kind::Page, "Project A/pages/Page A.md", "Project A/pages/Page A [Conflict].md"),
                (Kind::Category, "Project A/categories/Cat A.md", "Project A/categories/Cat A (1).md"),
                (Kind::Project, "Project A/project.json", "Project A/project (1).json"),
                (Kind::Theme, "_themes/Theme A/theme.json", "_themes/Theme A/theme (1).json"),
            ]
        );
        // The copy is out of the page list until resolved.
        assert_eq!(idx.page_infos().iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["Page A.md", "Page B.md"]);
        let s = side(&lib, Kind::Page, &pairs[0].copy).unwrap();
        assert_eq!(s.text, "Other text.\n");
    }

    #[test]
    fn the_older_file_is_the_original_when_names_dont_tell() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("P");
        write(&dir.join("project.json"), "{}");
        write(&dir.join("pages/One.md"), "---\ntitle: Page X\n---\n");
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(&dir.join("pages/Two.md"), "---\ntitle: Page X\n---\n");
        let idx = ProjectIndex::open(&dir).unwrap();
        assert_eq!(idx.copies.keys().collect::<Vec<_>>(), vec!["Two.md"]);
    }

    #[test]
    fn resolving_keeps_one_or_both_and_trashes_the_other() {
        let (_t, lib, mut idx) = setup();
        let pairs = list(&lib, &idx);
        let dir = idx.dir.clone();
        // Keep the copy: its text under the original's name.
        resolve(&lib, &mut idx, &pairs[0], Keep::Copy).unwrap();
        assert_eq!(fs::read_to_string(dir.join("pages/Page A.md")).unwrap(), "---\ntitle: Page A\n---\nOther text.\n");
        assert!(!dir.join("pages/Page A [Conflict].md").exists());
        // Keep both categories: the copy gets a new name.
        resolve(&lib, &mut idx, &pairs[1], Keep::Both).unwrap();
        assert!(fs::read_to_string(dir.join("categories/Cat A (copy).md")).unwrap().contains("title: Cat A (copy)"));
        assert!(dir.join("categories/Cat A.md").exists());
        // project.json: keeping both isn't offered; keep the original.
        assert!(resolve(&lib, &mut idx, &pairs[2], Keep::Both).is_err());
        resolve(&lib, &mut idx, &pairs[2], Keep::Original).unwrap();
        assert!(!dir.join("project (1).json").exists());
        resolve(&lib, &mut idx, &pairs[3], Keep::Copy).unwrap();
        assert!(fs::read_to_string(lib.join("_themes/Theme A/theme.json")).unwrap().contains("#000"));
        assert!(list(&lib, &idx).is_empty());
        assert_eq!(idx.pages.len(), 2);
    }
}
