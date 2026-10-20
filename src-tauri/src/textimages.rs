//! Images in page text (`[[File:Name.png|right|medium|spoiler|Caption]]`),
//! `<gallery>` blocks and the edges of quote boxes, as the link index needs
//! them: image files, the hover card's picture, and lines to leave out of
//! previews. The TypeScript side is src/images.ts and src/quotes.ts.

use crate::wikilinks::{is_file_name, text_lines};

/// An image starting at `line[i..]`: the end (exclusive) and the inside of
/// the brackets. The caption may contain `[[links]]`.
pub fn image_at(line: &str, i: usize) -> Option<(usize, &str)> {
    let inner_start = i + 2;
    if !line[i..].starts_with("[[") || !is_file_name(line.get(inner_start..)?) {
        return None;
    }
    let b = line.as_bytes();
    let mut depth = 1;
    let mut j = inner_start;
    while j + 1 < b.len() {
        if b[j] == b'[' && b[j + 1] == b'[' {
            depth += 1;
            j += 2;
        } else if b[j] == b']' && b[j + 1] == b']' {
            depth -= 1;
            j += 2;
            if depth == 0 {
                return Some((j, &line[inner_start..j - 2]));
            }
        } else {
            j += 1;
        }
    }
    None
}

/// The file name inside `File:Name.png|…`.
fn image_file(inner: &str) -> String {
    let name = inner.get(5..).unwrap_or("");
    let end = name.find('|').unwrap_or(name.len());
    name[..end].trim_end_matches('\\').trim().to_string()
}

/// `<gallery>`, or `<gallery spoiler>` (blurred until clicked): Some(spoiler).
pub(crate) fn gallery_open(line: &str) -> Option<bool> {
    let t = line.trim().to_ascii_lowercase();
    let inner = t.strip_prefix("<gallery")?.strip_suffix('>')?;
    match inner.trim() {
        "" if inner.is_empty() => Some(false),
        "spoiler" if inner.starts_with(char::is_whitespace) => Some(true),
        _ => None,
    }
}

pub(crate) fn quote_open(line: &str) -> bool {
    line.trim().eq_ignore_ascii_case("<quote>")
}

pub(crate) fn quote_close(line: &str) -> bool {
    line.trim().eq_ignore_ascii_case("</quote>")
}

pub(crate) fn gallery_close(line: &str) -> bool {
    line.trim().eq_ignore_ascii_case("</gallery>")
}

/// Image starts in a line of text, skipping code spans.
fn images_in_line(line: &str, mut f: impl FnMut(usize, usize, &str)) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'`' => {
                let n = b[i..].iter().take_while(|&&c| c == b'`').count();
                let ticks = &line[i..i + n];
                i = match line[i + n..].find(ticks) {
                    Some(end) => i + n + end + n,
                    None => i + n,
                };
            }
            b'[' => match image_at(line, i) {
                Some((end, inner)) => {
                    f(i, end, inner);
                    i = end;
                }
                None => i += 1,
            },
            _ => i += 1,
        }
    }
}

/// Every image file used in the page text and its galleries, in order (code skipped).
/// (For health reports, M11.)
#[allow(dead_code)]
pub fn images(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_gallery = false;
    text_lines(body, |_, _, line| {
        if in_gallery {
            if gallery_close(line) {
                in_gallery = false;
            } else if !line.trim().is_empty() {
                let t = line.trim();
                let t = if is_file_name(t) { &t[5..] } else { t };
                let file = t.split('|').next().unwrap_or("").trim();
                if !file.is_empty() {
                    out.push(file.to_string());
                }
            }
        } else if gallery_open(line).is_some() {
            in_gallery = true;
        } else {
            images_in_line(line, |_, _, inner| {
                let file = image_file(inner);
                if !file.is_empty() {
                    out.push(file);
                }
            });
        }
    });
    out
}

/// Is `[[File:…|…|spoiler|…]]` (its inside) marked as a spoiler?
fn image_is_spoiler(inner: &str) -> bool {
    // Option words sit between `|`s before the caption; links in the caption can't say "spoiler" on their own.
    inner.split('|').skip(1).any(|p| p.trim_end_matches('\\').trim().eq_ignore_ascii_case("spoiler"))
}

/// The first image in the text that isn't a spoiler (hover cards show it).
pub fn first_shown_image(body: &str) -> Option<String> {
    let mut found: Option<String> = None;
    let mut gallery: Option<bool> = None;
    text_lines(body, |_, _, line| {
        if found.is_some() {
            return;
        }
        if let Some(spoiler) = gallery {
            if gallery_close(line) {
                gallery = None;
            } else if !spoiler && !line.trim().is_empty() {
                let t = line.trim();
                let t = if is_file_name(t) { &t[5..] } else { t };
                let file = t.split('|').next().unwrap_or("").trim();
                if !file.is_empty() {
                    found = Some(file.to_string());
                }
            }
        } else if let Some(spoiler) = gallery_open(line) {
            gallery = Some(spoiler);
        } else {
            images_in_line(line, |_, _, inner| {
                let file = image_file(inner);
                if found.is_none() && !file.is_empty() && !image_is_spoiler(inner) {
                    found = Some(file);
                }
            });
        }
    });
    found
}

/// A line without its images (for hover previews).
pub(crate) fn strip_images(line: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    images_in_line(line, |start, end, _| {
        out.push_str(&line[last..start]);
        last = end;
    });
    out.push_str(&line[last..]);
    out
}

