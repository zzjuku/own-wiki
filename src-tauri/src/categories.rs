//! Categories: tags on pages (`categories:` in a page's front matter), with
//! an automatic page per category. A category exists while a page, a
//! template, a subcategory or its own file uses it. Its own file
//! (`categories/<Name>.md`, front matter `title` and `categories` = parent
//! categories, body = the category page's own text) is only made when it
//! gets text or parents, or when it is created on its own (from a red link).
//!
//! Category names are their own name space, unique ignoring case, and can't
//! contain `[ ] | #`.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_yaml_ng::Mapping;

use crate::error::{AppError, AppResult};
use crate::fsutil::{move_to_trash, name_taken, rel_parent, safe_write, to_file_name};
use crate::index::ProjectIndex;
use crate::infobox::Template;
use crate::pages::{self, check_link_chars, parse, serialize, set_list_meta};
use crate::projects::{self, CATEGORIES_DIR};
use crate::relink::{Backlink, parallel};
use crate::tree::{EXT, pages_dir};
use crate::wikilinks::{category_of, norm, rewrite_category_links};

/// A category as the UI lists it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInfo {
    pub name: String,
    /// Pages directly in it.
    pub pages: usize,
    pub subcategories: usize,
    pub parents: Vec<String>,
    /// It has its own file (own text or parents).
    pub has_file: bool,
}

/// What the registry knows about one category while it's being built.
#[derive(Default)]
struct Cat {
    name: String,
    /// How good `name` is: 3 = its file's title, 2 = a page, 1 = a template, 0 = a parent reference.
    rank: u8,
    file: Option<String>,
    parents: Vec<String>,
    pages: Vec<String>,
}

/// Every category of the project, by normalized name.
struct Registry {
    cats: BTreeMap<String, Cat>,
}

impl Registry {
    fn build(idx: &ProjectIndex, templates: &[Template]) -> Registry {
        let mut cats: BTreeMap<String, Cat> = BTreeMap::new();
        let mut note = |name: &str, rank: u8| -> String {
            let key = norm(name);
            let c = cats.entry(key.clone()).or_default();
            if c.name.is_empty() || rank > c.rank {
                c.name = name.trim().to_string();
                c.rank = rank;
            }
            key
        };
        let mut files = Vec::new();
        for (file, e) in &idx.cats {
            let key = note(&e.title, 3);
            files.push((key, file.clone(), e.categories.clone()));
        }
        let mut members = Vec::new();
        for (id, e) in &idx.pages {
            for c in &e.categories {
                if !c.trim().is_empty() {
                    members.push((note(c, 2), id.clone()));
                }
            }
        }
        for t in templates {
            for c in &t.categories {
                note(c, 1);
            }
        }
        for (_, _, parents) in &files {
            for p in parents {
                note(p, 0);
            }
        }
        for (key, file, parents) in files {
            let c = cats.get_mut(&key).unwrap();
            c.file.get_or_insert(file);
            for p in parents {
                if !c.parents.iter().any(|x| norm(x) == norm(&p)) && norm(&p) != key {
                    c.parents.push(p);
                }
            }
        }
        for (key, id) in members {
            let pages = &mut cats.get_mut(&key).unwrap().pages;
            if !pages.contains(&id) {
                pages.push(id);
            }
        }
        // Parents are shown with their best spelling.
        let names: BTreeMap<String, String> = cats.iter().map(|(k, c)| (k.clone(), c.name.clone())).collect();
        for c in cats.values_mut() {
            for p in &mut c.parents {
                if let Some(n) = names.get(&norm(p)) {
                    *p = n.clone();
                }
            }
        }
        Registry { cats }
    }

    fn get(&self, name: &str) -> Option<&Cat> {
        self.cats.get(&norm(name))
    }

    /// Normalized names of the categories directly below `key`.
    fn children(&self, key: &str) -> Vec<&String> {
        self.cats.iter().filter(|(_, c)| c.parents.iter().any(|p| norm(p) == key)).map(|(k, _)| k).collect()
    }

    /// `key` and every category below it.
    fn below(&self, key: &str) -> Vec<String> {
        let mut seen = vec![key.to_string()];
        let mut i = 0;
        while i < seen.len() {
            for c in self.children(&seen[i].clone()) {
                if !seen.contains(c) {
                    seen.push(c.clone());
                }
            }
            i += 1;
        }
        seen
    }

    fn info(&self, key: &str) -> CategoryInfo {
        let c = &self.cats[key];
        CategoryInfo {
            name: c.name.clone(),
            pages: c.pages.len(),
            subcategories: self.children(key).len(),
            parents: c.parents.clone(),
            has_file: c.file.is_some(),
        }
    }

    /// The existing spelling of a category, or the name as given.
    fn spelling(&self, name: &str) -> String {
        self.get(name).map(|c| c.name.clone()).unwrap_or_else(|| name.to_string())
    }
}

fn registry(idx: &ProjectIndex) -> AppResult<Registry> {
    Ok(Registry::build(idx, &projects::templates(&idx.dir)?))
}

/// A category name as typed: trimmed, spaces collapsed, a leading
/// "Category:" dropped. Refuses empty names and link characters.
pub fn clean_name(name: &str) -> AppResult<String> {
    let mut n = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if n.get(..9).is_some_and(|p| p.eq_ignore_ascii_case("category:")) {
        n = n[9..].trim().to_string();
    }
    if n.is_empty() {
        return Err(AppError::Invalid("A category needs a name.".into()));
    }
    check_link_chars(&n, "Category names")?;
    to_file_name(&n)?;
    Ok(n)
}

/// Cleans a list of category names, using existing spellings and dropping repeats.
fn clean_list(reg: &Registry, names: &[String]) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for n in names {
        if n.trim().is_empty() {
            continue;
        }
        let n = reg.spelling(&clean_name(n)?);
        if !out.iter().any(|o| norm(o) == norm(&n)) {
            out.push(n);
        }
    }
    Ok(out)
}

pub fn list(idx: &ProjectIndex) -> AppResult<Vec<CategoryInfo>> {
    let reg = registry(idx)?;
    let mut out: Vec<CategoryInfo> = reg.cats.keys().map(|k| reg.info(k)).collect();
    out.sort_by_key(|c| c.name.to_lowercase());
    Ok(out)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub title: String,
    pub group: String,
    /// "Sort as", if the page has one.
    pub sort: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPage {
    pub name: String,
    /// False for a category nothing uses yet (a red link).
    pub exists: bool,
    /// The category page's own text (Markdown).
    pub text: String,
    pub parents: Vec<String>,
    pub subcategories: Vec<CategoryInfo>,
    /// Pages directly in it, or with `include_sub` every page below it (once).
    pub pages: Vec<Member>,
}

pub fn page(idx: &ProjectIndex, name: &str, include_sub: bool) -> AppResult<CategoryPage> {
    let reg = registry(idx)?;
    let key = norm(&clean_name(name)?);
    let Some(c) = reg.cats.get(&key) else {
        return Ok(CategoryPage {
            name: clean_name(name)?,
            exists: false,
            text: String::new(),
            parents: Vec::new(),
            subcategories: Vec::new(),
            pages: Vec::new(),
        });
    };
    let text = match &c.file {
        Some(f) => fs::read_to_string(idx.dir.join(CATEGORIES_DIR).join(f)).ok().and_then(|t| parse(&t).ok()).map(|(_, b)| b).unwrap_or_default(),
        None => String::new(),
    };
    let mut subcategories: Vec<CategoryInfo> = reg.children(&key).into_iter().map(|k| reg.info(k)).collect();
    subcategories.sort_by_key(|s| s.name.to_lowercase());
    let keys = if include_sub { reg.below(&key) } else { vec![key.clone()] };
    let mut seen = HashSet::new();
    let mut pages = Vec::new();
    for k in keys {
        for id in &reg.cats[&k].pages {
            if seen.insert(id.clone()) {
                let e = &idx.pages[id];
                pages.push(Member { id: id.clone(), title: e.title.clone(), group: rel_parent(id).to_string(), sort: e.sort.clone() });
            }
        }
    }
    Ok(CategoryPage { name: c.name.clone(), exists: true, text, parents: c.parents.clone(), subcategories, pages })
}

// ---- category files ----

fn cats_dir(idx: &ProjectIndex) -> AppResult<PathBuf> {
    let dir = idx.dir.join(CATEGORIES_DIR);
    if !dir.is_dir() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// A free file name in `categories/` for `name`.
fn new_file_name(dir: &Path, name: &str) -> AppResult<String> {
    let stem = to_file_name(name)?;
    for n in 1.. {
        let f = if n == 1 { format!("{stem}{EXT}") } else { format!("{stem} ({n}){EXT}") };
        if !name_taken(dir, &f)? {
            return Ok(f);
        }
    }
    unreachable!()
}

/// Reads, changes and writes the category's file (made if it has none yet).
/// `f` gets the front matter and the text.
fn edit_file(idx: &mut ProjectIndex, reg: &Registry, name: &str, f: impl FnOnce(&mut Mapping, &mut String)) -> AppResult<()> {
    let dir = cats_dir(idx)?;
    let c = reg.get(name);
    let (path, mut meta, mut body) = match c.and_then(|c| c.file.as_ref()) {
        Some(file) => {
            let path = dir.join(file);
            let (meta, body) = parse(&fs::read_to_string(&path)?)?;
            (path, meta, body)
        }
        None => {
            let name = c.map(|c| c.name.clone()).unwrap_or_else(|| name.to_string());
            let mut meta = Mapping::new();
            meta.insert("title".into(), name.as_str().into());
            (dir.join(new_file_name(&dir, &name)?), meta, String::new())
        }
    };
    f(&mut meta, &mut body);
    safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
    idx.reload_cats();
    Ok(())
}

/// Makes a category nothing uses yet (clicking a red category link).
pub fn create(idx: &mut ProjectIndex, name: &str) -> AppResult<String> {
    let name = clean_name(name)?;
    let reg = registry(idx)?;
    if let Some(c) = reg.get(&name) {
        return Ok(c.name.clone());
    }
    edit_file(idx, &reg, &name, |_, _| {})?;
    Ok(name)
}

/// Replaces the category page's own text.
pub fn save_text(idx: &mut ProjectIndex, name: &str, text: &str) -> AppResult<()> {
    let name = clean_name(name)?;
    let reg = registry(idx)?;
    if reg.get(&name).is_none_or(|c| c.file.is_none()) && text.trim().is_empty() {
        return Ok(());
    }
    edit_file(idx, &reg, &name, |_, body| *body = text.to_string())
}

/// Replaces the category's parent categories. A parent that would put the
/// category inside itself is refused.
pub fn set_parents(idx: &mut ProjectIndex, name: &str, parents: &[String]) -> AppResult<Vec<String>> {
    let name = clean_name(name)?;
    let reg = registry(idx)?;
    let parents = clean_list(&reg, parents)?;
    let below = reg.below(&norm(&name));
    for p in &parents {
        if norm(p) == norm(&name) {
            return Err(AppError::Invalid("A category can't be inside itself.".into()));
        }
        if below.contains(&norm(p)) {
            return Err(AppError::Invalid(format!(
                "\"{p}\" is already inside \"{}\", so it can't also be above it.",
                reg.spelling(&name)
            )));
        }
    }
    if reg.get(&name).is_none_or(|c| c.file.is_none()) && parents.is_empty() {
        return Ok(parents);
    }
    let list = parents.clone();
    edit_file(idx, &reg, &name, |meta, _| set_list_meta(meta, "categories", &list))?;
    Ok(parents)
}

/// Replaces a page's categories.
pub fn set_page_categories(library: &Path, project: &str, idx: &mut ProjectIndex, id: &str, names: &[String]) -> AppResult<Vec<String>> {
    let reg = registry(idx)?;
    let list = clean_list(&reg, names)?;
    let pages = pages_dir(library, project)?;
    let out = list.clone();
    pages::update_categories(&pages, id, move |cats| {
        if *cats == list {
            return false;
        }
        *cats = list;
        true
    })?;
    idx.reload_page(id);
    Ok(out)
}

pub fn set_page_sort(library: &Path, project: &str, idx: &mut ProjectIndex, id: &str, sort: Option<&str>) -> AppResult<()> {
    pages::set_sort(&pages_dir(library, project)?, id, sort)?;
    idx.reload_page(id);
    Ok(())
}

// ---- rename and delete ----

/// What renaming or deleting a category changes (or changed).
#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CategoryChange {
    /// Pages in the category.
    pub pages: usize,
    /// Categories that have it as parent.
    pub subcategories: usize,
    /// `[[Category:…]]` links to it, and in how many pages.
    pub links: usize,
    pub linking_pages: usize,
    /// Templates that give it to new pages.
    pub templates: usize,
    /// Pages and categories whose files couldn't be updated.
    pub failed: Vec<String>,
}

/// Ids of pages with `[[Category:key]]` links, and how many links.
fn linking(idx: &ProjectIndex, key: &str) -> (Vec<String>, usize) {
    let mut ids = Vec::new();
    let mut count = 0;
    for (id, e) in &idx.pages {
        let n = e.links.iter().filter(|l| category_of(&l.target).as_deref() == Some(key)).count();
        if n > 0 {
            ids.push(id.clone());
            count += n;
        }
    }
    (ids, count)
}

/// Category files (other than `skip`) that list `key` as parent or link to it.
fn touching_files(idx: &ProjectIndex, key: &str) -> Vec<String> {
    idx.cats
        .iter()
        .filter(|(_, e)| {
            e.categories.iter().any(|p| norm(p) == key) || e.links.iter().any(|l| category_of(&l.target).as_deref() == Some(key))
        })
        .map(|(f, _)| f.clone())
        .collect()
}

/// Counts what renaming or deleting category `key` touches.
fn count(idx: &ProjectIndex, reg: &Registry, templates: &[Template], key: &str) -> CategoryChange {
    let (ids, links) = linking(idx, key);
    CategoryChange {
        pages: reg.cats.get(key).map(|c| c.pages.len()).unwrap_or(0),
        subcategories: reg.children(key).len(),
        links,
        linking_pages: ids.len(),
        templates: templates.iter().filter(|t| t.categories.iter().any(|c| norm(c) == key)).count(),
        failed: Vec::new(),
    }
}

/// Changes category `key` to `new` (rename) or removes it (`None`) in a list.
fn replace_in(list: &mut Vec<String>, key: &str, new: Option<&str>) -> bool {
    if !list.iter().any(|c| norm(c) == key) {
        return false;
    }
    let mut out: Vec<String> = Vec::new();
    for c in list.drain(..) {
        let c = if norm(&c) == key { match new { Some(n) => n.to_string(), None => continue } } else { c };
        if !out.iter().any(|o| norm(o) == norm(&c)) {
            out.push(c);
        }
    }
    *list = out;
    true
}

/// Renames (`new` = Some) or deletes (`None`) a category everywhere: pages,
/// parent lists of other categories, `[[Category:…]]` links (rename only),
/// template defaults, and its own file. With `dry_run` only counts.
pub fn rename_or_delete(
    library: &Path,
    project: &str,
    idx: &mut ProjectIndex,
    name: &str,
    new: Option<&str>,
    dry_run: bool,
) -> AppResult<CategoryChange> {
    let mut templates = projects::templates(&idx.dir)?;
    let reg = Registry::build(idx, &templates);
    let key = norm(&clean_name(name)?);
    let old = reg.cats.get(&key).ok_or_else(|| AppError::NotFound("That category doesn't exist.".into()))?;
    let new = match new {
        Some(n) => {
            let n = clean_name(n)?;
            if norm(&n) != key && reg.get(&n).is_some() {
                return Err(AppError::Exists(format!("A category named \"{}\" already exists.", reg.spelling(&n))));
            }
            Some(n)
        }
        None => None,
    };
    let mut result = count(idx, &reg, &templates, &key);
    if dry_run {
        return Ok(result);
    }
    let pages_dir = pages_dir(library, project)?;

    // Pages in the category, and pages linking to it.
    let (link_ids, _) = linking(idx, &key);
    let mut ids: Vec<String> = old.pages.clone();
    ids.extend(link_ids.into_iter().filter(|i| !old.pages.contains(i)));
    let results = parallel(&ids, |pid| update_page_file(&crate::fsutil::join_rel(&pages_dir, pid), &key, new.as_deref()));
    for (pid, r) in ids.iter().zip(results) {
        if r.is_err() {
            result.failed.push(idx.pages.get(pid).map(|e| e.title.clone()).unwrap_or_else(|| pid.clone()));
        }
    }

    // Other categories' files: parents and links.
    let dir = cats_dir(idx)?;
    let own = old.file.clone();
    for file in touching_files(idx, &key).into_iter().filter(|f| Some(f) != own.as_ref()) {
        let path = dir.join(&file);
        let r = (|| -> AppResult<()> {
            let (mut meta, body) = parse(&fs::read_to_string(&path)?)?;
            let mut parents = pages::meta_categories(&meta);
            if replace_in(&mut parents, &key, new.as_deref()) {
                set_list_meta(&mut meta, "categories", &parents);
            }
            let body = match &new {
                Some(n) => rewrite_category_links(&body, &key, n).0,
                None => body,
            };
            safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
            Ok(())
        })();
        if r.is_err() {
            result.failed.push(format!("Category: {}", idx.cats[&file].title));
        }
    }

    // Template defaults.
    let mut changed = false;
    for t in &mut templates {
        changed |= replace_in(&mut t.categories, &key, new.as_deref());
    }
    if changed {
        projects::set_templates(&idx.dir, &templates)?;
    }

    // Its own file: renamed along, or moved to the Trash.
    if let Some(file) = own {
        let path = dir.join(&file);
        match &new {
            Some(n) => {
                let (mut meta, body) = parse(&fs::read_to_string(&path)?)?;
                meta.insert("title".into(), n.as_str().into());
                let body = rewrite_category_links(&body, &key, n).0;
                safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
                let stem = to_file_name(n)?;
                if !file.eq_ignore_ascii_case(&format!("{stem}{EXT}")) {
                    let target = new_file_name(&dir, n)?;
                    fs::rename(&path, dir.join(target))?;
                } else if file != format!("{stem}{EXT}") {
                    // Only upper/lower case changed: rename through a temporary name.
                    let tmp = dir.join(format!(".{file}.renaming"));
                    fs::rename(&path, &tmp)?;
                    fs::rename(&tmp, dir.join(format!("{stem}{EXT}")))?;
                }
            }
            None => move_to_trash(&path)?,
        }
    }

    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    idx.refresh(&refs)?;
    Ok(result)
}

/// Renames (or removes) category `key` in one page file: its categories and,
/// on rename, its `[[Category:…]]` links. Written once, only if it changed.
fn update_page_file(path: &Path, key: &str, new: Option<&str>) -> AppResult<()> {
    let (mut meta, body) = parse(&fs::read_to_string(path)?)?;
    let mut cats = pages::meta_categories(&meta);
    let mut changed = replace_in(&mut cats, key, new);
    if changed {
        set_list_meta(&mut meta, "categories", &cats);
    }
    let body = match new {
        Some(n) => {
            let (b, k) = rewrite_category_links(&body, key, n);
            changed |= k > 0;
            b
        }
        None => body,
    };
    if changed {
        safe_write(path, serialize(&meta, &body)?.as_bytes())?;
    }
    Ok(())
}

// ---- links to categories ----

/// Pages that link to the category with `[[Category:…]]`.
pub fn backlinks(library: &Path, project: &str, idx: &ProjectIndex, name: &str, context: bool) -> AppResult<Vec<Backlink>> {
    let key = norm(&clean_name(name)?);
    let pages_dir = pages_dir(library, project)?;
    let mut out = Vec::new();
    for (id, e) in &idx.pages {
        let mut lines: Vec<usize> = Vec::new();
        for l in e.links.iter().filter(|l| category_of(&l.target).as_deref() == Some(key.as_str())) {
            if !lines.contains(&(l.line as usize)) {
                lines.push(l.line as usize);
            }
        }
        if lines.is_empty() {
            continue;
        }
        let lines = if context { pages::body_lines(&pages_dir, id, &lines[..lines.len().min(3)]).unwrap_or_default() } else { Vec::new() };
        out.push(Backlink { id: id.clone(), title: e.title.clone(), group: rel_parent(id).to_string(), via: Vec::new(), lines, fields: Vec::new(), spoiler_fields: 0 });
    }
    out.sort_by_key(|b| b.title.to_lowercase());
    Ok(out)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPreview {
    pub name: String,
    pub exists: bool,
    /// Start of its own text (Markdown).
    pub text: String,
    pub pages: usize,
    pub subcategories: usize,
}

/// What a hover card shows for a `[[Category:…]]` link.
pub fn preview(idx: &ProjectIndex, name: &str) -> AppResult<CategoryPreview> {
    let reg = registry(idx)?;
    let name = clean_name(name)?;
    let Some(c) = reg.get(&name) else {
        return Ok(CategoryPreview { name, exists: false, text: String::new(), pages: 0, subcategories: 0 });
    };
    let text = c.file.as_ref().and_then(|f| idx.cats.get(f)).map(|e| e.summary.clone()).unwrap_or_default();
    Ok(CategoryPreview { name: c.name.clone(), exists: true, text, pages: c.pages.len(), subcategories: reg.children(&norm(&name)).len() })
}

/// After a page rename: points page links in category texts from `old` to `new`.
pub fn rewrite_page_links_in_cats(idx: &ProjectIndex, old: &str, new: &str) -> usize {
    let dir = idx.dir.join(CATEGORIES_DIR);
    let n = norm(old);
    let mut count = 0;
    for (file, e) in &idx.cats {
        if !e.links.iter().chain(&e.embeds).any(|l| norm(&l.target) == n) {
            continue;
        }
        let path = dir.join(file);
        let Ok((meta, body)) = fs::read_to_string(&path).map_err(AppError::from).and_then(|t| parse(&t)) else { continue };
        let (body, k) = crate::wikilinks::rewrite_links(&body, old, new);
        if k > 0 && serialize(&meta, &body).map(|t| safe_write(&path, t.as_bytes()).is_ok()).unwrap_or(false) {
            count += k;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::{create_project, set_templates};

    fn setup() -> (tempfile::TempDir, String, ProjectIndex) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap().id;
        let idx = ProjectIndex::open(&lib.path().join(&p)).unwrap();
        (lib, p, idx)
    }

    fn add_page(lib: &Path, p: &str, idx: &mut ProjectIndex, title: &str, body: &str, cats: &[&str]) -> String {
        let info = pages::create_page(lib, p, "", title, false, &idx.page_infos(), None).unwrap();
        pages::save_page(lib, p, &info.id, body).unwrap();
        idx.refresh(&[&info.id]).unwrap();
        let cats: Vec<String> = cats.iter().map(|s| s.to_string()).collect();
        set_page_categories(lib, p, idx, &info.id, &cats).unwrap();
        info.id
    }

    #[test]
    fn pages_parents_and_listing() {
        let (lib, p, mut idx) = setup();
        let a = add_page(lib.path(), &p, &mut idx, "Page A", "", &["Cat A", "cat a", "Category: Cat B"]);
        add_page(lib.path(), &p, &mut idx, "Page B", "", &["Cat B"]);
        assert_eq!(idx.pages[&a].categories, ["Cat A", "Cat B"]);
        // Existing spelling wins.
        let c = add_page(lib.path(), &p, &mut idx, "Page C", "", &["CAT A"]);
        assert_eq!(idx.pages[&c].categories, ["Cat A"]);
        set_parents(&mut idx, "Cat B", &["Cat A".into()]).unwrap();
        assert!(idx.dir.join("categories/Cat B.md").is_file());
        // No loops.
        assert!(set_parents(&mut idx, "Cat A", &["Cat B".into()]).is_err());
        assert!(set_parents(&mut idx, "Cat A", &["Cat A".into()]).is_err());
        let all = list(&idx).unwrap();
        let names: Vec<(&str, usize, usize)> = all.iter().map(|c| (c.name.as_str(), c.pages, c.subcategories)).collect();
        assert_eq!(names, [("Cat A", 2, 1), ("Cat B", 2, 0)]);
        let direct = page_of(&idx, "cat a", false);
        assert_eq!(direct, ["Page A", "Page C"]);
        assert_eq!(page_of(&idx, "Cat A", true), ["Page A", "Page C", "Page B"]);
        assert!(!page(&idx, "Missing", false).unwrap().exists);
        assert!(set_page_categories(lib.path(), &p, &mut idx, &a, &["Bad|name".into()]).is_err());
    }

    fn page_of(idx: &ProjectIndex, name: &str, sub: bool) -> Vec<String> {
        page(idx, name, sub).unwrap().pages.into_iter().map(|m| m.title).collect()
    }

    #[test]
    fn text_and_red_links() {
        let (_lib, _p, mut idx) = setup();
        save_text(&mut idx, "Cat A", "").unwrap();
        assert!(!idx.dir.join("categories").join("Cat A.md").exists());
        assert_eq!(create(&mut idx, "Cat A").unwrap(), "Cat A");
        assert!(page(&idx, "Cat A", false).unwrap().exists);
        save_text(&mut idx, "Cat A", "Own *text*.").unwrap();
        assert_eq!(page(&idx, "Cat A", false).unwrap().text, "Own *text*.");
        assert_eq!(preview(&idx, "cat a").unwrap().text, "Own *text*.");
    }

    #[test]
    fn rename_and_delete_everywhere() {
        let (lib, p, mut idx) = setup();
        let a = add_page(lib.path(), &p, &mut idx, "Page A", "See [[Category:Cat A]] and [[category: cat a|x]].", &["Cat A", "Cat Z"]);
        let b = add_page(lib.path(), &p, &mut idx, "Page B", "", &["Cat A"]);
        set_parents(&mut idx, "Cat B", &["Cat A".into()]).unwrap();
        save_text(&mut idx, "Cat A", "Text [[Category:Cat A]]").unwrap();
        let mut t: Template = serde_json::from_value(serde_json::json!({ "id": "t", "name": "T", "categories": ["Cat A"] })).unwrap();
        set_templates(&idx.dir, &[t.clone()]).unwrap();
        let counts = rename_or_delete(lib.path(), &p, &mut idx, "Cat A", Some("Cat N"), true).unwrap();
        assert_eq!((counts.pages, counts.subcategories, counts.links, counts.linking_pages, counts.templates), (2, 1, 2, 1, 1));
        assert!(rename_or_delete(lib.path(), &p, &mut idx, "Cat A", Some("cat b"), false).is_err());
        rename_or_delete(lib.path(), &p, &mut idx, "Cat A", Some("Cat N"), false).unwrap();
        assert_eq!(idx.pages[&a].categories, ["Cat N", "Cat Z"]);
        assert_eq!(idx.pages[&b].categories, ["Cat N"]);
        let body = pages::read_body(&idx.dir.join("pages"), &a).unwrap();
        assert_eq!(body, "See [[Category:Cat N]] and [[Category:Cat N|x]].");
        assert_eq!(page(&idx, "Cat B", false).unwrap().parents, ["Cat N"]);
        assert_eq!(page(&idx, "Cat N", false).unwrap().text, "Text [[Category:Cat N]]");
        assert!(idx.dir.join("categories/Cat N.md").is_file() && !idx.dir.join("categories/Cat A.md").exists());
        t = projects::templates(&idx.dir).unwrap().remove(0);
        assert_eq!(t.categories, ["Cat N"]);

        rename_or_delete(lib.path(), &p, &mut idx, "Cat N", None, false).unwrap();
        assert_eq!(idx.pages[&a].categories, ["Cat Z"]);
        assert!(page(&idx, "Cat B", false).unwrap().parents.is_empty());
        assert!(projects::templates(&idx.dir).unwrap()[0].categories.is_empty());
        assert!(!page(&idx, "Cat N", false).unwrap().exists);
        assert_eq!(backlinks(lib.path(), &p, &idx, "Cat N", false).unwrap().len(), 1);
    }

    #[test]
    #[ignore]
    fn big_category_speed() {
        use std::time::Instant;
        let (lib, p, _) = setup();
        let dir = lib.path().join(&p);
        for g in 0..50 {
            fs::create_dir_all(dir.join(format!("pages/Group {g}"))).unwrap();
        }
        for i in 0..5000 {
            // "Cat Big" on 2,000 pages, "Cat Rename" on 1,000, plus one of 100 small ones.
            let mut cats = vec![format!("Cat {}", i % 100)];
            if i % 5 < 2 {
                cats.push("Cat Big".into());
            }
            if i % 5 == 4 {
                cats.push("Cat Rename".into());
            }
            let link = if i % 5 == 4 { " [[Category:Cat Rename]]" } else { "" };
            let text = format!("---\ntitle: Page {i}\ncategories: [{}]\n---\nText of page {i}.{link}\n", cats.join(", "));
            fs::write(dir.join(format!("pages/Group {}/Page {i}.md", i % 50)), text).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        drop(idx);
        let t = Instant::now();
        let mut idx = ProjectIndex::open(&dir).unwrap();
        let reopen = t.elapsed();
        println!("reopen (cache): {reopen:?}");
        let t = Instant::now();
        let all = list(&idx).unwrap();
        println!("category list: {:?} ({} categories)", t.elapsed(), all.len());
        let t = Instant::now();
        let big = page(&idx, "Cat Big", false).unwrap();
        println!("category page with {} pages: {:?}", big.pages.len(), t.elapsed());
        assert_eq!(big.pages.len(), 2000);
        let t = Instant::now();
        rename_or_delete(lib.path(), &p, &mut idx, "Cat Rename", Some("Cat Renamed"), false).unwrap();
        let rename = t.elapsed();
        println!("rename on 1,000 pages: {rename:?}");
        assert_eq!(page(&idx, "Cat Renamed", false).unwrap().pages.len(), 1000);
        assert!(reopen.as_millis() < 1000 && rename.as_secs() < 5);
    }
}
