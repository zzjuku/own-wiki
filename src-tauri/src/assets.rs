//! Images in a project's `assets/` folder: importing a file (it's copied in,
//! never linked to its outside location), serving it to the page view
//! through the `wikiasset:` URL scheme, and the smaller copies the page shows
//! instead of big originals (kept in `.cache/thumbs/`, never synced).

use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::UNIX_EPOCH;

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_id, name_taken, to_file_name};
use crate::projects::{ASSETS_DIR, project_dir};

/// Images for infobox fields.
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
/// Images in page text and galleries may also be SVG.
pub const TEXT_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

const THUMBS_DIR: &str = "thumbs";
/// Widths the smaller copies are made in; a request is rounded up to one.
const THUMB_WIDTHS: &[u32] = &[320, 640, 1280, 2560];

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

fn allowed_extension(name: &Path, svg: bool) -> AppResult<String> {
    let list = if svg { TEXT_IMAGE_EXTENSIONS } else { IMAGE_EXTENSIONS };
    extension(name).filter(|e| list.contains(&e.as_str())).ok_or_else(|| {
        AppError::Invalid(if svg {
            "Only PNG, JPG, GIF, WebP and SVG images can be used.".into()
        } else {
            "Only PNG, JPG, GIF and WebP images can be used here.".into()
        })
    })
}

/// Stores `data` in the project's `assets/` folder under a name that follows
/// `name`, and returns the file name there. If the name is taken by a
/// different file, " (2)" etc. is added; the same file imported twice is
/// stored once.
fn store(library: &Path, project: &str, name: &Path, data: &[u8], svg: bool) -> AppResult<String> {
    let ext = allowed_extension(name, svg)?;
    let dir = assets_dir(library, project)?;
    let stem = name.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = to_file_name(&stem).unwrap_or_else(|_| "image".into());
    for n in 1.. {
        let file = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem} ({n}).{ext}") };
        let path = dir.join(&file);
        if path.is_file() && fs::read(&path).is_ok_and(|d| d == data) {
            return Ok(file);
        }
        if !name_taken(&dir, &file)? {
            crate::fsutil::safe_write(&path, data)?;
            return Ok(file);
        }
    }
    unreachable!()
}

/// Copies the image at `source` into the project. `svg`: SVG files are
/// allowed too (page text and galleries, not infobox fields).
pub fn import_image(library: &Path, project: &str, source: &Path, svg: bool) -> AppResult<String> {
    allowed_extension(source, svg)?;
    let data = fs::read(source)?;
    store(library, project, source, &data, svg)
}

/// Stores a pasted image (e.g. a screenshot). `name` is the file name it came
/// with ("image.png"); generic names become "Pasted image".
pub fn import_image_data(library: &Path, project: &str, name: &str, data: &[u8], svg: bool) -> AppResult<String> {
    let path = Path::new(name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().trim().to_lowercase()).unwrap_or_default();
    let ext = extension(path).unwrap_or_else(|| "png".into());
    let name = if stem.is_empty() || stem == "image" || stem == "unknown" {
        format!("Pasted image.{ext}")
    } else {
        name.to_string()
    };
    store(library, project, Path::new(&name), data, svg)
}

pub fn mime_type(name: &str) -> &'static str {
    match extension(Path::new(name)).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

pub fn percent_decode(s: &str) -> String {
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

/// The project folder and file a `wikiasset:` URL path ("/<project>%2F<file>") points to.
pub fn resolve_url_path(library: &Path, url_path: &str) -> AppResult<(PathBuf, PathBuf)> {
    let decoded = percent_decode(url_path.trim_start_matches('/'));
    let (project, file) = decoded
        .split_once('/')
        .ok_or_else(|| AppError::NotFound("Image not found.".into()))?;
    check_id(file)?;
    let dir = project_dir(library, project)?;
    let path = dir.join(ASSETS_DIR).join(file);
    if !path.is_file() {
        return Err(AppError::NotFound("Image not found.".into()));
    }
    Ok((dir, path))
}

/// The width asked for in a `wikiasset:` URL query ("w=640"), if any.
pub fn query_width(query: Option<&str>) -> Option<u32> {
    query?.split('&').find_map(|kv| kv.strip_prefix("w=")?.parse().ok()).filter(|&w| w > 0)
}

// ---- smaller copies for display ----

/// At most this many big images are decoded at once (an 8,000 px image
/// needs a few hundred MB while it's being shrunk).
const MAX_DECODING: usize = 2;
static DECODING: Mutex<usize> = Mutex::new(0);
static DECODED: Condvar = Condvar::new();

struct Slot;
impl Slot {
    fn take() -> Slot {
        let mut n = DECODING.lock().unwrap();
        while *n >= MAX_DECODING {
            n = DECODED.wait(n).unwrap();
        }
        *n += 1;
        Slot
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        *DECODING.lock().unwrap() -= 1;
        DECODED.notify_one();
    }
}

/// The file to show for `image` at about `width` CSS pixels wide (already
/// doubled for sharp screens by the caller): a smaller copy in `.cache/`
/// when the original is wider, else the original. SVG and GIF (animations)
/// are always shown as they are. If a copy can't be made, the original is used.
pub fn display_file(project_dir: &Path, image: &Path, width: u32) -> PathBuf {
    let ext = extension(image).unwrap_or_default();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return image.to_path_buf();
    }
    let width = THUMB_WIDTHS.iter().copied().find(|&w| w >= width).unwrap_or(*THUMB_WIDTHS.last().unwrap());
    match image::image_dimensions(image) {
        Ok((w, _)) if w > width => {}
        _ => return image.to_path_buf(),
    }
    let Ok(meta) = fs::metadata(image) else { return image.to_path_buf() };
    let mut h = DefaultHasher::new();
    image.file_name().hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).hash(&mut h);
    width.hash(&mut h);
    let key = format!("{:016x}-{width}", h.finish());
    let dir = crate::projects::cache_dir(project_dir).join(THUMBS_DIR);
    for e in ["jpg", "png"] {
        let p = dir.join(format!("{key}.{e}"));
        if p.is_file() {
            return p;
        }
    }
    make_copy(image, &dir, &key, width).unwrap_or_else(|| image.to_path_buf())
}

fn make_copy(image: &Path, dir: &Path, key: &str, width: u32) -> Option<PathBuf> {
    let _slot = Slot::take();
    let img = image::ImageReader::open(image).ok()?.with_guessed_format().ok()?.decode().ok()?;
    let small = img.thumbnail(width, u32::MAX);
    let alpha = small.color().has_alpha();
    let mut out = std::io::Cursor::new(Vec::new());
    let path = if alpha {
        small.write_to(&mut out, image::ImageFormat::Png).ok()?;
        dir.join(format!("{key}.png"))
    } else {
        let rgb = small.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88).encode_image(&rgb).ok()?;
        dir.join(format!("{key}.jpg"))
    };
    fs::create_dir_all(dir).ok()?;
    crate::fsutil::safe_write(&path, out.get_ref()).ok()?;
    Some(path)
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
        assert_eq!(import_image(lib.path(), "Project A", &a, false).unwrap(), "Image A.png");
        assert_eq!(import_image(lib.path(), "Project A", &a, false).unwrap(), "Image A.png");
        fs::write(&a, b"two").unwrap();
        assert_eq!(import_image(lib.path(), "Project A", &a, false).unwrap(), "Image A (2).png");
        assert_eq!(fs::read(lib.path().join("Project A/assets/Image A (2).png")).unwrap(), b"two");
        let txt = outside.path().join("notes.txt");
        fs::write(&txt, b"x").unwrap();
        assert!(import_image(lib.path(), "Project A", &txt, true).is_err());
        // SVG only where allowed.
        let svg = outside.path().join("Map A.svg");
        fs::write(&svg, b"<svg/>").unwrap();
        assert!(import_image(lib.path(), "Project A", &svg, false).is_err());
        assert_eq!(import_image(lib.path(), "Project A", &svg, true).unwrap(), "Map A.svg");
    }

    #[test]
    fn pasted_images_get_a_readable_name() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        assert_eq!(import_image_data(lib.path(), "Project A", "image.png", b"a", true).unwrap(), "Pasted image.png");
        assert_eq!(import_image_data(lib.path(), "Project A", "image.png", b"b", true).unwrap(), "Pasted image (2).png");
        assert_eq!(import_image_data(lib.path(), "Project A", "image.png", b"a", true).unwrap(), "Pasted image.png");
        assert_eq!(import_image_data(lib.path(), "Project A", "Shot A.jpg", b"c", true).unwrap(), "Shot A.jpg");
    }

    #[test]
    fn url_paths_resolve_inside_assets_only() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        fs::write(lib.path().join("Project A/assets/Image A.png"), b"x").unwrap();
        let (_, p) = resolve_url_path(lib.path(), "/Project%20A%2FImage%20A.png").unwrap();
        assert!(p.ends_with("assets/Image A.png"));
        assert!(resolve_url_path(lib.path(), "/Project%20A%2F..%2Fproject.json").is_err());
        assert!(resolve_url_path(lib.path(), "/..%2Fx.png").is_err());
        assert!(resolve_url_path(lib.path(), "/Project%20A%2FMissing.png").is_err());
        assert_eq!(mime_type("a.JPG"), "image/jpeg");
        assert_eq!(mime_type("a.svg"), "image/svg+xml");
        assert_eq!(query_width(Some("w=640")), Some(640));
        assert_eq!(query_width(Some("x=1&w=abc")), None);
        assert_eq!(query_width(None), None);
    }

    #[test]
    fn big_images_are_shown_from_a_smaller_copy() {
        let lib = tempfile::tempdir().unwrap();
        create_project(lib.path(), "Project A").unwrap();
        let dir = lib.path().join("Project A");
        let big = dir.join("assets/Big.png");
        image::RgbImage::from_pixel(1000, 500, image::Rgb([10, 20, 30])).save(&big).unwrap();
        let shown = display_file(&dir, &big, 500);
        assert!(shown.starts_with(dir.join(".cache/thumbs")), "{shown:?}");
        assert_eq!(image::image_dimensions(&shown).unwrap(), (640, 320));
        // Asked again: the same copy.
        assert_eq!(display_file(&dir, &big, 600), shown);
        // Wide enough already: the original.
        assert_eq!(display_file(&dir, &big, 1200), big);
        let svg = dir.join("assets/Map.svg");
        fs::write(&svg, b"<svg/>").unwrap();
        assert_eq!(display_file(&dir, &svg, 100), svg);
    }
}
