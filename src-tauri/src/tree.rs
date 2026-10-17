//! The project's page tree: groups are folders inside `pages/` (nested
//! allowed), pages are the Markdown files in them. Ids sent to the UI are
//! paths relative to `pages/`, separated by `/` on every platform
//! ("Group A/Sub/Page A.md"); the top level is the empty string.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_rel, join_rel};
use crate::projects::{PAGES_DIR, project_dir};

pub const EXT: &str = ".md";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PageInfo {
    /// Path inside `pages/`, e.g. "Group A/Page A.md".
    pub id: String,
    pub title: String,
    /// Id of the group the page is in ("" = top level).
    pub group: String,
    /// Other names that link to the page (front matter `aliases:`).
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GroupInfo {
    /// Path inside `pages/`, e.g. "Group A/Sub".
    pub id: String,
    /// The folder name.
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tree {
    pub groups: Vec<GroupInfo>,
    pub pages: Vec<PageInfo>,
    /// Title of the project's main page, if one is set.
    pub main_page: Option<String>,
}

pub fn pages_dir(library: &Path, project: &str) -> AppResult<PathBuf> {
    let dir = project_dir(library, project)?.join(PAGES_DIR);
    if !dir.is_dir() {
        fs::create_dir(&dir)?;
    }
    Ok(dir)
}

/// The folder of group `group` ("" = top level). It must exist.
pub fn group_dir(pages: &Path, group: &str) -> AppResult<PathBuf> {
    if group.is_empty() {
        return Ok(pages.to_path_buf());
    }
    check_rel(group)?;
    let dir = join_rel(pages, group);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("Group not found: {}", display_group(group))));
    }
    Ok(dir)
}

/// "Group A › Sub" for messages.
pub fn display_group(group: &str) -> String {
    group.replace('/', " › ")
}

/// "at the top level" / "in Group A › Sub" for messages.
pub fn location(group: &str) -> String {
    if group.is_empty() {
        "at the top level".into()
    } else {
        format!("in {}", display_group(group))
    }
}

pub fn is_page_file(name: &str) -> bool {
    !name.starts_with('.') && name.to_lowercase().ends_with(EXT)
}

pub fn title_from_file_name(name: &str) -> String {
    name.get(..name.len().saturating_sub(EXT.len()))
        .filter(|_| name.to_lowercase().ends_with(EXT))
        .unwrap_or(name)
        .to_string()
}

/// Every group and page of a project, read fresh. The app itself keeps one
/// link index open instead (see lib.rs); this is for tests.
#[cfg(test)]
pub fn get_tree(library: &Path, project: &str) -> AppResult<Tree> {
    let dir = project_dir(library, project)?;
    pages_dir(library, project)?;
    let index = crate::index::ProjectIndex::open(&dir)?;
    Ok(Tree { groups: index.groups.clone(), pages: index.page_infos(), main_page: crate::projects::main_page(&dir) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;

    #[test]
    fn scan_finds_nested_groups_and_pages() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        let pages = lib.path().join("Project A").join(PAGES_DIR);
        fs::remove_file(pages.join("Main Page.md")).unwrap();
        fs::create_dir_all(pages.join("Group A/Sub")).unwrap();
        fs::create_dir_all(pages.join("Empty")).unwrap();
        fs::create_dir_all(pages.join(".hidden")).unwrap();
        fs::write(pages.join("Top.md"), "---\ntitle: Top title\n---\nbody").unwrap();
        fs::write(pages.join("Group A/Sub/Deep.md"), "no front matter").unwrap();
        fs::write(pages.join("Group A/notes.txt"), "").unwrap();
        fs::write(pages.join("Group A/.Deep.md.1.tmp"), "").unwrap();

        let tree = get_tree(lib.path(), "Project A").unwrap();
        let groups: Vec<_> = tree.groups.iter().map(|g| (g.id.as_str(), g.name.as_str())).collect();
        assert_eq!(groups, [("Empty", "Empty"), ("Group A", "Group A"), ("Group A/Sub", "Sub")]);
        let pages: Vec<_> = tree
            .pages
            .iter()
            .map(|p| (p.id.as_str(), p.title.as_str(), p.group.as_str()))
            .collect();
        assert_eq!(
            pages,
            [("Group A/Sub/Deep.md", "Deep", "Group A/Sub"), ("Top.md", "Top title", "")]
        );
    }

    #[test]
    fn titles_from_front_matter_or_file_name() {
        let dir = tempfile::tempdir().unwrap();
        let cases = [
            ("a.md", "---\ntitle: Real\n---\n", "Real"),
            ("b.md", "\u{feff}---\r\ntitle: Win\r\n---\r\n", "Win"),
            ("c.md", "---\ntitle: never closed\n", "c"),
            ("d.md", "---\n: : [\n---\n", "d"),
            ("e.md", "---\ntitle: \"  \"\n---\n", "e"),
            ("F.MD", "text", "F"),
        ];
        for (name, text, want) in cases {
            let path = dir.path().join(name);
            fs::write(&path, text).unwrap();
            assert_eq!(crate::index::read_entry(&path, name).unwrap().title, want, "{name}");
        }
    }

    #[test]
    fn group_dir_checks() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("G")).unwrap();
        assert_eq!(group_dir(dir.path(), "").unwrap(), dir.path());
        assert!(group_dir(dir.path(), "G").is_ok());
        assert!(matches!(group_dir(dir.path(), "Missing"), Err(AppError::NotFound(_))));
        assert!(group_dir(dir.path(), "../x").is_err());
        assert_eq!(location(""), "at the top level");
        assert_eq!(location("A/B"), "in A › B");
    }
}
