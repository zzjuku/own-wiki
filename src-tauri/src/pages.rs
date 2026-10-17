//! Pages: one Markdown file per page in a project's `pages/` folder, with
//! structured fields in YAML front matter. M1 only uses the `title` field;
//! any other fields in the front matter are preserved untouched.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_id, move_to_trash, name_taken, safe_write, to_file_name};
use crate::projects::{PAGES_DIR, project_dir};

const EXT: &str = ".md";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PageInfo {
    /// File name inside `pages/`, e.g. "Page A.md".
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub body: String,
}

/// Splits a page file into its front matter and Markdown body.
fn parse(text: &str) -> AppResult<(Mapping, String)> {
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

fn serialize(meta: &Mapping, body: &str) -> AppResult<String> {
    let yaml = serde_yaml_ng::to_string(meta)?;
    Ok(format!("---\n{yaml}---\n{body}"))
}

fn title_of(meta: &Mapping, id: &str) -> String {
    match meta.get("title") {
        Some(Value::String(s)) if !s.trim().is_empty() => s.clone(),
        _ => id.strip_suffix(EXT).unwrap_or(id).to_string(),
    }
}

fn pages_dir(library: &Path, project: &str) -> AppResult<PathBuf> {
    let dir = project_dir(library, project)?.join(PAGES_DIR);
    if !dir.is_dir() {
        fs::create_dir(&dir)?;
    }
    Ok(dir)
}

fn page_path(library: &Path, project: &str, id: &str) -> AppResult<PathBuf> {
    check_id(id)?;
    let path = pages_dir(library, project)?.join(id);
    if !path.is_file() {
        return Err(AppError::NotFound(format!("Page not found: {id}")));
    }
    Ok(path)
}

fn file_name_for(title: &str) -> AppResult<String> {
    Ok(format!("{}{EXT}", to_file_name(title)?))
}

fn is_page_file(name: &str) -> bool {
    !name.starts_with('.') && name.to_lowercase().ends_with(EXT)
}

pub fn list_pages(library: &Path, project: &str) -> AppResult<Vec<PageInfo>> {
    let dir = pages_dir(library, project)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !is_page_file(&id) || !entry.path().is_file() {
            continue;
        }
        // A page with broken front matter is still listed, under its file name.
        let title = fs::read_to_string(entry.path())
            .ok()
            .and_then(|t| parse(&t).ok())
            .map(|(meta, _)| title_of(&meta, &id))
            .unwrap_or_else(|| title_of(&Mapping::new(), &id));
        out.push(PageInfo { id, title });
    }
    out.sort_by_key(|p| p.title.to_lowercase());
    Ok(out)
}

pub fn create_page(library: &Path, project: &str, title: &str) -> AppResult<PageInfo> {
    let title = title.trim();
    let dir = pages_dir(library, project)?;
    let id = file_name_for(title)?;
    if name_taken(&dir, &id)? {
        return Err(AppError::Exists(format!(
            "A page named \"{title}\" already exists."
        )));
    }
    let mut meta = Mapping::new();
    meta.insert("title".into(), title.into());
    safe_write(&dir.join(&id), serialize(&meta, "")?.as_bytes())?;
    Ok(PageInfo {
        id,
        title: title.to_string(),
    })
}

pub fn read_page(library: &Path, project: &str, id: &str) -> AppResult<Page> {
    let text = fs::read_to_string(page_path(library, project, id)?)?;
    let (meta, body) = parse(&text)?;
    Ok(Page {
        id: id.to_string(),
        title: title_of(&meta, id),
        body,
    })
}

/// Replaces the page's Markdown body, keeping its front matter.
pub fn save_page(library: &Path, project: &str, id: &str, body: &str) -> AppResult<()> {
    let path = page_path(library, project, id)?;
    let (meta, _) = parse(&fs::read_to_string(&path)?)?;
    safe_write(&path, serialize(&meta, body)?.as_bytes())?;
    Ok(())
}

/// Changes the page title and renames its file to match.
pub fn rename_page(library: &Path, project: &str, id: &str, new_title: &str) -> AppResult<PageInfo> {
    let path = page_path(library, project, id)?;
    let new_title = new_title.trim();
    let new_id = file_name_for(new_title)?;
    let dir = path.parent().expect("page has a folder").to_path_buf();
    let same_file = new_id.to_lowercase() == id.to_lowercase();
    if !same_file && name_taken(&dir, &new_id)? {
        return Err(AppError::Exists(format!(
            "A page named \"{new_title}\" already exists."
        )));
    }
    let (mut meta, body) = parse(&fs::read_to_string(&path)?)?;
    meta.insert("title".into(), new_title.into());
    safe_write(&path, serialize(&meta, &body)?.as_bytes())?;
    if new_id != id {
        fs::rename(&path, dir.join(&new_id))?;
    }
    Ok(PageInfo {
        id: new_id,
        title: new_title.to_string(),
    })
}

pub fn delete_page(library: &Path, project: &str, id: &str) -> AppResult<()> {
    move_to_trash(&page_path(library, project, id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;

    fn setup() -> (tempfile::TempDir, String) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap();
        (lib, p.id)
    }

    fn raw(lib: &Path, project: &str, id: &str) -> String {
        fs::read_to_string(lib.join(project).join(PAGES_DIR).join(id)).unwrap()
    }

    #[test]
    fn create_writes_front_matter() {
        let (lib, p) = setup();
        let page = create_page(lib.path(), &p, "Page A").unwrap();
        assert_eq!(page, PageInfo { id: "Page A.md".into(), title: "Page A".into() });
        assert_eq!(raw(lib.path(), &p, "Page A.md"), "---\ntitle: Page A\n---\n");
    }

    #[test]
    fn create_rejects_duplicates_any_case() {
        let (lib, p) = setup();
        create_page(lib.path(), &p, "Page A").unwrap();
        assert!(matches!(create_page(lib.path(), &p, "page a"), Err(AppError::Exists(_))));
    }

    #[test]
    fn title_with_unsafe_chars_keeps_real_title() {
        let (lib, p) = setup();
        let page = create_page(lib.path(), &p, "A/B?").unwrap();
        assert_eq!(page.id, "A-B-.md");
        assert_eq!(read_page(lib.path(), &p, &page.id).unwrap().title, "A/B?");
    }

    #[test]
    fn save_and_read_round_trip() {
        let (lib, p) = setup();
        create_page(lib.path(), &p, "Page A").unwrap();
        let body = "# Heading\n\nSome *text*.\n---\nA line after a rule.\n";
        save_page(lib.path(), &p, "Page A.md", body).unwrap();
        let page = read_page(lib.path(), &p, "Page A.md").unwrap();
        assert_eq!(page.body, body);
        assert_eq!(page.title, "Page A");
    }

    #[test]
    fn save_keeps_other_front_matter_fields() {
        let (lib, p) = setup();
        let path = lib.path().join(&p).join(PAGES_DIR).join("Page A.md");
        fs::write(&path, "---\ntitle: Page A\nexample field: 7\n---\nold\n").unwrap();
        save_page(lib.path(), &p, "Page A.md", "new\n").unwrap();
        let text = raw(lib.path(), &p, "Page A.md");
        assert!(text.contains("example field: 7"), "{text}");
        assert!(text.ends_with("---\nnew\n"), "{text}");
    }

    #[test]
    fn plain_markdown_without_front_matter() {
        let (lib, p) = setup();
        let path = lib.path().join(&p).join(PAGES_DIR).join("Page B.md");
        fs::write(&path, "Just text\n").unwrap();
        let page = read_page(lib.path(), &p, "Page B.md").unwrap();
        assert_eq!(page.title, "Page B");
        assert_eq!(page.body, "Just text\n");
    }

    #[test]
    fn windows_line_endings_and_bom() {
        let (lib, p) = setup();
        let path = lib.path().join(&p).join(PAGES_DIR).join("Page C.md");
        fs::write(&path, "\u{feff}---\r\ntitle: Page C title\r\n---\r\nBody\r\n").unwrap();
        let page = read_page(lib.path(), &p, "Page C.md").unwrap();
        assert_eq!(page.title, "Page C title");
        assert_eq!(page.body, "Body\r\n");
    }

    #[test]
    fn list_skips_hidden_and_non_markdown_and_sorts() {
        let (lib, p) = setup();
        create_page(lib.path(), &p, "b page").unwrap();
        create_page(lib.path(), &p, "A page").unwrap();
        let dir = lib.path().join(&p).join(PAGES_DIR);
        fs::write(dir.join(".A page.md.123.tmp"), "").unwrap();
        fs::write(dir.join(".hidden.md"), "").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();
        fs::write(dir.join("Broken.md"), "---\n: : [\n---\nx").unwrap();
        let titles: Vec<_> = list_pages(lib.path(), &p).unwrap().into_iter().map(|p| p.title).collect();
        assert_eq!(titles, ["A page", "b page", "Broken"]);
    }

    #[test]
    fn rename_changes_title_and_file() {
        let (lib, p) = setup();
        create_page(lib.path(), &p, "Page A").unwrap();
        save_page(lib.path(), &p, "Page A.md", "Body\n").unwrap();
        let page = rename_page(lib.path(), &p, "Page A.md", "Page B").unwrap();
        assert_eq!(page.id, "Page B.md");
        assert!(read_page(lib.path(), &p, "Page A.md").is_err());
        let read = read_page(lib.path(), &p, "Page B.md").unwrap();
        assert_eq!((read.title.as_str(), read.body.as_str()), ("Page B", "Body\n"));
    }

    #[test]
    fn rename_collision_and_case_only() {
        let (lib, p) = setup();
        create_page(lib.path(), &p, "Page A").unwrap();
        create_page(lib.path(), &p, "Page B").unwrap();
        assert!(matches!(
            rename_page(lib.path(), &p, "Page A.md", "page b"),
            Err(AppError::Exists(_))
        ));
        let page = rename_page(lib.path(), &p, "Page A.md", "page a").unwrap();
        assert_eq!(page.id, "page a.md");
        assert_eq!(list_pages(lib.path(), &p).unwrap().len(), 2);
    }

    #[test]
    fn delete_removes_page() {
        let (lib, p) = setup();
        create_page(lib.path(), &p, "Page A").unwrap();
        delete_page(lib.path(), &p, "Page A.md").unwrap();
        assert!(list_pages(lib.path(), &p).unwrap().is_empty());
    }

    #[test]
    fn ids_cannot_escape_project() {
        let (lib, p) = setup();
        assert!(read_page(lib.path(), &p, "../project.json").is_err());
        assert!(read_page(lib.path(), "..", "x.md").is_err());
    }
}
