//! Projects: one folder per wiki inside the library folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_id, move_to_trash, name_taken, safe_write, to_file_name};
use crate::infobox::Template;
use crate::wikilinks::norm;

pub const PROJECT_FILE: &str = "project.json";
pub const PAGES_DIR: &str = "pages";
pub const ASSETS_DIR: &str = "assets";
pub const CACHE_DIR: &str = ".cache";
/// One file per category that has its own text or parent categories.
pub const CATEGORIES_DIR: &str = "categories";
const FORMAT_VERSION: u32 = 1;

/// Contents of `project.json`. Unknown keys are kept, so files written by a
/// newer app version survive a save from an older one.
#[derive(Debug, Serialize, Deserialize)]
struct ProjectFile {
    name: String,
    #[serde(rename = "formatVersion", default = "default_format")]
    format_version: u32,
    #[serde(default)]
    templates: Vec<serde_json::Value>,
    /// Title of the page the project opens on.
    #[serde(rename = "mainPage", default, skip_serializing_if = "Option::is_none")]
    main_page: Option<String>,
    /// Size of the frame every infobox image sits in.
    #[serde(rename = "infoboxImage", default, skip_serializing_if = "Option::is_none")]
    infobox_image: Option<Frame>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn default_format() -> u32 {
    FORMAT_VERSION
}

/// What the UI sees. `id` is the folder name.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
}

pub fn project_dir(library: &Path, id: &str) -> AppResult<PathBuf> {
    check_id(id)?;
    let dir = library.join(id);
    if !dir.join(PROJECT_FILE).is_file() {
        return Err(AppError::NotFound(format!("Project not found: {id}")));
    }
    Ok(dir)
}

fn read_project_file(dir: &Path) -> AppResult<ProjectFile> {
    Ok(serde_json::from_str(&fs::read_to_string(
        dir.join(PROJECT_FILE),
    )?)?)
}

fn write_project_file(dir: &Path, file: &ProjectFile) -> AppResult<()> {
    let mut json = serde_json::to_string_pretty(file)?;
    json.push('\n');
    safe_write(&dir.join(PROJECT_FILE), json.as_bytes())?;
    Ok(())
}

/// The project's main page title, if set.
pub fn main_page(dir: &Path) -> Option<String> {
    read_project_file(dir).ok()?.main_page.filter(|t| !t.trim().is_empty())
}

/// Sets (or with `None` clears) the main page of the project in `dir`.
pub fn set_main_page(dir: &Path, title: Option<&str>) -> AppResult<()> {
    let mut file = read_project_file(dir)?;
    file.main_page = title.map(str::to_string);
    write_project_file(dir, &file)
}

/// Width and height (CSS pixels) of an image frame.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
}

pub const DEFAULT_FRAME: Frame = Frame { width: 250, height: 300 };
const FRAME_MIN: u32 = 40;
const FRAME_MAX: u32 = 1200;

/// The project's infobox image frame (the default if none is set).
pub fn image_frame(dir: &Path) -> AppResult<Frame> {
    Ok(read_project_file(dir)?.infobox_image.unwrap_or(DEFAULT_FRAME))
}

pub fn set_image_frame(dir: &Path, frame: Frame) -> AppResult<()> {
    for v in [frame.width, frame.height] {
        if !(FRAME_MIN..=FRAME_MAX).contains(&v) {
            return Err(AppError::Invalid(format!("Sizes must be between {FRAME_MIN} and {FRAME_MAX} pixels.")));
        }
    }
    let mut file = read_project_file(dir)?;
    file.infobox_image = Some(frame);
    write_project_file(dir, &file)
}

pub const MAIN_PAGE_TITLE: &str = "Main Page";

/// The project's templates. Entries this version can't read are skipped.
pub fn templates(dir: &Path) -> AppResult<Vec<Template>> {
    Ok(read_project_file(dir)?
        .templates
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect())
}

/// Replaces the project's templates. Names must be unique (ignoring case).
/// Entries this version couldn't read are kept as they were.
pub fn set_templates(dir: &Path, list: &[Template]) -> AppResult<()> {
    for (i, t) in list.iter().enumerate() {
        if t.name.trim().is_empty() {
            return Err(AppError::Invalid("A template needs a name.".into()));
        }
        if t.id.trim().is_empty() {
            return Err(AppError::Invalid("A template is missing its id.".into()));
        }
        if list[..i].iter().any(|o| norm(&o.name) == norm(&t.name)) {
            return Err(AppError::Exists(format!("A template named \"{}\" already exists.", t.name.trim())));
        }
        if list[..i].iter().any(|o| o.id == t.id) {
            return Err(AppError::Invalid("Two templates have the same id.".into()));
        }
        for c in &t.categories {
            crate::categories::clean_name(c)?;
        }
    }
    let mut file = read_project_file(dir)?;
    let unreadable: Vec<serde_json::Value> = file
        .templates
        .drain(..)
        .filter(|v| serde_json::from_value::<Template>(v.clone()).is_err())
        .collect();
    file.templates = list.iter().map(serde_json::to_value).collect::<Result<_, _>>()?;
    file.templates.extend(unreadable);
    write_project_file(dir, &file)
}

pub fn list_projects(library: &Path) -> AppResult<Vec<ProjectInfo>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(library)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        let dir = entry.path();
        if id.starts_with('.') || !dir.join(PROJECT_FILE).is_file() {
            continue;
        }
        // A damaged project.json still shows up (under its folder name) so the
        // user can see it rather than have it silently vanish.
        let name = read_project_file(&dir)
            .map(|f| f.name)
            .unwrap_or_else(|_| id.clone());
        out.push(ProjectInfo { id, name });
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    Ok(out)
}

pub fn create_project(library: &Path, name: &str) -> AppResult<ProjectInfo> {
    let name = name.trim();
    let id = to_file_name(name)?;
    if name_taken(library, &id)? {
        return Err(AppError::Exists(format!(
            "A project named \"{id}\" already exists."
        )));
    }
    let dir = library.join(&id);
    fs::create_dir(&dir)?;
    for sub in [PAGES_DIR, ASSETS_DIR, CACHE_DIR] {
        fs::create_dir(dir.join(sub))?;
    }
    write_project_file(
        &dir,
        &ProjectFile {
            name: name.to_string(),
            format_version: FORMAT_VERSION,
            templates: Vec::new(),
            main_page: Some(MAIN_PAGE_TITLE.into()),
            infobox_image: None,
            extra: Default::default(),
        },
    )?;
    // Every new project starts with an empty main page.
    let mut meta = serde_yaml_ng::Mapping::new();
    meta.insert("title".into(), MAIN_PAGE_TITLE.into());
    safe_write(
        &dir.join(PAGES_DIR).join(format!("{MAIN_PAGE_TITLE}.md")),
        crate::pages::serialize(&meta, "")?.as_bytes(),
    )?;
    Ok(ProjectInfo {
        id,
        name: name.to_string(),
    })
}

/// Renames the project and its folder.
pub fn rename_project(library: &Path, id: &str, new_name: &str) -> AppResult<ProjectInfo> {
    let dir = project_dir(library, id)?;
    let new_name = new_name.trim();
    let new_id = to_file_name(new_name)?;
    let same_folder = new_id.to_lowercase() == id.to_lowercase();
    if !same_folder && name_taken(library, &new_id)? {
        return Err(AppError::Exists(format!(
            "A project named \"{new_id}\" already exists."
        )));
    }
    let mut file = read_project_file(&dir)?;
    file.name = new_name.to_string();
    write_project_file(&dir, &file)?;
    if new_id != id {
        fs::rename(&dir, library.join(&new_id))?;
    }
    Ok(ProjectInfo {
        id: new_id,
        name: new_name.to_string(),
    })
}

pub fn delete_project(library: &Path, id: &str) -> AppResult<()> {
    move_to_trash(&project_dir(library, id)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_makes_spec_layout() {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), " Project A ").unwrap();
        assert_eq!(p, ProjectInfo { id: "Project A".into(), name: "Project A".into() });
        let dir = lib.path().join("Project A");
        for sub in [PAGES_DIR, ASSETS_DIR, CACHE_DIR] {
            assert!(dir.join(sub).is_dir(), "{sub}");
        }
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(PROJECT_FILE)).unwrap()).unwrap();
        assert_eq!(json["name"], "Project A");
        assert_eq!(json["formatVersion"], 1);
        assert_eq!(json["templates"], serde_json::json!([]));
        assert_eq!(json["mainPage"], "Main Page");
        assert_eq!(
            fs::read_to_string(dir.join(PAGES_DIR).join("Main Page.md")).unwrap(),
            "---\ntitle: Main Page\n---\n"
        );
        assert_eq!(main_page(&dir).as_deref(), Some("Main Page"));
        set_main_page(&dir, None).unwrap();
        assert_eq!(main_page(&dir), None);
        assert!(!fs::read_to_string(dir.join(PROJECT_FILE)).unwrap().contains("mainPage"));
    }

    #[test]
    fn templates_round_trip_and_keep_unreadable_entries() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        let dir = lib.path().join("Project A");
        let file = dir.join(PROJECT_FILE);
        fs::write(&file, r#"{"name":"Project A","templates":[{"broken":true}],"mainPage":"Main Page"}"#).unwrap();
        assert!(templates(&dir).unwrap().is_empty());
        let t: Template = serde_json::from_value(serde_json::json!({
            "id": "t-1", "name": "Template A", "color": "#cedff2", "starterText": "## Section\n",
            "fields": [{"key": "a", "label": "Field A", "type": "text", "hint": "Help"}]
        }))
        .unwrap();
        set_templates(&dir, &[t.clone()]).unwrap();
        assert_eq!(templates(&dir).unwrap(), [t.clone()]);
        let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(json["templates"][1], serde_json::json!({"broken": true}));
        assert_eq!(json["templates"][0]["starterText"], "## Section\n");
        assert_eq!(json["mainPage"], "Main Page");
        // Names are unique, ignoring case.
        let mut t2 = t.clone();
        t2.id = "t-2".into();
        t2.name = "template a".into();
        assert!(matches!(set_templates(&dir, &[t.clone(), t2]), Err(AppError::Exists(_))));
    }

    #[test]
    fn create_rejects_duplicates_any_case() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        assert!(matches!(
            create_project(lib.path(), "project a"),
            Err(AppError::Exists(_))
        ));
    }

    #[test]
    fn list_ignores_other_folders_and_sorts() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "b project").unwrap();
        create_project(lib.path(), "A project").unwrap();
        fs::create_dir(lib.path().join("Not a project")).unwrap();
        fs::write(lib.path().join("loose file.txt"), "").unwrap();
        let names: Vec<_> = list_projects(lib.path())
            .unwrap()
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, ["A project", "b project"]);
    }

    #[test]
    fn list_shows_damaged_project_by_folder_name() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        fs::write(lib.path().join("Project A").join(PROJECT_FILE), "{ not json").unwrap();
        assert_eq!(list_projects(lib.path()).unwrap()[0].name, "Project A");
    }

    #[test]
    fn rename_moves_folder_and_keeps_unknown_fields() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        let file = lib.path().join("Project A").join(PROJECT_FILE);
        fs::write(&file, r#"{"name":"Project A","formatVersion":1,"templates":[],"futureKey":42}"#)
            .unwrap();
        fs::write(lib.path().join("Project A/pages/Page A.md"), "x").unwrap();

        let p = rename_project(lib.path(), "Project A", "Project B").unwrap();
        assert_eq!(p.id, "Project B");
        assert!(!lib.path().join("Project A").exists());
        let dir = lib.path().join("Project B");
        assert!(dir.join("pages/Page A.md").is_file());
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(PROJECT_FILE)).unwrap()).unwrap();
        assert_eq!(json["name"], "Project B");
        assert_eq!(json["futureKey"], 42);
    }

    #[test]
    fn rename_case_only_and_collisions() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        create_project(lib.path(), "Project B").unwrap();
        assert!(matches!(
            rename_project(lib.path(), "Project A", "project b"),
            Err(AppError::Exists(_))
        ));
        let p = rename_project(lib.path(), "Project A", "project a").unwrap();
        assert_eq!(p.id, "project a");
        assert_eq!(list_projects(lib.path()).unwrap().len(), 2);
    }

    #[test]
    fn delete_removes_folder() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        delete_project(lib.path(), "Project A").unwrap();
        assert!(list_projects(lib.path()).unwrap().is_empty());
        assert!(matches!(
            delete_project(lib.path(), "Project A"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn ids_cannot_escape_library() {
        let lib = tempfile::tempdir().unwrap();
        assert!(project_dir(lib.path(), "..").is_err());
        assert!(project_dir(lib.path(), "../x").is_err());
    }
}
