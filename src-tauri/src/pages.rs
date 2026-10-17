//! Pages: one Markdown file per page somewhere under a project's `pages/`
//! folder, with structured fields in YAML front matter. `title` and `aliases`
//! are used so far; any other fields are preserved untouched.
//!
//! Titles and aliases share one name space: each is unique across the whole
//! project (ignoring case), whatever group a page is in. The file name follows
//! the title; if two different titles map to the same file name in one
//! folder, the second gets " (2)" etc.
//!
//! Functions that check names take `others`: every page of the project with
//! its title and aliases (from the link index).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};

use crate::error::{AppError, AppResult};
use crate::fsutil::{
    check_path_len, check_rel, move_to_trash, name_taken, rel_join, rel_name, rel_parent,
    safe_write, to_file_name, windows_len,
};
use crate::projects::PAGES_DIR;
use crate::tree::{EXT, PageInfo, group_dir, is_page_file, location, pages_dir, title_from_file_name};
use crate::wikilinks::{has_link_chars, norm, rewrite_links};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub group: String,
    pub body: String,
}

/// Splits a page file into its front matter and Markdown body.
pub fn parse(text: &str) -> AppResult<(Mapping, String)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let after_open = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"));
    if let Some(rest) = after_open {
        let mut offset = 0;
        for line in rest.split_inclusive('\n') {
            if line.trim_end_matches(['\r', '\n']) == "---" {
                let yaml = &rest[..offset];
                let body = &rest[offset + line.len()..];
                let map = if yaml.trim().is_empty() {
                    Mapping::new()
                } else {
                    match serde_yaml_ng::from_str::<Value>(yaml)? {
                        Value::Mapping(m) => m,
                        _ => Mapping::new(),
                    }
                };
                return Ok((map, body.to_string()));
            }
            offset += line.len();
        }
    }
    Ok((Mapping::new(), text.to_string()))
}

pub fn serialize(meta: &Mapping, body: &str) -> AppResult<String> {
    // A file that had no front matter keeps having none.
    if meta.is_empty() {
        return Ok(body.to_string());
    }
    let yaml = serde_yaml_ng::to_string(meta)?;
    Ok(format!("---\n{yaml}---\n{body}"))
}

fn scalar_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
    .filter(|s| !s.trim().is_empty())
}

/// The `title:` field, or the file name without ".md".
pub fn meta_title(meta: &Mapping, file_name: &str) -> String {
    meta.get("title").and_then(scalar_text).unwrap_or_else(|| title_from_file_name(file_name))
}

/// The `aliases:` field: a list, or a single name.
pub fn meta_aliases(meta: &Mapping) -> Vec<String> {
    match meta.get("aliases") {
        Some(Value::Sequence(items)) => items.iter().filter_map(scalar_text).map(|s| s.trim().to_string()).collect(),
        Some(v) => scalar_text(v).map(|s| vec![s.trim().to_string()]).unwrap_or_default(),
        None => Vec::new(),
    }
}

fn title_of(meta: &Mapping, file_name: &str) -> String {
    meta_title(meta, file_name)
}

/// Refuses names that break link syntax.
pub fn check_link_chars(name: &str, what: &str) -> AppResult<()> {
    if has_link_chars(name) {
        return Err(AppError::Invalid(format!(
            "{what} can't contain [ ] | or # — links use these characters."
        )));
    }
    Ok(())
}

fn page_path(pages: &Path, id: &str) -> AppResult<PathBuf> {
    check_rel(id)?;
    let path = crate::fsutil::join_rel(pages, id);
    if !is_page_file(rel_name(id)) || !path.is_file() {
        return Err(AppError::NotFound(format!("Page not found: {id}")));
    }
    Ok(path)
}

/// A file name for a page in `dir`, based on `stem`, that no other entry
/// uses. `own` is the page's current file name there, which may be reused.
fn free_file_name(dir: &Path, stem: &str, own: Option<&str>) -> AppResult<String> {
    for n in 1.. {
        let name = if n == 1 {
            format!("{stem}{EXT}")
        } else {
            format!("{stem} ({n}){EXT}")
        };
        let is_own = own.is_some_and(|o| o.to_lowercase() == name.to_lowercase());
        if is_own || !name_taken(dir, &name)? {
            return Ok(name);
        }
    }
    unreachable!()
}

/// Refuses a title or alias that another page in the project already uses
/// as its title or one of its aliases.
pub fn ensure_name_free(others: &[PageInfo], name: &str, except_id: Option<&str>) -> AppResult<()> {
    let wanted = norm(name);
    for p in others.iter().filter(|p| Some(p.id.as_str()) != except_id) {
        if norm(&p.title) == wanted {
            return Err(AppError::Exists(format!(
                "A page named \"{}\" already exists {}.",
                p.title,
                location(&p.group)
            )));
        }
        if let Some(a) = p.aliases.iter().find(|a| norm(a) == wanted) {
            return Err(AppError::Exists(format!(
                "\"{a}\" is already another name (alias) of the page \"{}\" {}.",
                p.title,
                location(&p.group)
            )));
        }
    }
    Ok(())
}

fn check_page_path(project: &str, id: &str, allow_long: bool) -> AppResult<()> {
    let rel = format!("{project}/{PAGES_DIR}/{id}");
    check_path_len(windows_len(&rel), allow_long)
}

fn info(id: String, title: String, aliases: Vec<String>) -> PageInfo {
    let group = rel_parent(&id).to_string();
    PageInfo { id, title, group, aliases }
}

pub fn create_page(
    library: &Path,
    project: &str,
    group: &str,
    title: &str,
    allow_long: bool,
    others: &[PageInfo],
) -> AppResult<PageInfo> {
    let title = title.trim();
    let stem = to_file_name(title)?;
    check_link_chars(title, "Titles")?;
    let pages = pages_dir(library, project)?;
    let dir = group_dir(&pages, group)?;
    ensure_name_free(others, title, None)?;
    let id = rel_join(group, &free_file_name(&dir, &stem, None)?);
    check_page_path(project, &id, allow_long)?;
    let mut meta = Mapping::new();
    meta.insert("title".into(), title.into());
    safe_write(&dir.join(rel_name(&id)), serialize(&meta, "")?.as_bytes())?;
    Ok(info(id, title.to_string(), Vec::new()))
}

pub fn read_page(library: &Path, project: &str, id: &str) -> AppResult<Page> {
    let text = fs::read_to_string(page_path(&pages_dir(library, project)?, id)?)?;
    let (meta, body) = parse(&text)?;
    Ok(Page {
        id: id.to_string(),
        title: title_of(&meta, rel_name(id)),
        group: rel_parent(id).to_string(),
        body,
    })
}

/// Replaces the page's Markdown body, keeping its front matter.
pub fn save_page(library: &Path, project: &str, id: &str, body: &str) -> AppResult<()> {
    let path = page_path(&pages_dir(library, project)?, id)?;
    let (meta, _) = parse(&fs::read_to_string(&path)?)?;
    safe_write(&path, serialize(&meta, body)?.as_bytes())?;
    Ok(())
}

/// Changes the page title and renames its file to match.
pub fn rename_page(
    library: &Path,
    project: &str,
    id: &str,
    new_title: &str,
    allow_long: bool,
    others: &[PageInfo],
) -> AppResult<PageInfo> {
    let new_title = new_title.trim();
    let stem = to_file_name(new_title)?;
    check_link_chars(new_title, "Titles")?;
    let pages = pages_dir(library, project)?;
    let path = page_path(&pages, id)?;
    ensure_name_free(others, new_title, Some(id))?;
    let dir = path.parent().expect("page has a folder").to_path_buf();
    let own = rel_name(id);
    let new_name = free_file_name(&dir, &stem, Some(own))?;
    let new_id = rel_join(rel_parent(id), &new_name);
    check_page_path(project, &new_id, allow_long)?;
    let (mut meta, body) = parse(&fs::read_to_string(&path)?)?;
    meta.insert("title".into(), new_title.into());
    // A new title replaces an alias with the same name.
    let mut aliases = meta_aliases(&meta);
    if aliases.iter().any(|a| norm(a) == norm(new_title)) {
        aliases.retain(|a| norm(a) != norm(new_title));
        set_aliases_meta(&mut meta, &aliases);
    }
    safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
    if new_name != own {
        fs::rename(&path, dir.join(&new_name))?;
    }
    Ok(info(new_id, new_title.to_string(), aliases))
}

/// Moves a page into group `target` ("" = top level). The title stays the same.
pub fn move_page(
    library: &Path,
    project: &str,
    id: &str,
    target: &str,
    allow_long: bool,
    others: &[PageInfo],
) -> AppResult<PageInfo> {
    let pages = pages_dir(library, project)?;
    let path = page_path(&pages, id)?;
    let target_dir = group_dir(&pages, target)?;
    let own = rel_name(id);
    let (meta, _) = parse(&fs::read_to_string(&path)?)?;
    let title = title_of(&meta, own);
    let aliases = meta_aliases(&meta);
    if rel_parent(id) == target {
        return Ok(info(id.to_string(), title, aliases));
    }
    ensure_name_free(others, &title, Some(id))?;
    let new_name = if name_taken(&target_dir, own)? {
        free_file_name(&target_dir, &to_file_name(&title)?, None)?
    } else {
        own.to_string()
    };
    let new_id = rel_join(target, &new_name);
    check_page_path(project, &new_id, allow_long)?;
    fs::rename(&path, target_dir.join(&new_name))?;
    Ok(info(new_id, title, aliases))
}

pub fn delete_page(library: &Path, project: &str, id: &str) -> AppResult<()> {
    move_to_trash(&page_path(&pages_dir(library, project)?, id)?)
}

fn set_aliases_meta(meta: &mut Mapping, aliases: &[String]) {
    if aliases.is_empty() {
        meta.remove("aliases");
    } else {
        let list = aliases.iter().map(|a| Value::String(a.clone())).collect();
        meta.insert("aliases".into(), Value::Sequence(list));
    }
}

/// Replaces the page's aliases. Each must be a valid name that no other page
/// uses as its title or alias, and differ from the page's own title.
pub fn set_aliases(
    library: &Path,
    project: &str,
    id: &str,
    aliases: &[String],
    others: &[PageInfo],
) -> AppResult<PageInfo> {
    let path = page_path(&pages_dir(library, project)?, id)?;
    let (mut meta, body) = parse(&fs::read_to_string(&path)?)?;
    let title = title_of(&meta, rel_name(id));
    let mut clean: Vec<String> = Vec::new();
    for a in aliases {
        let a = a.trim();
        if a.is_empty() {
            continue;
        }
        check_link_chars(a, "Aliases")?;
        if norm(a) == norm(&title) {
            return Err(AppError::Exists(format!("\"{a}\" is already this page's title.")));
        }
        if clean.iter().any(|c| norm(c) == norm(a)) {
            continue;
        }
        ensure_name_free(others, a, Some(id))?;
        clean.push(a.to_string());
    }
    set_aliases_meta(&mut meta, &clean);
    safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
    Ok(info(id.to_string(), title, clean))
}

/// Rewrites links to `old` so they point at `new` in the page `id`, keeping
/// its front matter. Returns how many links changed (0 = file untouched).
pub fn rewrite_page_links(pages: &Path, id: &str, old: &str, new: &str) -> AppResult<usize> {
    let path = page_path(pages, id)?;
    let (meta, body) = parse(&fs::read_to_string(&path)?)?;
    let (body, n) = rewrite_links(&body, old, new);
    if n > 0 {
        safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
    }
    Ok(n)
}

/// Reads lines of a page body (0-based numbers), for "What links here".
pub fn body_lines(pages: &Path, id: &str, lines: &[usize]) -> AppResult<Vec<String>> {
    let (_, body) = parse(&fs::read_to_string(page_path(pages, id)?)?)?;
    let all: Vec<&str> = body.split('\n').collect();
    Ok(lines.iter().filter_map(|&n| all.get(n)).map(|l| l.trim_end_matches('\r').to_string()).collect())
}

/// The page's body, for previews.
pub fn read_body(pages: &Path, id: &str) -> AppResult<String> {
    Ok(parse(&fs::read_to_string(page_path(pages, id)?)?)?.1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;
    use crate::tree::get_tree;

    fn setup() -> (tempfile::TempDir, String) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap();
        // Start without the main page every new project gets.
        fs::remove_file(lib.path().join("Project A/pages/Main Page.md")).unwrap();
        (lib, p.id)
    }

    fn pages(lib: &Path, project: &str) -> PathBuf {
        lib.join(project).join(PAGES_DIR)
    }

    fn raw(lib: &Path, project: &str, id: &str) -> String {
        fs::read_to_string(pages(lib, project).join(id)).unwrap()
    }

    fn mkgroup(lib: &Path, project: &str, rel: &str) {
        fs::create_dir_all(pages(lib, project).join(rel)).unwrap();
    }

    fn others(lib: &Path, p: &str) -> Vec<PageInfo> {
        get_tree(lib, p).unwrap().pages
    }

    fn create(lib: &Path, p: &str, group: &str, title: &str) -> AppResult<PageInfo> {
        create_page(lib, p, group, title, false, &others(lib, p))
    }

    fn titles(lib: &Path, p: &str) -> Vec<(String, String)> {
        get_tree(lib, p).unwrap().pages.into_iter().map(|p| (p.id, p.title)).collect()
    }

    #[test]
    fn create_writes_front_matter() {
        let (lib, p) = setup();
        let page = create(lib.path(), &p, "", "Page A").unwrap();
        assert_eq!(
            page,
            PageInfo { id: "Page A.md".into(), title: "Page A".into(), group: "".into(), aliases: vec![] }
        );
        assert_eq!(raw(lib.path(), &p, "Page A.md"), "---\ntitle: Page A\n---\n");
    }

    #[test]
    fn create_inside_group() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "Group A/Sub");
        let page = create(lib.path(), &p, "Group A/Sub", "Page A").unwrap();
        assert_eq!(page.id, "Group A/Sub/Page A.md");
        assert_eq!(page.group, "Group A/Sub");
        let read = read_page(lib.path(), &p, &page.id).unwrap();
        assert_eq!((read.title.as_str(), read.group.as_str()), ("Page A", "Group A/Sub"));
        assert!(matches!(create(lib.path(), &p, "Missing", "Page B"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn titles_are_unique_across_groups_any_case() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "Group A/Sub");
        create(lib.path(), &p, "Group A/Sub", "Page A").unwrap();
        let err = create(lib.path(), &p, "", "page a").unwrap_err();
        assert!(matches!(err, AppError::Exists(_)));
        assert_eq!(err.to_string(), "A page named \"Page A\" already exists in Group A › Sub.");
        create(lib.path(), &p, "", "Page B").unwrap();
        let err = create(lib.path(), &p, "Group A", "PAGE B").unwrap_err();
        assert_eq!(err.to_string(), "A page named \"Page B\" already exists at the top level.");
    }

    #[test]
    fn different_titles_with_same_file_name_get_numbered_files() {
        let (lib, p) = setup();
        let a = create(lib.path(), &p, "", "A/B").unwrap();
        let b = create(lib.path(), &p, "", "A-B").unwrap();
        assert_eq!((a.id.as_str(), b.id.as_str()), ("A-B.md", "A-B (2).md"));
        assert_eq!(read_page(lib.path(), &p, "A-B (2).md").unwrap().title, "A-B");
    }

    #[test]
    fn title_with_unsafe_chars_keeps_real_title() {
        let (lib, p) = setup();
        let page = create(lib.path(), &p, "", "A/B?").unwrap();
        assert_eq!(page.id, "A-B-.md");
        assert_eq!(read_page(lib.path(), &p, &page.id).unwrap().title, "A/B?");
    }

    #[test]
    fn save_and_read_round_trip() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "G");
        create(lib.path(), &p, "G", "Page A").unwrap();
        let body = "# Heading\n\nSome *text*.\n---\nA line after a rule.\n";
        save_page(lib.path(), &p, "G/Page A.md", body).unwrap();
        let page = read_page(lib.path(), &p, "G/Page A.md").unwrap();
        assert_eq!(page.body, body);
        assert_eq!(page.title, "Page A");
    }

    #[test]
    fn save_keeps_other_front_matter_fields() {
        let (lib, p) = setup();
        let path = pages(lib.path(), &p).join("Page A.md");
        fs::write(&path, "---\ntitle: Page A\nexample field: 7\n---\nold\n").unwrap();
        save_page(lib.path(), &p, "Page A.md", "new\n").unwrap();
        let text = raw(lib.path(), &p, "Page A.md");
        assert!(text.contains("example field: 7"), "{text}");
        assert!(text.ends_with("---\nnew\n"), "{text}");
    }

    #[test]
    fn plain_markdown_without_front_matter() {
        let (lib, p) = setup();
        fs::write(pages(lib.path(), &p).join("Page B.md"), "Just text\n").unwrap();
        let page = read_page(lib.path(), &p, "Page B.md").unwrap();
        assert_eq!(page.title, "Page B");
        assert_eq!(page.body, "Just text\n");
    }

    #[test]
    fn windows_line_endings_and_bom() {
        let (lib, p) = setup();
        let path = pages(lib.path(), &p).join("Page C.md");
        fs::write(&path, "\u{feff}---\r\ntitle: Page C title\r\n---\r\nBody\r\n").unwrap();
        let page = read_page(lib.path(), &p, "Page C.md").unwrap();
        assert_eq!(page.title, "Page C title");
        assert_eq!(page.body, "Body\r\n");
    }

    #[test]
    fn rename_changes_title_and_file() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "G");
        create(lib.path(), &p, "G", "Page A").unwrap();
        save_page(lib.path(), &p, "G/Page A.md", "Body\n").unwrap();
        let page = rename_page(lib.path(), &p, "G/Page A.md", "Page B", false, &others(lib.path(), &p)).unwrap();
        assert_eq!((page.id.as_str(), page.group.as_str()), ("G/Page B.md", "G"));
        assert!(read_page(lib.path(), &p, "G/Page A.md").is_err());
        let read = read_page(lib.path(), &p, "G/Page B.md").unwrap();
        assert_eq!((read.title.as_str(), read.body.as_str()), ("Page B", "Body\n"));
    }

    #[test]
    fn rename_collision_across_groups_and_case_only() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "G");
        create(lib.path(), &p, "", "Page A").unwrap();
        create(lib.path(), &p, "G", "Page B").unwrap();
        let err = rename_page(lib.path(), &p, "Page A.md", "page b", false, &others(lib.path(), &p)).unwrap_err();
        assert_eq!(err.to_string(), "A page named \"Page B\" already exists in G.");
        let page = rename_page(lib.path(), &p, "Page A.md", "page a", false, &others(lib.path(), &p)).unwrap();
        assert_eq!(page.id, "page a.md");
        assert_eq!(titles(lib.path(), &p).len(), 2);
    }

    #[test]
    fn rename_keeps_numbered_file_when_name_still_taken() {
        let (lib, p) = setup();
        create(lib.path(), &p, "", "A/B").unwrap();
        create(lib.path(), &p, "", "A-B").unwrap();
        let page = rename_page(lib.path(), &p, "A-B (2).md", "A?B", false, &others(lib.path(), &p)).unwrap();
        assert_eq!(page.id, "A-B (2).md");
    }

    #[test]
    fn move_between_groups_and_to_top() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "G/Sub");
        create(lib.path(), &p, "", "Page A").unwrap();
        save_page(lib.path(), &p, "Page A.md", "Body\n").unwrap();
        let moved = move_page(lib.path(), &p, "Page A.md", "G/Sub", false, &others(lib.path(), &p)).unwrap();
        assert_eq!(
            moved,
            PageInfo { id: "G/Sub/Page A.md".into(), title: "Page A".into(), group: "G/Sub".into(), aliases: vec![] }
        );
        assert_eq!(read_page(lib.path(), &p, "G/Sub/Page A.md").unwrap().body, "Body\n");
        let back = move_page(lib.path(), &p, "G/Sub/Page A.md", "", false, &others(lib.path(), &p)).unwrap();
        assert_eq!(back.id, "Page A.md");
        // Moving to where it already is changes nothing.
        assert_eq!(move_page(lib.path(), &p, "Page A.md", "", false, &others(lib.path(), &p)).unwrap().id, "Page A.md");
        assert!(move_page(lib.path(), &p, "Page A.md", "Nope", false, &others(lib.path(), &p)).is_err());
    }

    #[test]
    fn move_avoids_file_name_clash() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "G");
        create(lib.path(), &p, "", "A/B").unwrap();
        create(lib.path(), &p, "G", "A-B").unwrap();
        let moved = move_page(lib.path(), &p, "A-B.md", "G", false, &others(lib.path(), &p)).unwrap();
        assert_eq!(moved.id, "G/A-B (2).md");
        assert_eq!(fs::read_dir(pages(lib.path(), &p).join("G")).unwrap().count(), 2);
    }

    #[test]
    fn long_paths_need_permission() {
        let (lib, p) = setup();
        let long = "x".repeat(100);
        mkgroup(lib.path(), &p, &format!("{long}/{long}"));
        let group = format!("{long}/{long}");
        let err = create(lib.path(), &p, &group, "Page A").unwrap_err();
        assert!(matches!(err, AppError::LongPath(_)));
        assert!(titles(lib.path(), &p).is_empty());
        create_page(lib.path(), &p, &group, "Page A", true, &[]).unwrap();

        create(lib.path(), &p, "", "Page B").unwrap();
        assert!(matches!(
            move_page(lib.path(), &p, "Page B.md", &group, false, &others(lib.path(), &p)),
            Err(AppError::LongPath(_))
        ));
        assert!(matches!(
            rename_page(lib.path(), &p, "Page B.md", &"y".repeat(120), false, &others(lib.path(), &p)),
            Ok(_)
        ));
    }

    #[test]
    fn delete_removes_page() {
        let (lib, p) = setup();
        mkgroup(lib.path(), &p, "G");
        create(lib.path(), &p, "G", "Page A").unwrap();
        delete_page(lib.path(), &p, "G/Page A.md").unwrap();
        assert!(titles(lib.path(), &p).is_empty());
    }

    #[test]
    fn ids_cannot_escape_project() {
        let (lib, p) = setup();
        assert!(read_page(lib.path(), &p, "../project.json").is_err());
        assert!(read_page(lib.path(), &p, "G/../../project.json").is_err());
        assert!(read_page(lib.path(), "..", "x.md").is_err());
        assert!(move_page(lib.path(), &p, "x.md", "..", false, &others(lib.path(), &p)).is_err());
    }

    #[test]
    fn link_characters_are_refused() {
        let (lib, p) = setup();
        for bad in ["A [b]", "A|B", "A#B"] {
            let err = create(lib.path(), &p, "", bad).unwrap_err();
            assert_eq!(err.to_string(), "Titles can't contain [ ] | or # — links use these characters.");
        }
        create(lib.path(), &p, "", "Page A").unwrap();
        assert!(rename_page(lib.path(), &p, "Page A.md", "Page#A", false, &others(lib.path(), &p)).is_err());
    }

    #[test]
    fn aliases_share_the_name_space() {
        let (lib, p) = setup();
        create(lib.path(), &p, "", "Page A").unwrap();
        create(lib.path(), &p, "", "Page B").unwrap();
        let o = others(lib.path(), &p);
        let info = set_aliases(lib.path(), &p, "Page A.md", &[" Alias A ".into(), "alias a".into(), "".into()], &o).unwrap();
        assert_eq!(info.aliases, ["Alias A"]);
        assert!(raw(lib.path(), &p, "Page A.md").contains("aliases:\n- Alias A\n"));
        let o = others(lib.path(), &p);
        assert_eq!(o[0].aliases, ["Alias A"]);
        // Taken by another page's title or alias, or this page's own title.
        let err = set_aliases(lib.path(), &p, "Page B.md", &["ALIAS A".into()], &o).unwrap_err();
        assert_eq!(err.to_string(), "\"Alias A\" is already another name (alias) of the page \"Page A\" at the top level.");
        assert!(set_aliases(lib.path(), &p, "Page B.md", &["page a".into()], &o).is_err());
        assert!(set_aliases(lib.path(), &p, "Page B.md", &["Page B".into()], &o).is_err());
        assert!(set_aliases(lib.path(), &p, "Page B.md", &["X|Y".into()], &o).is_err());
        // New titles can't take an alias either.
        assert!(create(lib.path(), &p, "", "alias a").is_err());
        assert!(rename_page(lib.path(), &p, "Page B.md", "Alias A", false, &o).is_err());
        // Renaming a page to its own alias turns the alias into the title.
        let info = rename_page(lib.path(), &p, "Page A.md", "Alias A", false, &o).unwrap();
        assert!(info.aliases.is_empty());
        // Removing all aliases removes the field.
        set_aliases(lib.path(), &p, "Page B.md", &["Other".into()], &others(lib.path(), &p)).unwrap();
        set_aliases(lib.path(), &p, "Page B.md", &[], &others(lib.path(), &p)).unwrap();
        assert!(!raw(lib.path(), &p, "Page B.md").contains("aliases"));
    }

    #[test]
    fn aliases_read_from_list_or_single_value() {
        let (lib, p) = setup();
        fs::write(pages(lib.path(), &p).join("A.md"), "---\ntitle: 1984\naliases: Single\n---\n").unwrap();
        fs::write(pages(lib.path(), &p).join("B.md"), "---\naliases: [x, 7, '']\n---\n").unwrap();
        let o = others(lib.path(), &p);
        assert_eq!((o[0].title.as_str(), o[0].aliases.clone()), ("1984", vec!["Single".to_string()]));
        assert_eq!(o[1].aliases, ["x", "7"]);
    }

    #[test]
    fn rewriting_links_keeps_front_matter() {
        let (lib, p) = setup();
        let path = pages(lib.path(), &p).join("Page A.md");
        fs::write(&path, "---\ntitle: Page A\nextra: 1\n---\n[[Old]] and [[old|x]]\n").unwrap();
        let dir = pages(lib.path(), &p);
        assert_eq!(rewrite_page_links(&dir, "Page A.md", "Old", "New").unwrap(), 2);
        assert_eq!(raw(lib.path(), &p, "Page A.md"), "---\ntitle: Page A\nextra: 1\n---\n[[New]] and [[New|x]]\n");
        assert_eq!(rewrite_page_links(&dir, "Page A.md", "Old", "New").unwrap(), 0);
    }
}
