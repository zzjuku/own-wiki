//! The project's page tree: groups are folders inside `pages/` (nested
//! allowed), pages are the Markdown files in them. Ids sent to the UI are
//! paths relative to `pages/`, separated by `/` on every platform
//! ("Group A/Sub/Page A.md"); the top level is the empty string.

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_yaml_ng::Value;

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_rel, join_rel, rel_join};
use crate::projects::{PAGES_DIR, project_dir};

pub const EXT: &str = ".md";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PageInfo {
    /// Path inside `pages/`, e.g. "Group A/Page A.md".
    pub id: String,
    pub title: String,
    /// Id of the group the page is in ("" = top level).
    pub group: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GroupInfo {
    /// Path inside `pages/`, e.g. "Group A/Sub".
    pub id: String,
    /// The folder name.
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Tree {
    pub groups: Vec<GroupInfo>,
    pub pages: Vec<PageInfo>,
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

/// Reads only a page's front matter to get its title, so listing thousands
/// of pages doesn't read their bodies. Falls back to the file name.
pub fn read_title(path: &Path, file_name: &str) -> String {
    front_matter_title(path).unwrap_or_else(|| title_from_file_name(file_name))
}

fn front_matter_title(path: &Path) -> Option<String> {
    let mut reader = BufReader::new(File::open(path).ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let first = line.strip_prefix('\u{feff}').unwrap_or(&line);
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return None;
    }
    let mut yaml = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            return None; // never closed: not front matter
        }
        if line.trim_end_matches(['\r', '\n']) == "---" {
            break;
        }
        yaml.push_str(&line);
    }
    match serde_yaml_ng::from_str::<Value>(&yaml).ok()? {
        Value::Mapping(m) => match m.get("title") {
            Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
            _ => None,
        },
        _ => None,
    }
}

/// Every group and page under `pages`. Hidden entries (temp files etc.) are
/// skipped. Sorted by id so results are stable; the UI does its own ordering.
pub fn scan(pages: &Path) -> AppResult<Tree> {
    let mut tree = Tree::default();
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
                tree.groups.push(GroupInfo { id, name });
            } else if kind.is_file() && is_page_file(&name) {
                tree.pages.push(PageInfo {
                    id: rel_join(&group, &name),
                    title: read_title(&entry.path(), &name),
                    group: group.clone(),
                });
            }
        }
    }
    tree.groups.sort_by(|a, b| a.id.cmp(&b.id));
    tree.pages.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(tree)
}

pub fn get_tree(library: &Path, project: &str) -> AppResult<Tree> {
    scan(&pages_dir(library, project)?)
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
    fn titles_from_front_matter_only() {
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
            assert_eq!(read_title(&path, name), want, "{name}");
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
