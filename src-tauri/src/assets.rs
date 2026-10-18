//! Images in a project's `assets/` folder: importing a file (it's copied in,
//! never linked to its outside location) and serving it to the page view
//! through the `wikiasset:` URL scheme.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_id, name_taken, to_file_name};
use crate::projects::{ASSETS_DIR, project_dir};

pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

pub fn assets_dir(library: &Path, project: &str) -> AppResult<PathBuf> {
    let dir = project_dir(library, project)?.join(ASSETS_DIR);
    if !dir.is_dir() {
        fs::create_dir(&dir)?;
    }
    Ok(dir)
}

fn extension(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_lowercase())
}

/// Copies the image at `source` into the project's `assets/` folder and
/// returns its file name there. The name follows the original; if it's taken
/// by a different file, " (2)" etc. is added. The same file imported twice is
/// stored once.
pub fn import_image(library: &Path, project: &str, source: &Path) -> AppResult<String> {
    let ext = extension(source).filter(|e| IMAGE_EXTENSIONS.contains(&e.as_str())).ok_or_else(|| {
        AppError::Invalid("Only PNG, JPG, GIF and WebP images can be used.".into())
    })?;
    let data = fs::read(source)?;
    let dir = assets_dir(library, project)?;
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = to_file_name(&stem).unwrap_or_else(|_| "image".into());
    for n in 1.. {
        let name = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem} ({n}).{ext}") };
        let path = dir.join(&name);
        if path.is_file() && fs::read(&path).is_ok_and(|d| d == data) {
            return Ok(name);
        }
        if !name_taken(&dir, &name)? {
            crate::fsutil::safe_write(&path, &data)?;
            return Ok(name);
        }
    }
    unreachable!()
}

pub fn mime_type(name: &str) -> &'static str {
    match extension(Path::new(name)).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The file a `wikiasset:` URL path ("/<project>%2F<file>") points to.
pub fn resolve_url_path(library: &Path, url_path: &str) -> AppResult<PathBuf> {
    let decoded = percent_decode(url_path.trim_start_matches('/'));
    let (project, file) = decoded
        .split_once('/')
        .ok_or_else(|| AppError::NotFound("Image not found.".into()))?;
    check_id(file)?;
    let path = project_dir(library, project)?.join(ASSETS_DIR).join(file);
    if !path.is_file() {
        return Err(AppError::NotFound("Image not found.".into()));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;

    #[test]
    fn import_copies_once_and_numbers_clashes() {
        let lib = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        let a = outside.path().join("Image A.PNG");
        fs::write(&a, b"one").unwrap();
        assert_eq!(import_image(lib.path(), "Project A", &a).unwrap(), "Image A.png");
        assert_eq!(import_image(lib.path(), "Project A", &a).unwrap(), "Image A.png");
        fs::write(&a, b"two").unwrap();
        assert_eq!(import_image(lib.path(), "Project A", &a).unwrap(), "Image A (2).png");
        assert_eq!(fs::read(lib.path().join("Project A/assets/Image A (2).png")).unwrap(), b"two");
        let txt = outside.path().join("notes.txt");
        fs::write(&txt, b"x").unwrap();
        assert!(import_image(lib.path(), "Project A", &txt).is_err());
    }

    #[test]
    fn url_paths_resolve_inside_assets_only() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        fs::write(lib.path().join("Project A/assets/Image A.png"), b"x").unwrap();
        let p = resolve_url_path(lib.path(), "/Project%20A%2FImage%20A.png").unwrap();
        assert!(p.ends_with("assets/Image A.png"));
        assert!(resolve_url_path(lib.path(), "/Project%20A%2F..%2Fproject.json").is_err());
        assert!(resolve_url_path(lib.path(), "/..%2Fx.png").is_err());
        assert!(resolve_url_path(lib.path(), "/Project%20A%2FMissing.png").is_err());
        assert_eq!(mime_type("a.JPG"), "image/jpeg");
    }
}
