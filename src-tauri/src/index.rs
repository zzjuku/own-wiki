//! The link index: titles, aliases, headings, outgoing links (in the text and
//! in infobox fields), opening paragraphs, templates and first infobox images
//! of every page in a project. Kept in memory while a project is
//! open and cached in `.cache/` (never the source of truth), with each file's
//! modification time and size, so reopening a project only re-reads files
//! that changed.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::fsutil::{rel_join, rel_parent, safe_write};
use crate::infobox::{FieldLink, field_links, first_image, sortable_values};
use crate::pages::{meta_aliases, meta_categories, meta_infobox, meta_sort, meta_title, parse};
use crate::projects::{CACHE_DIR, CATEGORIES_DIR, PAGES_DIR};
use crate::tree::{GroupInfo, PageInfo, is_page_file};
use crate::wikilinks::{self, Heading};

const CACHE_FILE: &str = "link-index.json";
const CACHE_VERSION: u32 = 7;
/// The cache is rewritten at most this often for small changes (a stale
/// cache only costs re-reading the changed files at the next open).
const CACHE_SAVE_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkRef {
    /// Page part as typed ("" for `[[#Section]]`).
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// 0-based line in the body.
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    /// Modification time (ns since 1970) and size when the file was read.
    pub mtime: u64,
    pub size: u64,
    pub title: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub headings: Vec<Heading>,
    #[serde(default)]
    pub links: Vec<LinkRef>,
    #[serde(default)]
    pub summary: String,
    /// Id of the template the page's infobox came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// Embedded pages (`{{Page}}` lines); `section` unused.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub embeds: Vec<LinkRef>,
    /// Links in infobox fields.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_links: Vec<FieldLink>,
    /// The first infobox image, else the first image in the text (file
    /// inside `assets/`), for hover cards.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// Categories the page is in (for a category file: its parent categories).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    /// How category pages sort the page ("Sort as").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
    /// Number and date values reverse fields and page lists can sort by
    /// (field label as compared -> key).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub values: BTreeMap<String, Vec<f64>>,
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    pages: BTreeMap<String, Entry>,
    #[serde(default)]
    cats: BTreeMap<String, Entry>,
}

pub struct ProjectIndex {
    /// The project folder.
    pub dir: PathBuf,
    pub groups: Vec<GroupInfo>,
    /// Page id -> entry.
    pub pages: BTreeMap<String, Entry>,
    /// Files in `categories/` (categories with own text or parents):
    /// file name -> entry (title = category name, categories = parents).
    pub cats: BTreeMap<String, Entry>,
    /// Entries changed since the cache was last written.
    unsaved: usize,
    saved_at: Instant,
}

fn stamp(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Reads one page file into an index entry.
pub fn read_entry(path: &Path, file_name: &str) -> Option<Entry> {
    let meta = fs::metadata(path).ok()?;
    let text = fs::read_to_string(path).ok()?;
    // A page whose front matter can't be read still gets indexed by file name.
    let (fm, body) = parse(&text).unwrap_or_else(|_| (Default::default(), text.clone()));
    let infobox = meta_infobox(&fm).ok().flatten();
    Some(Entry {
        mtime: stamp(&meta),
        size: meta.len(),
        title: meta_title(&fm, file_name),
        aliases: meta_aliases(&fm),
        headings: wikilinks::headings(&body),
        links: wikilinks::parse_links(&body)
            .into_iter()
            .map(|l| LinkRef { target: l.page, section: l.section, line: l.line as u32 })
            .collect(),
        summary: wikilinks::summary(&body),
        embeds: wikilinks::parse_embeds(&body)
            .into_iter()
            .map(|e| LinkRef { target: e.page, section: None, line: e.line as u32 })
            .collect(),
        template: infobox.as_ref().and_then(|ib| ib.template.clone()),
        field_links: infobox.as_ref().map(field_links).unwrap_or_default(),
        image: infobox.as_ref().and_then(first_image).or_else(|| crate::textimages::first_shown_image(&body)),
        categories: meta_categories(&fm),
        sort: meta_sort(&fm),
        values: infobox.as_ref().map(sortable_values).unwrap_or_default(),
    })
}

/// A page file found on disk.
struct Found {
    id: String,
    path: PathBuf,
    mtime: u64,
    size: u64,
}

fn walk(pages: &Path) -> AppResult<(Vec<GroupInfo>, Vec<Found>)> {
    let mut groups = Vec::new();
    let mut files = Vec::new();
    let mut stack = vec![(pages.to_path_buf(), String::new())];
    while let Some((dir, group)) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                let id = rel_join(&group, &name);
                stack.push((entry.path(), id.clone()));
                groups.push(GroupInfo { id, name });
            } else if kind.is_file() && is_page_file(&name) {
                let meta = entry.metadata()?;
                files.push(Found {
                    id: rel_join(&group, &name),
                    path: entry.path(),
                    mtime: stamp(&meta),
                    size: meta.len(),
                });
            }
        }
    }
    groups.sort_by(|a, b| a.id.cmp(&b.id));
    Ok((groups, files))
}

/// Reads many files using several threads (the first open of a big project).
fn read_all(found: Vec<Found>) -> Vec<(String, Option<Entry>)> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    if found.len() < 64 || threads < 2 {
        return found
            .into_iter()
            .map(|f| {
                let e = read_entry(&f.path, crate::fsutil::rel_name(&f.id));
                (f.id, e)
            })
            .collect();
    }
    let chunk = found.len().div_ceil(threads);
    std::thread::scope(|s| {
        let handles: Vec<_> = found
            .chunks(chunk)
            .map(|part| {
                s.spawn(move || {
                    part.iter()
                        .map(|f| (f.id.clone(), read_entry(&f.path, crate::fsutil::rel_name(&f.id))))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

impl ProjectIndex {
    /// Loads the cached index of the project in `dir` (or starts empty) and
    /// brings it up to date with the files.
    pub fn open(dir: &Path) -> AppResult<Self> {
        let (pages, cats) = fs::read_to_string(dir.join(CACHE_DIR).join(CACHE_FILE))
            .ok()
            .and_then(|t| serde_json::from_str::<CacheFile>(&t).ok())
            .filter(|c| c.version == CACHE_VERSION)
            .map(|c| (c.pages, c.cats))
            .unwrap_or_default();
        let mut index = ProjectIndex {
            dir: dir.to_path_buf(),
            groups: Vec::new(),
            pages,
            cats,
            unsaved: 0,
            saved_at: Instant::now(),
        };
        index.refresh(&[])?;
        index.save_cache(true);
        Ok(index)
    }

    /// Re-reads every page file that changed on disk (by time and size),
    /// plus the ids in `force`, and forgets pages that are gone.
    pub fn refresh(&mut self, force: &[&str]) -> AppResult<()> {
        let (groups, found) = walk(&self.dir.join(PAGES_DIR))?;
        self.groups = groups;
        let seen: HashSet<&str> = found.iter().map(|f| f.id.as_str()).collect();
        let before = self.pages.len();
        self.pages.retain(|id, _| seen.contains(id.as_str()));
        let mut changed = before - self.pages.len();
        let stale: Vec<Found> = found
            .into_iter()
            .filter(|f| {
                force.contains(&f.id.as_str())
                    || self.pages.get(&f.id).is_none_or(|e| e.mtime != f.mtime || e.size != f.size)
            })
            .collect();
        for (id, entry) in read_all(stale) {
            changed += 1;
            match entry {
                Some(e) => self.pages.insert(id, e),
                None => self.pages.remove(&id),
            };
        }
        self.unsaved += changed + self.refresh_cats();
        self.save_cache(false);
        Ok(())
    }

    /// Re-reads changed category files; returns how many changed.
    fn refresh_cats(&mut self) -> usize {
        let mut found = Vec::new();
        if let Ok(list) = fs::read_dir(self.dir.join(CATEGORIES_DIR)) {
            for entry in list.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || !is_page_file(&name) {
                    continue;
                }
                if let Some(meta) = entry.metadata().ok().filter(|m| m.is_file()) {
                    found.push(Found { id: name, path: entry.path(), mtime: stamp(&meta), size: meta.len() });
                }
            }
        }
        let before = self.cats.len();
        self.cats.retain(|id, _| found.iter().any(|f| &f.id == id));
        let mut changed = before - self.cats.len();
        for f in found {
            if self.cats.get(&f.id).is_some_and(|e| e.mtime == f.mtime && e.size == f.size) {
                continue;
            }
            changed += 1;
            match read_entry(&f.path, &f.id) {
                Some(e) => self.cats.insert(f.id, e),
                None => self.cats.remove(&f.id),
            };
        }
        changed
    }

    /// Re-reads the category files after the app changed one.
    pub fn reload_cats(&mut self) {
        self.unsaved += self.refresh_cats();
        self.save_cache(false);
    }

    /// Writes the cache file if it's worth it now (or always with `now`).
    pub fn save_cache(&mut self, now: bool) {
        if self.unsaved == 0 || (!now && self.unsaved < 50 && self.saved_at.elapsed() < CACHE_SAVE_INTERVAL) {
            return;
        }
        let file = CacheFile { version: CACHE_VERSION, pages: self.pages.clone(), cats: self.cats.clone() };
        let dir = self.dir.join(CACHE_DIR);
        // The cache is optional: failing to write it only slows the next open.
        let _ = fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_vec(&file) {
            if safe_write(&dir.join(CACHE_FILE), &json).is_ok() {
                self.unsaved = 0;
                self.saved_at = Instant::now();
            }
        }
    }

    /// Re-reads one page after the app saved it (cheaper than a full refresh).
    pub fn reload_page(&mut self, id: &str) {
        let path = crate::fsutil::join_rel(&self.dir.join(PAGES_DIR), id);
        match read_entry(&path, crate::fsutil::rel_name(id)) {
            Some(e) => self.pages.insert(id.to_string(), e),
            None => self.pages.remove(id),
        };
        self.unsaved += 1;
        self.save_cache(false);
    }

    pub fn page_infos(&self) -> Vec<PageInfo> {
        self.pages
            .iter()
            .map(|(id, e)| PageInfo {
                id: id.clone(),
                title: e.title.clone(),
                group: rel_parent(id).to_string(),
                aliases: e.aliases.clone(),
            })
            .collect()
    }
}
