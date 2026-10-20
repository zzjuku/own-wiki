//! Font files of themes (M8). A font a theme uses is always copied into the
//! theme's `fonts/` folder, so the theme looks the same on Mac and Windows.
//! Fonts come from files the user picks, or from the fonts installed on this
//! computer (whole family: regular, bold, italic…).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::fsutil::{check_id, name_taken, safe_write, to_file_name};
use crate::themes::FONTS_DIR;

const EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2"];

/// One font file inside a theme, as the page loads it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FontFile {
    pub family: String,
    /// File name inside the theme's `fonts/`.
    pub file: String,
    /// CSS font-weight: "400", or a range for variable fonts ("100 900").
    pub weight: String,
    /// "normal" or "italic".
    pub style: String,
}

/// One face of a font installed on this computer.
#[derive(Debug, Clone)]
pub struct InstalledFace {
    pub family: String,
    pub path: PathBuf,
    /// Face number inside a collection file (.ttc), else 0.
    pub index: u32,
    pub weight: String,
    pub style: String,
    /// PostScript-ish name, used for the copied file's name.
    pub name: String,
}

struct Meta {
    family: String,
    weight: String,
    style: String,
    name: String,
}

fn extension(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_lowercase())
}

/// Family, weight and style read from a TrueType/OpenType face.
fn read_meta(data: &[u8], index: u32) -> Option<Meta> {
    let face = ttf_parser::Face::parse(data, index).ok()?;
    let name_of = |id: u16| {
        let names = face.names();
        let mut fallback = None;
        for n in names.into_iter().filter(|n| n.name_id == id) {
            let Some(text) = n.to_string().or_else(|| mac_roman(&n)) else { continue };
            if n.language_id == 0x0409 || n.platform_id == ttf_parser::PlatformId::Unicode {
                return Some(text);
            }
            fallback.get_or_insert(text);
        }
        fallback
    };
    let family = name_of(ttf_parser::name_id::TYPOGRAPHIC_FAMILY).or_else(|| name_of(ttf_parser::name_id::FAMILY))?;
    let sub = name_of(ttf_parser::name_id::TYPOGRAPHIC_SUBFAMILY)
        .or_else(|| name_of(ttf_parser::name_id::SUBFAMILY))
        .unwrap_or_default();
    let weight = face
        .variation_axes()
        .into_iter()
        .find(|a| a.tag == ttf_parser::Tag::from_bytes(b"wght"))
        .map(|a| format!("{} {}", a.min_value.round(), a.max_value.round()))
        .unwrap_or_else(|| face.weight().to_number().to_string());
    let style = if face.is_italic() || face.is_oblique() { "italic" } else { "normal" }.to_string();
    let name = if sub.is_empty() { family.clone() } else { format!("{family} {sub}") };
    Some(Meta { family: family.trim().to_string(), weight, style, name })
}

/// Old Mac fonts store names in the Mac Roman encoding, which ttf-parser leaves undecoded.
fn mac_roman(n: &ttf_parser::name::Name) -> Option<String> {
    const HIGH: &str = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\u{F8FF}ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
    if n.platform_id != ttf_parser::PlatformId::Macintosh || n.encoding_id != 0 {
        return None;
    }
    let high: Vec<char> = HIGH.chars().collect();
    Some(n.name.iter().map(|&b| if b < 128 { b as char } else { high.get(b as usize - 128).copied().unwrap_or('?') }).collect())
}

/// For WOFF files (compressed, not read here): family and style from the file name.
fn meta_from_file_name(path: &Path) -> Meta {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let lower = stem.to_lowercase();
    let italic = lower.contains("italic") || lower.contains("oblique");
    let weight = [("thin", 100), ("extralight", 200), ("light", 300), ("medium", 500), ("semibold", 600), ("extrabold", 800), ("black", 900), ("bold", 700)]
        .iter()
        .find(|(w, _)| lower.replace(['-', '_', ' '], "").contains(w))
        .map(|(_, n)| *n)
        .unwrap_or(400);
    let family = stem
        .split(['-', '_'])
        .next()
        .unwrap_or(&stem)
        .trim()
        .to_string();
    Meta { family, weight: weight.to_string(), style: if italic { "italic" } else { "normal" }.into(), name: stem }
}

/// Writes `data` into the theme's `fonts/` as `name.ext`, " (2)" on clashes;
/// the same file twice is stored once.
fn store(theme: &Path, name: &str, ext: &str, data: &[u8]) -> AppResult<String> {
    let dir = theme.join(FONTS_DIR);
    fs::create_dir_all(&dir)?;
    let stem = to_file_name(name).unwrap_or_else(|_| "font".into());
    for n in 1.. {
        let file = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem} ({n}).{ext}") };
        let path = dir.join(&file);
        if path.is_file() && fs::read(&path).is_ok_and(|d| d == data) {
            return Ok(file);
        }
        if !name_taken(&dir, &file)? {
            safe_write(&path, data)?;
            return Ok(file);
        }
    }
    unreachable!()
}

/// Copies the font file at `source` into the theme folder `theme`.
pub fn import(theme: &Path, source: &Path) -> AppResult<FontFile> {
    check_extension(source)?;
    import_data(theme, source, &fs::read(source)?)
}

fn check_extension(path: &Path) -> AppResult<String> {
    extension(path)
        .filter(|e| EXTENSIONS.contains(&e.as_str()))
        .ok_or_else(|| AppError::Invalid("Fonts can be .ttf, .otf, .woff or .woff2 files.".into()))
}

/// Stores font bytes that came with the file name `name` (e.g. a built-in
/// theme's font when the theme is copied) in the theme folder `theme`.
pub fn import_data(theme: &Path, name: &Path, data: &[u8]) -> AppResult<FontFile> {
    let ext = check_extension(name)?;
    let meta = if ext == "woff" || ext == "woff2" {
        meta_from_file_name(name)
    } else {
        read_meta(data, 0).ok_or_else(|| AppError::Invalid("This file isn't a font the app can read.".into()))?
    };
    let stem = name.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(meta.name);
    let file = store(theme, &stem, &ext, data)?;
    Ok(FontFile { family: meta.family, file, weight: meta.weight, style: meta.style })
}

/// One face out of a collection file (.ttc) as a standalone font file.
fn extract_face(data: &[u8], index: u32) -> Option<Vec<u8>> {
    let u16_at = |o: usize| data.get(o..o + 2).map(|b| u16::from_be_bytes([b[0], b[1]]));
    let u32_at = |o: usize| data.get(o..o + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
    if data.get(0..4)? != b"ttcf" {
        return (index == 0).then(|| data.to_vec());
    }
    if index >= u32_at(8)? {
        return None;
    }
    let start = u32_at(12 + 4 * index as usize)? as usize;
    let count = u16_at(start + 4)? as usize;
    let mut out = data.get(start..start + 12)?.to_vec();
    let mut tables = Vec::new();
    for i in 0..count {
        let rec = start + 12 + 16 * i;
        let (offset, len) = (u32_at(rec + 8)? as usize, u32_at(rec + 12)? as usize);
        tables.push((data.get(rec..rec + 8)?, data.get(offset..offset + len)?));
    }
    let mut offset = 12 + 16 * count;
    let mut body = Vec::new();
    for (head, table) in &tables {
        out.extend_from_slice(head);
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(table.len() as u32).to_be_bytes());
        body.extend_from_slice(table);
        while body.len() % 4 != 0 {
            body.push(0);
        }
        offset = 12 + 16 * count + body.len();
    }
    out.extend(body);
    Some(out)
}

/// Copies all faces of an installed family into the theme folder.
pub fn copy_installed(theme: &Path, faces: &[InstalledFace]) -> AppResult<Vec<FontFile>> {
    let mut out = Vec::new();
    for face in faces {
        let data = fs::read(&face.path)?;
        let ext = match extension(&face.path).as_deref() {
            Some("otf") => "otf",
            Some("otc") if data.get(4..8) == Some(b"OTTO") => "otf",
            _ => "ttf",
        };
        let single = extract_face(&data, face.index)
            .ok_or_else(|| AppError::Invalid(format!("Could not copy the font \"{}\".", face.name)))?;
        let file = store(theme, &face.name, ext, &single)?;
        out.push(FontFile { family: face.family.clone(), file, weight: face.weight.clone(), style: face.style.clone() });
    }
    Ok(out)
}

/// Folders the system keeps installed fonts in.
fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts"].map(PathBuf::from));
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Library/Fonts"));
        }
    } else if cfg!(windows) {
        let windir = std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into());
        dirs.push(PathBuf::from(windir).join("Fonts"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft\\Windows\\Fonts"));
        }
    } else {
        dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".local/share/fonts"));
        }
    }
    dirs
}

/// Every face of every font installed on this computer, by family. Hidden
/// system fonts (names starting with "." ) are left out.
pub fn installed() -> BTreeMap<String, Vec<InstalledFace>> {
    let mut families: BTreeMap<String, Vec<InstalledFace>> = BTreeMap::new();
    let mut stack = font_dirs();
    let mut seen = std::collections::HashSet::new();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !seen.insert(path.clone()) {
                continue;
            }
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                if !cfg!(target_os = "macos") {
                    stack.push(path);
                }
                continue;
            }
            if !matches!(extension(&path).as_deref(), Some("ttf" | "otf" | "ttc" | "otc")) {
                continue;
            }
            let Ok(data) = fs::read(&path) else { continue };
            let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
            for index in 0..count {
                let Some(meta) = read_meta(&data, index) else { continue };
                if meta.family.starts_with('.') || meta.family.is_empty() {
                    continue;
                }
                families.entry(meta.family.clone()).or_default().push(InstalledFace {
                    family: meta.family,
                    path: path.clone(),
                    index,
                    weight: meta.weight,
                    style: meta.style,
                    name: meta.name,
                });
            }
        }
    }
    families
}

/// The bytes of font `file` in the theme folder `theme`.
pub fn read(theme: &Path, file: &str) -> AppResult<Vec<u8>> {
    check_id(file)?;
    Ok(fs::read(theme.join(FONTS_DIR).join(file))?)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A minimal valid TrueType font (no glyph outlines) named `family`.
    pub fn tiny_font(family: &str, sub: &str, weight: u16) -> Vec<u8> {
        let mut head = vec![0u8; 54];
        head[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        head[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes());
        head[18..20].copy_from_slice(&1000u16.to_be_bytes());
        let mut hhea = vec![0u8; 36];
        hhea[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        hhea[34..36].copy_from_slice(&1u16.to_be_bytes());
        let mut maxp = vec![0u8; 6];
        maxp[0..4].copy_from_slice(&0x0000_5000u32.to_be_bytes());
        maxp[4..6].copy_from_slice(&1u16.to_be_bytes());
        let mut os2 = vec![0u8; 78];
        os2[4..6].copy_from_slice(&weight.to_be_bytes());
        // name table: family (1) and subfamily (2), Windows platform, UTF-16BE.
        let strings: Vec<Vec<u8>> = [family, sub]
            .iter()
            .map(|s| s.encode_utf16().flat_map(|u| u.to_be_bytes()).collect())
            .collect();
        let mut name = Vec::new();
        name.extend_from_slice(&0u16.to_be_bytes());
        name.extend_from_slice(&2u16.to_be_bytes());
        name.extend_from_slice(&(6u16 + 12 * 2).to_be_bytes());
        let mut off = 0u16;
        for (i, s) in strings.iter().enumerate() {
            for v in [3u16, 1, 0x0409, i as u16 + 1, s.len() as u16, off] {
                name.extend_from_slice(&v.to_be_bytes());
            }
            off += s.len() as u16;
        }
        for s in &strings {
            name.extend_from_slice(s);
        }
        let tables: Vec<(&[u8; 4], Vec<u8>)> = vec![(b"OS/2", os2), (b"head", head), (b"hhea", hhea), (b"maxp", maxp), (b"name", name)];
        let mut out = Vec::new();
        out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
        out.extend_from_slice(&(tables.len() as u16).to_be_bytes());
        out.extend_from_slice(&[0u8; 6]);
        let mut offset = 12 + 16 * tables.len();
        let mut body = Vec::new();
        for (tag, data) in &tables {
            out.extend_from_slice(*tag);
            out.extend_from_slice(&0u32.to_be_bytes());
            out.extend_from_slice(&(offset as u32).to_be_bytes());
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            body.extend_from_slice(data);
            while body.len() % 4 != 0 {
                body.push(0);
            }
            offset = 12 + 16 * tables.len() + body.len();
        }
        out.extend(body);
        out
    }

    /// Two fonts packed into one collection file.
    fn collection(a: &[u8], b: &[u8]) -> Vec<u8> {
        let header = 12 + 8;
        let mut out = b"ttcf".to_vec();
        out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
        out.extend_from_slice(&2u32.to_be_bytes());
        out.extend_from_slice(&(header as u32).to_be_bytes());
        out.extend_from_slice(&((header + a.len()) as u32).to_be_bytes());
        // Table offsets in a collection count from the start of the file.
        for (font, base) in [(a, header), (b, header + a.len())] {
            let mut f = font.to_vec();
            let count = u16::from_be_bytes([f[4], f[5]]) as usize;
            for i in 0..count {
                let rec = 12 + 16 * i + 8;
                let o = u32::from_be_bytes(f[rec..rec + 4].try_into().unwrap()) as usize + base;
                f[rec..rec + 4].copy_from_slice(&(o as u32).to_be_bytes());
            }
            out.extend(f);
        }
        out
    }

    #[test]
    fn import_reads_family_and_stores_once() {
        let tmp = tempfile::tempdir().unwrap();
        let theme = tmp.path().join("Theme A");
        fs::create_dir_all(&theme).unwrap();
        let src = tmp.path().join("Font A-Bold.ttf");
        fs::write(&src, tiny_font("Font A", "Bold", 700)).unwrap();
        let f = import(&theme, &src).unwrap();
        assert_eq!(f, FontFile { family: "Font A".into(), file: "Font A-Bold.ttf".into(), weight: "700".into(), style: "normal".into() });
        assert_eq!(import(&theme, &src).unwrap().file, "Font A-Bold.ttf");
        assert_eq!(read(&theme, "Font A-Bold.ttf").unwrap(), fs::read(&src).unwrap());

        let woff = tmp.path().join("Font B-BoldItalic.woff2");
        fs::write(&woff, b"wOF2").unwrap();
        let w = import(&theme, &woff).unwrap();
        assert_eq!((w.family.as_str(), w.weight.as_str(), w.style.as_str()), ("Font B", "700", "italic"));

        let bad = tmp.path().join("Not a font.ttf");
        fs::write(&bad, b"nothing").unwrap();
        assert!(import(&theme, &bad).is_err());
        assert!(import(&theme, &tmp.path().join("x.txt")).is_err());
        assert!(read(&theme, "../x").is_err());
    }

    #[test]
    fn faces_from_collections_become_standalone_files() {
        let tmp = tempfile::tempdir().unwrap();
        let ttc = collection(&tiny_font("Font C", "Regular", 400), &tiny_font("Font C", "Bold", 700));
        assert_eq!(ttf_parser::fonts_in_collection(&ttc), Some(2));
        let path = tmp.path().join("Font C.ttc");
        fs::write(&path, &ttc).unwrap();
        let faces: Vec<InstalledFace> = (0..2)
            .map(|index| {
                let m = read_meta(&ttc, index).unwrap();
                InstalledFace { family: m.family, path: path.clone(), index, weight: m.weight, style: m.style, name: m.name }
            })
            .collect();
        assert_eq!(faces[1].weight, "700");
        let theme = tmp.path().join("Theme A");
        let files = copy_installed(&theme, &faces).unwrap();
        assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["Font C Regular.ttf", "Font C Bold.ttf"]);
        let bold = fs::read(theme.join("fonts/Font C Bold.ttf")).unwrap();
        let m = read_meta(&bold, 0).unwrap();
        assert_eq!((m.family.as_str(), m.weight.as_str()), ("Font C", "700"));
        assert!(extract_face(&ttc, 2).is_none());
    }

    /// Reads this computer's real fonts (run by hand: cargo test installed -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn installed_fonts_scan() {
        let start = std::time::Instant::now();
        let families = installed();
        let faces: usize = families.values().map(Vec::len).sum();
        println!("{} families, {faces} faces in {:?}", families.len(), start.elapsed());
        for name in ["Georgia", "Helvetica", "Times New Roman", "Palatino"] {
            if let Some(f) = families.get(name) {
                let tmp = tempfile::tempdir().unwrap();
                let files = copy_installed(tmp.path(), f).unwrap();
                for file in &files {
                    let data = fs::read(tmp.path().join("fonts").join(&file.file)).unwrap();
                    assert!(read_meta(&data, 0).is_some(), "{}", file.file);
                }
                println!("{name}: {:?}", files.iter().map(|f| (&f.file, &f.weight, &f.style)).collect::<Vec<_>>());
            }
        }
    }
}
