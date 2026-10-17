//! Groups: folders inside a project's `pages/` folder, nested to any depth.
//! A group's name is its folder name; names are unique among siblings
//! (ignoring case). Moves never merge folders.

use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::fsutil::{
    check_path_len, longest_inside, move_to_trash, name_taken, rel_join, rel_name, rel_parent,
    to_file_name, windows_len,
};
use crate::projects::PAGES_DIR;
use crate::tree::{GroupInfo, group_dir, location, pages_dir};

fn exists_error(name: &str, parent: &str) -> AppError {
    AppError::Exists(format!(
        "A group named \"{name}\" already exists {}.",
        location(parent)
    ))
}

fn info(id: String) -> GroupInfo {
    let name = rel_name(&id).to_string();
    GroupInfo { id, name }
}

/// Checks the longest path the group would contain at `new_id`.
fn check_group_path(project: &str, new_id: &str, dir: &Path, allow_long: bool) -> AppResult<()> {
    let own = windows_len(&format!("{project}/{PAGES_DIR}/{new_id}"));
    check_path_len(own + longest_inside(dir)?, allow_long)
}

/// Group ids sent by the UI must name an existing group (not the top level).
fn existing_group(pages: &Path, id: &str) -> AppResult<std::path::PathBuf> {
    if id.is_empty() {
        return Err(AppError::Invalid("The top level isn't a group.".into()));
    }
    group_dir(pages, id)
}

pub fn create_group(
    library: &Path,
    project: &str,
    parent: &str,
    name: &str,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    let folder = to_file_name(name)?;
    let pages = pages_dir(library, project)?;
    let parent_dir = group_dir(&pages, parent)?;
    if name_taken(&parent_dir, &folder)? {
        return Err(exists_error(&folder, parent));
    }
    let id = rel_join(parent, &folder);
    check_path_len(windows_len(&format!("{project}/{PAGES_DIR}/{id}")), allow_long)?;
    fs::create_dir(parent_dir.join(&folder))?;
    Ok(info(id))
}

pub fn rename_group(
    library: &Path,
    project: &str,
    id: &str,
    name: &str,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    let folder = to_file_name(name)?;
    let pages = pages_dir(library, project)?;
    let dir = existing_group(&pages, id)?;
    let parent = rel_parent(id);
    let own = rel_name(id);
    if folder.to_lowercase() != own.to_lowercase() && name_taken(&group_dir(&pages, parent)?, &folder)? {
        return Err(exists_error(&folder, parent));
    }
    let new_id = rel_join(parent, &folder);
    check_group_path(project, &new_id, &dir, allow_long)?;
    if folder != own {
        fs::rename(&dir, dir.with_file_name(&folder))?;
    }
    Ok(info(new_id))
}

/// Moves group `id` into group `target` ("" = top level).
pub fn move_group(
    library: &Path,
    project: &str,
    id: &str,
    target: &str,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    let pages = pages_dir(library, project)?;
    let dir = existing_group(&pages, id)?;
    let target_dir = group_dir(&pages, target)?;
    if target == id || target.starts_with(&format!("{id}/")) {
        return Err(AppError::Invalid(
            "A group can't be moved into itself or one of its own subgroups.".into(),
        ));
    }
    if rel_parent(id) == target {
        return Ok(info(id.to_string()));
    }
    let name = rel_name(id);
    if name_taken(&target_dir, name)? {
        return Err(AppError::Exists(format!(
            "A group named \"{name}\" already exists {}. Rename one of them first.",
            location(target)
        )));
    }
    let new_id = rel_join(target, name);
    check_group_path(project, &new_id, &dir, allow_long)?;
    fs::rename(&dir, target_dir.join(name))?;
    Ok(info(new_id))
}

/// Moves the group and everything in it to the Trash.
pub fn delete_group(library: &Path, project: &str, id: &str) -> AppResult<()> {
    let pages = pages_dir(library, project)?;
    move_to_trash(&existing_group(&pages, id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::create_page;
    use crate::projects::create_project;
    use crate::tree::get_tree;

    fn setup() -> (tempfile::TempDir, String) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap();
        (lib, p.id)
    }

    fn ids(lib: &Path, p: &str) -> (Vec<String>, Vec<String>) {
        let t = get_tree(lib, p).unwrap();
        (
            t.groups.into_iter().map(|g| g.id).collect(),
            t.pages.into_iter().map(|p| p.id).collect(),
        )
    }

    #[test]
    fn create_nested_and_empty() {
        let (lib, p) = setup();
        let a = create_group(lib.path(), &p, "", "Group A", false).unwrap();
        assert_eq!(a, GroupInfo { id: "Group A".into(), name: "Group A".into() });
        let sub = create_group(lib.path(), &p, "Group A", " Sub/1 ", false).unwrap();
        assert_eq!(sub, GroupInfo { id: "Group A/Sub-1".into(), name: "Sub-1".into() });
        create_group(lib.path(), &p, "Group A/Sub-1", "Deep", false).unwrap();
        assert_eq!(ids(lib.path(), &p).0, ["Group A", "Group A/Sub-1", "Group A/Sub-1/Deep"]);
        assert!(create_group(lib.path(), &p, "Missing", "X", false).is_err());
    }

    #[test]
    fn sibling_names_unique_any_case() {
        let (lib, p) = setup();
        create_group(lib.path(), &p, "", "Group A", false).unwrap();
        let err = create_group(lib.path(), &p, "", "group a", false).unwrap_err();
        assert_eq!(err.to_string(), "A group named \"group a\" already exists at the top level.");
        // Same name under a different parent is fine.
        create_group(lib.path(), &p, "Group A", "Group A", false).unwrap();
    }

    #[test]
    fn rename_keeps_contents() {
        let (lib, p) = setup();
        create_group(lib.path(), &p, "", "Group A", false).unwrap();
        create_group(lib.path(), &p, "", "Group B", false).unwrap();
        create_group(lib.path(), &p, "Group A", "Sub", false).unwrap();
        create_page(lib.path(), &p, "Group A/Sub", "Page A", false).unwrap();
        assert!(matches!(
            rename_group(lib.path(), &p, "Group A", "GROUP B", false),
            Err(AppError::Exists(_))
        ));
        let g = rename_group(lib.path(), &p, "Group A", "Group C", false).unwrap();
        assert_eq!(g.id, "Group C");
        assert_eq!(ids(lib.path(), &p).1, ["Group C/Sub/Page A.md"]);
        let g = rename_group(lib.path(), &p, "Group C", "group c", false).unwrap();
        assert_eq!(g.id, "group c");
        assert_eq!(ids(lib.path(), &p).1, ["group c/Sub/Page A.md"]);
        assert!(rename_group(lib.path(), &p, "", "X", false).is_err());
    }

    #[test]
    fn move_into_other_group_and_back() {
        let (lib, p) = setup();
        create_group(lib.path(), &p, "", "Group A", false).unwrap();
        create_group(lib.path(), &p, "", "Group B", false).unwrap();
        create_page(lib.path(), &p, "Group A", "Page A", false).unwrap();
        let g = move_group(lib.path(), &p, "Group A", "Group B", false).unwrap();
        assert_eq!(g.id, "Group B/Group A");
        assert_eq!(ids(lib.path(), &p).1, ["Group B/Group A/Page A.md"]);
        let g = move_group(lib.path(), &p, "Group B/Group A", "", false).unwrap();
        assert_eq!(g.id, "Group A");
        assert_eq!(move_group(lib.path(), &p, "Group A", "", false).unwrap().id, "Group A");
    }

    #[test]
    fn move_into_itself_is_blocked() {
        let (lib, p) = setup();
        create_group(lib.path(), &p, "", "Group A", false).unwrap();
        create_group(lib.path(), &p, "Group A", "Sub", false).unwrap();
        create_group(lib.path(), &p, "", "Group AB", false).unwrap();
        for target in ["Group A", "Group A/Sub"] {
            assert!(matches!(
                move_group(lib.path(), &p, "Group A", target, false),
                Err(AppError::Invalid(_))
            ));
        }
        // A sibling whose name merely starts the same is a valid target.
        assert!(move_group(lib.path(), &p, "Group A", "Group AB", false).is_ok());
    }

    #[test]
    fn move_refuses_name_collision() {
        let (lib, p) = setup();
        create_group(lib.path(), &p, "", "Group A", false).unwrap();
        create_group(lib.path(), &p, "", "Group B", false).unwrap();
        create_group(lib.path(), &p, "Group B", "group a", false).unwrap();
        let err = move_group(lib.path(), &p, "Group A", "Group B", false).unwrap_err();
        assert_eq!(
            err.to_string(),
            "A group named \"Group A\" already exists in Group B. Rename one of them first."
        );
        assert_eq!(ids(lib.path(), &p).0, ["Group A", "Group B", "Group B/group a"]);
    }

    #[test]
    fn long_paths_count_contents() {
        let (lib, p) = setup();
        let long = "x".repeat(100);
        create_group(lib.path(), &p, "", "Short", false).unwrap();
        create_group(lib.path(), &p, "Short", &long, false).unwrap();
        create_page(lib.path(), &p, &format!("Short/{long}"), &"y".repeat(50), false).unwrap();
        // Renaming the outer group to a long name makes the page's path too long.
        assert!(matches!(
            rename_group(lib.path(), &p, "Short", &"z".repeat(40), false),
            Err(AppError::LongPath(_))
        ));
        assert!(rename_group(lib.path(), &p, "Short", &"z".repeat(40), true).is_ok());
        create_group(lib.path(), &p, "", &"w".repeat(40), false).unwrap();
        let w = "w".repeat(40);
        let z = "z".repeat(40);
        assert!(matches!(
            move_group(lib.path(), &p, &z, &w, false),
            Err(AppError::LongPath(_))
        ));
    }

    #[test]
    fn delete_takes_contents() {
        let (lib, p) = setup();
        create_group(lib.path(), &p, "", "Group A", false).unwrap();
        create_group(lib.path(), &p, "Group A", "Sub", false).unwrap();
        create_page(lib.path(), &p, "Group A/Sub", "Page A", false).unwrap();
        create_page(lib.path(), &p, "", "Page B", false).unwrap();
        delete_group(lib.path(), &p, "Group A").unwrap();
        let (groups, pages) = ids(lib.path(), &p);
        assert!(groups.is_empty());
        assert_eq!(pages, ["Page B.md"]);
        assert!(delete_group(lib.path(), &p, "").is_err());
        assert!(delete_group(lib.path(), &p, "..").is_err());
    }
}
