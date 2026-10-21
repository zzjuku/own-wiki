//! Moving the library (Settings → Move library…): the wiki's own folders in
//! it (every project folder and `_themes`) are copied into a folder the user
//! chooses, the copy is checked, and the app then uses it. Anything else in
//! the library folder (it may be a whole Documents folder) is left alone, and
//! so is the old copy, as a backup (Juku, 2026-10-21). Caches (`.cache/`)
//! aren't copied; they rebuild.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::fsutil::move_to_trash;
use crate::projects::{CACHE_DIR, PROJECT_FILE};
use crate::themes::APP_THEMES_DIR;

/// The folder made for the library when the chosen folder isn't empty.
const NEW_FOLDER: &str = "Own WIKI";

/// The wiki's own folders in the library: `_themes` and every project.
pub fn wiki_folders(library: &Path) -> io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(library)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if !name.starts_with('.') && path.is_dir() && (name == APP_THEMES_DIR || path.join(PROJECT_FILE).is_file()) {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// Files that aren't copied: caches, Finder's folder notes, half-written temp files.
fn skipped(name: &str) -> bool {
    name == CACHE_DIR || name == ".DS_Store" || (name.starts_with('.') && name.ends_with(".tmp"))
}

/// A folder that holds nothing (Finder's `.DS_Store` doesn't count).
fn is_empty_dir(dir: &Path) -> io::Result<bool> {
    Ok(fs::read_dir(dir)?.flatten().all(|e| e.file_name() == ".DS_Store"))
}

/// Where the library goes when `chosen` is picked: `chosen` itself if it's
/// empty, else a new folder "Own WIKI" in it.
pub fn move_target(library: &Path, chosen: &Path) -> AppResult<PathBuf> {
    if !chosen.is_dir() {
        return Err(AppError::NotFound(format!("Folder not found: {}", chosen.display())));
    }
    let library = library.canonicalize()?;
    let chosen = chosen.canonicalize()?;
    if chosen == library {
        return Err(AppError::Invalid("That is the library folder itself. Choose another folder.".into()));
    }
    let target = if is_empty_dir(&chosen)? {
        chosen
    } else {
        let t = chosen.join(NEW_FOLDER);
        if t.exists() {
            return Err(AppError::Exists(format!(
                "There is already a folder named \u{201c}{NEW_FOLDER}\u{201d} there. Choose another place, or an empty folder."
            )));
        }
        t
    };
    if wiki_folders(&library)?.iter().any(|f| target.starts_with(f)) {
        return Err(AppError::Invalid("The library can't be moved into one of its own folders. Choose a folder outside them.".into()));
    }
    Ok(target)
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize)]
pub struct Count {
    pub files: u64,
    pub bytes: u64,
}

fn copy_dir(from: &Path, to: &Path, count: &mut Count) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if skipped(&name.to_string_lossy()) {
            continue;
        }
        let kind = entry.file_type()?;
        let dest = to.join(&name);
        if kind.is_dir() {
            copy_dir(&entry.path(), &dest, count)?;
        } else if kind.is_file() {
            count.bytes += fs::copy(entry.path(), &dest)?;
            count.files += 1;
        }
    }
    Ok(())
}

fn count_dir(dir: &Path, count: &mut Count) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if skipped(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_dir() {
            count_dir(&entry.path(), count)?;
        } else if kind.is_file() {
            count.files += 1;
            count.bytes += entry.metadata()?.len();
        }
    }
    Ok(())
}

/// Copies the library's own folders into `target` (from [`move_target`]) and
/// checks the copy. On failure whatever was copied is put in the Trash, and
/// the library stays where it was.
pub fn copy_library(library: &Path, target: &Path) -> AppResult<Count> {
    let created = !target.exists();
    let folders = wiki_folders(library)?;
    let mut copied = Count::default();
    let mut copy = || -> io::Result<()> {
        fs::create_dir_all(target)?;
        for f in &folders {
            copy_dir(f, &target.join(f.file_name().unwrap_or_default()), &mut copied)?;
        }
        Ok(())
    };
    let result = copy().map_err(AppError::from).and_then(|_| {
        let mut source = Count::default();
        let mut check = Count::default();
        for f in &folders {
            count_dir(f, &mut source)?;
        }
        count_dir(target, &mut check)?;
        if source != check || check != copied {
            return Err(AppError::Invalid(
                "The copy didn't come out complete (files changed while copying?). Nothing was changed; try again.".into(),
            ));
        }
        Ok(copied)
    });
    if result.is_err() {
        // Clean up the partial copy: the new folder, or what was put into the empty one.
        if created {
            let _ = move_to_trash(target);
        } else if let Ok(list) = fs::read_dir(target) {
            for e in list.flatten().filter(|e| e.file_name() != ".DS_Store") {
                let _ = move_to_trash(&e.path());
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn library() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let lib = tmp.path().join("Own WIKI");
        write(&lib.join("Project A/project.json"), "{}");
        write(&lib.join("Project A/pages/Group A/Page A.md"), "Text A");
        write(&lib.join("Project A/assets/Picture A.png"), "png");
        write(&lib.join("Project A/.cache/link-index.json"), "cache");
        write(&lib.join("_themes/Theme A/theme.json"), "{}");
        write(&lib.join(".DS_Store"), "x");
        // Not the wiki's: other documents in the same folder.
        write(&lib.join("Letter.txt"), "letter");
        write(&lib.join("Photos/Photo.jpg"), "jpg");
        (tmp, lib)
    }

    #[test]
    fn copies_into_a_new_folder_or_an_empty_one() {
        let (tmp, lib) = library();
        let drive = tmp.path().join("Drive");
        write(&drive.join("Other.txt"), "other");
        let target = move_target(&lib, &drive).unwrap();
        assert_eq!(target, drive.canonicalize().unwrap().join("Own WIKI"));
        let count = copy_library(&lib, &target).unwrap();
        assert_eq!(count.files, 4);
        // Only the projects and themes go along.
        assert!(!target.join("Letter.txt").exists());
        assert!(!target.join("Photos").exists());
        assert_eq!(fs::read_to_string(target.join("Project A/pages/Group A/Page A.md")).unwrap(), "Text A");
        assert!(target.join("_themes/Theme A/theme.json").is_file());
        assert!(!target.join("Project A/.cache").exists());
        // The old library stays as it was.
        assert!(lib.join("Project A/pages/Group A/Page A.md").is_file());

        // An empty folder is used as it is.
        let empty = tmp.path().join("Empty");
        fs::create_dir(&empty).unwrap();
        assert_eq!(move_target(&lib, &empty).unwrap(), empty.canonicalize().unwrap());
    }

    #[test]
    fn refuses_bad_places() {
        let (tmp, lib) = library();
        // Already has a folder of that name.
        let drive = tmp.path().join("Drive");
        write(&drive.join("Own WIKI/x.txt"), "x");
        assert!(matches!(move_target(&lib, &drive), Err(AppError::Exists(_))));
        // The library itself, or inside a project.
        assert!(move_target(&lib, &lib).is_err());
        assert!(move_target(&lib, &lib.join("Project A")).is_err());
        assert!(move_target(&lib, &tmp.path().join("Missing")).is_err());
        // A folder next to the projects (e.g. Documents/Wiki) is fine.
        let inside = lib.join("Photos");
        assert_eq!(move_target(&lib, &inside).unwrap(), inside.canonicalize().unwrap().join("Own WIKI"));
    }
}
