//! Page links (`[[Page]]`, `[[Page|shown]]`, `[[Page#Section]]`, `[[#Section]]`)
//! and the bits of Markdown the link index needs: headings with their section
//! anchors, opening paragraphs for hover previews, images, spoilers
//! (`||hidden||`, see src/spoilers.ts) and quote boxes (src/quotes.ts).
//!
//! The TypeScript renderer (src/markdown.ts) parses the same syntax; both run
//! the cases in shared-tests/links.json so they can't disagree.

use std::collections::{HashMap, HashSet};

use crate::textimages::{gallery_close, gallery_open, quote_close, quote_open, strip_images};

/// A `[[link]]` found in a page body. Positions are byte offsets in the body.
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    /// The whole link, including letters joined on after `]]`.
    pub start: usize,
    pub end: usize,
    /// The page part (trimmed) — what a rename rewrites.
    pub page_start: usize,
    pub page_end: usize,
    /// Page as typed (trimmed). Empty for `[[#Section]]`.
    pub page: String,
    pub section: Option<String>,
    /// Text after `|`, trimmed. `Some("")` is the pipe trick.
    pub label: Option<String>,
    /// Letters directly after `]]` (`[[Page]]s`).
    pub suffix: String,
    /// 0-based line number.
    pub line: usize,
}

impl Link {
    /// The text the link shows on the page.
    pub fn shown_text(&self) -> String {
        let base = match (&self.label, &self.section) {
            (Some(l), _) if !l.is_empty() => l.clone(),
            (Some(_), Some(s)) if self.page.is_empty() => s.clone(),
            (Some(_), _) => pipe_trick(&self.page),
            (None, Some(s)) if self.page.is_empty() => format!("§ {s}"),
            (None, Some(s)) => format!("{} § {s}", self.page),
            (None, None) => self.page.clone(),
        };
        base + &self.suffix
    }
}

/// How titles, aliases and link targets are compared: spaces trimmed and
/// collapsed, upper/lower case ignored.
pub fn norm(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// `[[Page A (Example)|]]` shows "Page A".
pub fn pipe_trick(page: &str) -> String {
    let t = page.trim_end();
    if t.ends_with(')') {
        if let Some(open) = t.rfind('(') {
            let inner = &t[open + 1..t.len() - 1];
            let head = t[..open].trim_end();
            if !inner.contains(['(', ')']) && !head.is_empty() {
                return head.to_string();
            }
        }
    }
    t.to_string()
}

/// Characters that break link syntax, so titles and aliases can't use them.
pub const LINK_CHARS: &[char] = &['[', ']', '|', '#'];

pub fn has_link_chars(name: &str) -> bool {
    name.contains(LINK_CHARS)
}

/// `File:…` names an image (`[[File:Name.png|…]]`), not a page.
pub fn is_file_name(name: &str) -> bool {
    name.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("file:"))
}

/// A spoiler `||…||` starting at byte `i` of `text`: the end (after the
/// closing `||`). Same rule as `SPOILER_AT_START` in src/spoilers.ts: the first
/// character isn't `|` or a space, the text doesn't end in `\`, one line only.
pub fn spoiler_at(text: &str, i: usize) -> Option<usize> {
    let rest = text.get(i..)?.strip_prefix("||")?;
    let first = rest.chars().next()?;
    if first == '|' || first.is_whitespace() {
        return None;
    }
    let start = i + 2;
    let mut j = start + first.len_utf8();
    loop {
        let b = text.as_bytes();
        match text[j..].find(['|', '\n']) {
            None => return None,
            Some(k) => {
                j += k;
                if b[j] == b'\n' {
                    return None;
                }
                if text[j..].starts_with("||") && (j == start + first.len_utf8() || b[j - 1] != b'\\') {
                    return Some(j + 2);
                }
                j += 1;
            }
        }
    }
}

/// Byte ranges of the spoilers `||…||` in one line of text, in order.
pub fn spoiler_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(k) = text.get(i..).and_then(|t| t.find("||")) {
        let at = i + k;
        match spoiler_at(text, at) {
            Some(end) => {
                out.push((at, end));
                i = end;
            }
            None => i = at + 1,
        }
    }
    out
}

// ---- scanning ----

/// A fenced code block opener/closer: up to 3 spaces, then ``` or ~~~.
fn fence(line: &str) -> Option<(char, usize)> {
    let t = line.trim_end_matches(['\r', '\n']);
    let indent = t.len() - t.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &t[indent..];
    let c = rest.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = rest.chars().take_while(|&x| x == c).count();
    if n < 3 || (c == '`' && rest[n..].contains('`')) {
        return None;
    }
    Some((c, n))
}

/// Calls `f(line_number, line_start_offset, line)` for every line that isn't
/// inside a fenced code block (fence lines included as code).
pub(crate) fn text_lines(body: &str, mut f: impl FnMut(usize, usize, &str)) {
    let mut open: Option<(char, usize)> = None;
    let mut offset = 0;
    for (n, raw) in body.split_inclusive('\n').enumerate() {
        let line = raw.trim_end_matches(['\r', '\n']);
        match (open, fence(line)) {
            (None, Some(fc)) => open = Some(fc),
            (Some((c, len)), Some((c2, len2))) if c == c2 && len2 >= len && line.trim().chars().all(|x| x == c) => {
                open = None
            }
            (None, None) => f(n, offset, line),
            _ => {}
        }
        offset += raw.len();
    }
}

/// Links in one line of text (not code). `base` is the line's offset.
fn links_in_line(line: &str, base: usize, line_no: usize, out: &mut Vec<Link>) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'`' => {
                // A code span: skip to the closing run of the same length.
                let n = b[i..].iter().take_while(|&&c| c == b'`').count();
                let mut j = i + n;
                let mut closed = None;
                while j < b.len() {
                    if b[j] == b'`' {
                        let m = b[j..].iter().take_while(|&&c| c == b'`').count();
                        if m == n {
                            closed = Some(j + m);
                            break;
                        }
                        j += m;
                    } else {
                        j += 1;
                    }
                }
                i = closed.unwrap_or(i + n);
            }
            b'[' if b.get(i + 1) == Some(&b'[') => match parse_at(line, i, base, line_no) {
                Some(link) => {
                    i = link.end - base;
                    out.push(link);
                }
                None => i += 1,
            },
            _ => i += 1,
        }
    }
}

/// Parses a link starting at `line[i..]` (which begins with `[[`).
fn parse_at(line: &str, i: usize, base: usize, line_no: usize) -> Option<Link> {
    let inner_start = i + 2;
    let close = line[inner_start..].find("]]")? + inner_start;
    let inner = &line[inner_start..close];
    if inner.is_empty() || inner.contains(['[', ']']) {
        return None;
    }
    let (page_part, label) = match inner.find('|') {
        Some(p) => {
            let before = &inner[..p];
            let before = before.strip_suffix('\\').unwrap_or(before);
            (before, Some(inner[p + 1..].trim().to_string()))
        }
        None => (inner, None),
    };
    let (page_raw, section) = match page_part.find('#') {
        Some(h) => {
            let s = page_part[h + 1..].trim();
            (&page_part[..h], (!s.is_empty()).then(|| s.to_string()))
        }
        None => (page_part, None),
    };
    let page = page_raw.trim();
    if page.is_empty() && section.is_none() || is_file_name(page) {
        return None;
    }
    let lead = page_raw.len() - page_raw.trim_start().len();
    let page_start = base + inner_start + lead;
    let after = close + 2;
    let suffix: String = line[after..].chars().take_while(|c| c.is_alphabetic()).collect();
    Some(Link {
        start: base + i,
        end: base + after + suffix.len(),
        page_start,
        page_end: page_start + page.len(),
        page: page.to_string(),
        section,
        label,
        suffix,
        line: line_no,
    })
}

/// Every `[[link]]` in a page body, in order. Code is skipped.
pub fn parse_links(body: &str) -> Vec<Link> {
    let mut out = Vec::new();
    text_lines(body, |n, off, line| links_in_line(line, off, n, &mut out));
    out
}

/// Points every link and embed to `old` (compared with [`norm`]) at `new`:
/// the page part is replaced, everything else (section, shown text, `\|`,
/// `|infobox`) is kept. Returns the new body and how many changed.
pub fn rewrite_links(body: &str, old: &str, new: &str) -> (String, usize) {
    let old = norm(old);
    let mut spans: Vec<(usize, usize)> = parse_links(body)
        .into_iter()
        .filter(|l| !l.page.is_empty() && norm(&l.page) == old)
        .map(|l| (l.page_start, l.page_end))
        .chain(parse_embeds(body).into_iter().filter(|e| norm(&e.page) == old).map(|e| (e.page_start, e.page_end)))
        .collect();
    spans.sort_unstable();
    let mut out = String::with_capacity(body.len() + 64);
    let mut last = 0;
    for &(start, end) in &spans {
        out.push_str(&body[last..start]);
        out.push_str(new);
        last = end;
    }
    out.push_str(&body[last..]);
    (out, spans.len())
}

// ---- embeds: a line holding only {{Page}}, {{Page#Section}} or {{Page|infobox}} ----

/// An embed (the content of another page shown in this one). Must match
/// `EMBED_LINE` in src/embeds.ts.
#[derive(Debug, Clone, PartialEq)]
pub struct Embed {
    /// The page part (trimmed), byte offsets in the body.
    pub page_start: usize,
    pub page_end: usize,
    pub page: String,
    pub section: Option<String>,
    /// `{{Page|infobox}}`: only the infobox. (`|collapsible` / `|collapsed`
    /// only change the look, so they aren't kept here.)
    pub infobox: bool,
    /// 0-based line number.
    pub line: usize,
}

/// The embed a line consists of, if any (`base`: the line's offset).
fn embed_line(line: &str, base: usize, line_no: usize) -> Option<Embed> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let t = line[indent..].trim_end();
    let inner = t.strip_prefix("{{")?.strip_suffix("}}")?;
    if inner.is_empty() || inner.contains(['{', '}']) {
        return None;
    }
    let mut parts = inner.split('|');
    let target = parts.next().unwrap_or("");
    let mut infobox = false;
    for option in parts.map(|o| o.trim().to_ascii_lowercase()) {
        match option.as_str() {
            "infobox" => infobox = true,
            "collapsible" | "collapsed" => {}
            _ => return None,
        }
    }
    let (page_raw, section) = match target.find('#') {
        Some(h) => {
            let s = target[h + 1..].trim();
            (&target[..h], (!s.is_empty()).then(|| s.to_string()))
        }
        None => (target, None),
    };
    let page = page_raw.trim();
    if page.is_empty() || is_file_name(page) || category_of(page).is_some() {
        return None;
    }
    let page_start = base + indent + 2 + (page_raw.len() - page_raw.trim_start().len());
    Some(Embed { page_start, page_end: page_start + page.len(), page: page.to_string(), section, infobox, line: line_no })
}

/// Every embed in a page body, in order. Code is skipped.
pub fn parse_embeds(body: &str) -> Vec<Embed> {
    let mut out = Vec::new();
    text_lines(body, |n, off, line| out.extend(embed_line(line, off, n)));
    out
}

/// The category a link target names (`Category:Name` -> "name", compared
/// with [`norm`]), or `None` for an ordinary page link.
pub fn category_of(target: &str) -> Option<String> {
    let t = target.trim_start();
    t.get(..9).filter(|p| p.eq_ignore_ascii_case("category:")).map(|_| norm(&t[9..]))
}

/// Points every `[[Category:…]]` link to category `old` (normalized) at `new`
/// (a category name). Returns the new body and how many links changed.
pub fn rewrite_category_links(body: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(body.len() + 64);
    let mut last = 0;
    let mut count = 0;
    for link in parse_links(body) {
        if category_of(&link.page).as_deref() != Some(old) {
            continue;
        }
        out.push_str(&body[last..link.page_start]);
        out.push_str("Category:");
        out.push_str(new);
        last = link.page_end;
        count += 1;
    }
    out.push_str(&body[last..]);
    (out, count)
}

// ---- headings and section anchors ----

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Heading {
    /// Section anchor, as the page renders it ("early-life").
    pub anchor: String,
    /// Heading text without Markdown symbols.
    pub text: String,
    pub level: u8,
    /// 0-based line number (`usize::MAX` for the automatic Notes section).
    #[serde(skip)]
    pub line: usize,
}

pub const NOTES_HEADING: &str = "Notes";

/// Section anchor: lower-case, spaces -> "-", empty -> "section". Must match
/// `slugify` in src/markdown.ts.
pub fn slugify(text: &str) -> String {
    let s = text.split_whitespace().collect::<Vec<_>>().join("-").to_lowercase();
    if s.is_empty() { "section".into() } else { s }
}

/// An ATX heading line (`## Text`): level and raw text.
fn atx_heading(line: &str) -> Option<(u8, &str)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let level = rest.bytes().take_while(|&c| c == b'#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let after = &rest[level..];
    if !after.is_empty() && !after.starts_with([' ', '\t']) {
        return None;
    }
    let mut text = after.trim();
    // Optional closing sequence: "## Title ##".
    let stripped = text.trim_end_matches('#');
    if stripped.len() < text.len() && (stripped.is_empty() || stripped.ends_with([' ', '\t'])) {
        text = stripped.trim_end();
    }
    Some((level as u8, text))
}

fn footnote_def_label(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("[^")?;
    let end = rest.find("]:")?;
    let label = &rest[..end];
    (!label.is_empty() && !label.contains(char::is_whitespace) && !label.contains(']')).then_some(label)
}

/// Heading text without Markdown symbols, as the renderer shows it.
pub fn plain_inline(text: &str, footnotes: &HashSet<String>) -> String {
    let mut links = Vec::new();
    links_in_line(text, 0, 0, &mut links);
    let mut links = links.into_iter().peekable();
    let b = text.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < text.len() {
        if let Some(l) = links.peek() {
            if l.start == i {
                out.push_str(&l.shown_text());
                i = l.end;
                links.next();
                continue;
            }
        }
        let c = text[i..].chars().next().unwrap();
        match c {
            '\\' if i + 1 < text.len() => {
                let next = text[i + 1..].chars().next().unwrap();
                if next.is_ascii_punctuation() {
                    out.push(next);
                    i += 1 + next.len_utf8();
                } else {
                    out.push('\\');
                    i += 1;
                }
            }
            '`' => {
                let n = b[i..].iter().take_while(|&&c| c == b'`').count();
                let ticks = &text[i..i + n];
                match text[i + n..].find(ticks) {
                    Some(end) => {
                        out.push_str(text[i + n..i + n + end].trim());
                        i += n + end + n;
                    }
                    None => {
                        out.push_str(ticks);
                        i += n;
                    }
                }
            }
            '|' if spoiler_at(text, i).is_some() => {
                // `||hidden||` shows its text (the markers go).
                let end = spoiler_at(text, i).unwrap();
                out.push_str(&plain_inline(&text[i + 2..end - 2], footnotes));
                i = end;
            }
            '*' | '~' => i += 1,
            '_' => {
                // Underscores inside words are literal; at word edges they're emphasis.
                let prev = text[..i].chars().next_back();
                let next = text[i + 1..].chars().next();
                let inner = prev.is_some_and(char::is_alphanumeric) && next.is_some_and(char::is_alphanumeric);
                if inner {
                    out.push('_');
                }
                i += 1;
            }
            '[' if text[i..].starts_with("[^") => match text[i..].find(']') {
                Some(end) if footnotes.contains(&text[i + 2..i + end]) => i += end + 1,
                _ => {
                    out.push('[');
                    i += 1;
                }
            },
            '!' | '[' => {
                // [text](url) and ![alt](src): keep the text.
                let open = if c == '!' { i + 1 } else { i };
                if text[open..].starts_with('[') {
                    if let Some(close) = text[open..].find("](") {
                        let after = open + close + 2;
                        if let Some(paren) = text[after..].find(')') {
                            out.push_str(&plain_inline(&text[open + 1..open + close], footnotes));
                            i = after + paren + 1;
                            continue;
                        }
                    }
                }
                out.push(c);
                i += 1;
            }
            '<' => match text[i..].find('>') {
                Some(end) if text[i + 1..].starts_with(|ch: char| ch.is_ascii_alphabetic() || ch == '/') => i += end + 1,
                _ => {
                    out.push('<');
                    i += 1;
                }
            },
            _ => {
                out.push(c);
                i += c.len_utf8();
            }
        }
    }
    out.trim().to_string()
}

/// Footnote labels defined on the page (outside code).
fn footnote_labels(body: &str) -> HashSet<String> {
    let mut set = HashSet::new();
    text_lines(body, |_, _, line| {
        if let Some(l) = footnote_def_label(line) {
            set.insert(l.to_string());
        }
    });
    set
}

/// Every heading with its anchor, numbered the way the page renders them
/// (repeats get "-2", "-3"…). Pages with footnotes end with a Notes section.
pub fn headings(body: &str) -> Vec<Heading> {
    let notes = footnote_labels(body);
    let mut used: HashMap<String, usize> = HashMap::new();
    let mut unique = |base: String| {
        let n = used.entry(base.clone()).or_insert(0);
        *n += 1;
        if *n == 1 { base } else { format!("{base}-{n}") }
    };
    let mut out = Vec::new();
    text_lines(body, |n, _, line| {
        if let Some((level, raw)) = atx_heading(line) {
            let text = plain_inline(raw, &notes);
            out.push(Heading { anchor: unique(slugify(&text)), text, level, line: n });
        }
    });
    if !notes.is_empty() {
        out.push(Heading {
            anchor: unique(slugify(NOTES_HEADING)),
            text: NOTES_HEADING.into(),
            level: 2,
            line: usize::MAX,
        });
    }
    out
}

// ---- opening paragraphs (hover previews) ----

const SUMMARY_MAX: usize = 600;

fn is_hr(t: &str) -> bool {
    let s: String = t.chars().filter(|c| !c.is_whitespace()).collect();
    s.len() >= 3 && (s.chars().all(|c| c == '-') || s.chars().all(|c| c == '*') || s.chars().all(|c| c == '_'))
}

/// A line that can be part of an ordinary paragraph.
fn is_prose(line: &str) -> bool {
    let t = line.trim_start();
    let indent = line.len() - t.len();
    if t.is_empty() || indent >= 4 {
        return false;
    }
    let list = t.starts_with(['-', '*', '+']) && t[1..].starts_with([' ', '\t'])
        || t.find(['.', ')']).is_some_and(|p| p > 0 && t[..p].bytes().all(|c| c.is_ascii_digit()) && t[p + 1..].starts_with([' ', '\t']));
    !(atx_heading(line).is_some()
        || embed_line(line, 0, 0).is_some()
        || list
        || t.starts_with(['>', '|'])
        || t.starts_with("<!--")
        || footnote_def_label(t).is_some()
        || is_hr(t))
}

/// The first ordinary paragraph in `lines` (outside code), stopping early
/// where `stop` says so. Cut to a readable length, never inside a link.
fn first_paragraph<'a>(lines: impl Iterator<Item = &'a str>, mut stop: impl FnMut(&str) -> bool) -> String {
    let mut para: Vec<&str> = Vec::new();
    for line in lines {
        if stop(line) {
            break;
        }
        if is_prose(line) {
            para.push(line.trim());
        } else if !para.is_empty() {
            break;
        }
    }
    let text = para.join("\n");
    if text.chars().count() <= SUMMARY_MAX {
        return text;
    }
    let mut cut = text.char_indices().nth(SUMMARY_MAX).map(|(i, _)| i).unwrap_or(text.len());
    cut = text[..cut].rfind(char::is_whitespace).unwrap_or(cut);
    for l in parse_links(&text) {
        if l.start < cut && cut < l.end {
            cut = l.start;
        }
    }
    // Nor inside a spoiler: half a spoiler would show its text.
    let mut i = 0;
    while let Some(p) = text[i..cut].find("||") {
        let at = i + p;
        match spoiler_at(&text, at) {
            Some(end) if end > cut => {
                cut = at;
                break;
            }
            Some(end) => i = end,
            None => i = at + 1,
        }
    }
    format!("{}…", text[..cut].trim_end())
}

/// Lines outside code, galleries and quote boxes, without their images (for previews).
fn code_free_lines(body: &str) -> Vec<(usize, String)> {
    let mut v = Vec::new();
    let mut in_gallery = false;
    let mut in_quote = false;
    text_lines(body, |n, off, _| {
        let line = body[off..].split('\n').next().unwrap_or("").trim_end_matches('\r');
        if in_gallery {
            in_gallery = !gallery_close(line);
            return;
        }
        if in_quote {
            in_quote = !quote_close(line);
            return;
        }
        if gallery_open(line).is_some() {
            in_gallery = true;
            return;
        }
        if quote_open(line) {
            in_quote = true;
            return;
        }
        let stripped = strip_images(line);
        // A line that only held images is left out entirely.
        if stripped.trim().is_empty() && !line.trim().is_empty() {
            return;
        }
        v.push((n, stripped));
    });
    v
}

/// The page's opening paragraph (Markdown), for hover previews.
pub fn summary(body: &str) -> String {
    let lines = code_free_lines(body);
    first_paragraph(lines.iter().map(|(_, l)| l.as_str()), |_| false)
}

/// The start of the section with `anchor`: the first paragraph after its
/// heading, before the next heading of the same or a higher level. `None`
/// if the page has no such section.
pub fn section_summary(body: &str, anchor: &str) -> Option<String> {
    let hs = headings(body);
    let h = hs.iter().find(|h| h.anchor == anchor)?;
    if h.line == usize::MAX {
        return Some(String::new());
    }
    let level = h.level;
    let lines = code_free_lines(body);
    let after = lines.iter().filter(|(n, _)| *n > h.line).map(|(_, l)| l.as_str());
    Some(first_paragraph(after, |l| atx_heading(l).is_some_and(|(lv, _)| lv <= level)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::textimages::{first_shown_image, images};
    use serde_json::Value;

    fn cases() -> Value {
        serde_json::from_str(include_str!("../../shared-tests/links.json")).unwrap()
    }

    #[test]
    fn shared_link_cases() {
        for case in cases()["links"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let got: Vec<Value> = parse_links(case["input"].as_str().unwrap())
                .iter()
                .map(|l| serde_json::json!({ "page": l.page, "section": l.section, "text": l.shown_text() }))
                .collect();
            assert_eq!(Value::Array(got), case["links"], "{name}");
        }
    }

    #[test]
    fn shared_anchor_cases() {
        for case in cases()["anchors"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let got: Vec<String> = headings(case["input"].as_str().unwrap()).into_iter().map(|h| h.anchor).collect();
            let want: Vec<String> =
                case["anchors"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            assert_eq!(got, want, "{name}");
        }
    }

    #[test]
    fn positions_and_lines() {
        let body = "x\n\nA [[ Page A |t]]s.";
        let l = &parse_links(body)[0];
        assert_eq!(l.line, 2);
        assert_eq!(&body[l.start..l.end], "[[ Page A |t]]s");
        assert_eq!(&body[l.page_start..l.page_end], "Page A");
        let crlf = "a\r\n[[B]]\r\n";
        let l = &parse_links(crlf)[0];
        assert_eq!((l.line, &crlf[l.start..l.end]), (1, "[[B]]"));
    }

    #[test]
    fn rewrite_keeps_everything_but_the_page() {
        let body = "[[Old]] [[old|own text]] [[OLD#Sec]] [[Old\\|x]] [[Old|]] [[Old (A)]] [[Old]]s [[Other]] `[[Old]]` [[#Old]]";
        let (out, n) = rewrite_links(body, "Old", "New Name");
        assert_eq!(n, 6);
        assert_eq!(
            out,
            "[[New Name]] [[New Name|own text]] [[New Name#Sec]] [[New Name\\|x]] [[New Name|]] [[Old (A)]] [[New Name]]s [[Other]] `[[Old]]` [[#Old]]"
        );
        assert_eq!(rewrite_links("no links", "Old", "New"), ("no links".to_string(), 0));
    }

    #[test]
    fn images_are_not_page_links() {
        let body = "[[File:A.png|right|medium|See [[Page B]] and [[C|c]]]] text [[File:D.svg]] `[[File:E.png]]`\n\n<gallery>\nF.png|Caption [[G]]\nFile:H.jpg\n</gallery>\n[[file:x.png|y]]";
        let pages: Vec<String> = parse_links(body).into_iter().map(|l| l.page).collect();
        assert_eq!(pages, ["Page B", "C", "G"]);
        assert_eq!(images(body), ["A.png", "D.svg", "F.png", "H.jpg", "x.png"]);
        let (out, n) = rewrite_links(body, "Page B", "Page Z");
        assert_eq!(n, 1);
        assert!(out.starts_with("[[File:A.png|right|medium|See [[Page Z]] and"));
        assert_eq!(images("[[File:A (2).png\\|left|x]]"), ["A (2).png"]);
        // An unclosed image is plain text.
        assert!(images("[[File:A.png|cap [[B]]").is_empty());
    }

    #[test]
    fn previews_leave_images_out() {
        assert_eq!(summary("[[File:A.png|right|Cap]]\nFirst text."), "First text.");
        assert_eq!(summary("Some [[File:A.png|x [[B]]]] text."), "Some  text.");
        assert_eq!(summary("<gallery>\nA.png|Cap\n</gallery>\n\nAfter."), "After.");
    }

    #[test]
    fn embeds_found_and_renamed() {
        let body = "{{Page A}}\n  {{ page a #Sec|collapsed}}\n{{Page A|infobox|collapsible}}\nText {{Page A}} inline\n{{Page A|other}}\n```\n{{Page A}}\n```\n{{Category:X}}";
        let e = parse_embeds(body);
        let got: Vec<_> = e.iter().map(|e| (e.page.as_str(), e.section.as_deref(), e.infobox, e.line)).collect();
        assert_eq!(got, [("Page A", None, false, 0), ("page a", Some("Sec"), false, 1), ("Page A", None, true, 2)]);
        assert_eq!(&body[e[1].page_start..e[1].page_end], "page a");
        let (out, n) = rewrite_links("[[Page A]] and\n{{Page A#S}}\n{{Page A|infobox}}", "page a", "Page Z");
        assert_eq!((out.as_str(), n), ("[[Page Z]] and\n{{Page Z#S}}\n{{Page Z|infobox}}", 3));
        // Embeds aren't links, and an embed line isn't an opening paragraph.
        assert!(parse_links("{{Page A}}").is_empty());
        assert_eq!(summary("{{Page A}}\n\nFirst text."), "First text.");
    }

    #[test]
    fn spoilers_found_like_the_renderer() {
        fn ends(t: &str) -> Option<&str> {
            spoiler_at(t, 0).map(|e| &t[..e])
        }
        assert_eq!(ends("||a|| b"), Some("||a||"));
        assert_eq!(ends("||a b [[C|d]]|| e ||f||"), Some("||a b [[C|d]]||"));
        assert_eq!(ends("|||a||"), None);
        assert_eq!(ends("||a\nb||"), None);
        assert_eq!(ends("||a\\|| b||"), Some("||a\\|| b||"));
        assert_eq!(ends("|| a||"), None);
        assert_eq!(ends("||é||"), Some("||é||"));
    }

    #[test]
    fn previews_keep_spoilers_whole_and_skip_quotes() {
        let long = format!("{} ||the hidden end of a long text|| after", "word ".repeat(117));
        let s = summary(&long);
        assert!(s.ends_with("word…") && !s.contains("||"), "{s}");
        assert_eq!(summary("<quote>\nQuoted [[A]].\n<by>[[B]]</by>\n</quote>\n\nFirst text."), "First text.");
        // Links in quote boxes still count.
        let pages: Vec<String> = parse_links("<quote>\nQuoted [[A]].\n<by>[[B]]</by>\n</quote>").into_iter().map(|l| l.page).collect();
        assert_eq!(pages, ["A", "B"]);
    }

    #[test]
    fn hover_image_skips_spoilers() {
        assert_eq!(first_shown_image("[[File:A.png|right|medium|spoiler|Cap]] [[File:B.png|left]]"), Some("B.png".into()));
        assert_eq!(first_shown_image("<gallery spoiler>\nA.png\n</gallery>\n<gallery>\nC.png|x\n</gallery>"), Some("C.png".into()));
        assert_eq!(first_shown_image("[[File:A.png|Spoiler [[B]] here]]"), Some("A.png".into()));
        assert_eq!(first_shown_image("text"), None);
        assert_eq!(images("<gallery spoiler>\nA.png\n</gallery>"), ["A.png"]);
    }

    #[test]
    fn category_links() {
        assert_eq!(category_of("Category: Cat  A"), Some("cat a".into()));
        assert_eq!(category_of("category:x"), Some("x".into()));
        assert_eq!(category_of("Page"), None);
        let (out, n) = rewrite_category_links("[[Category:Old]] [[category: old|x]] [[Old]] [[Category:Older]]", "old", "New A");
        assert_eq!(n, 2);
        assert_eq!(out, "[[Category:New A]] [[Category:New A|x]] [[Old]] [[Category:Older]]");
    }

    #[test]
    fn names_compare_loosely() {
        assert_eq!(norm("  Page   A "), "page a");
        assert_eq!(norm("ÄB"), "äb");
        assert_eq!(pipe_trick("Page A (Example)"), "Page A");
        assert_eq!(pipe_trick("(Only)"), "(Only)");
        assert!(has_link_chars("a#b") && has_link_chars("a|b") && !has_link_chars("a (b)"));
    }

    #[test]
    fn summaries() {
        let body = "> An opening quote.\n\n## Head\n\nFirst **paragraph**\ncontinues.\n\nSecond.\n\n## Later\n\n- list\n\n### Sub\n\nSub text.";
        assert_eq!(summary(body), "First **paragraph**\ncontinues.");
        // A section that starts with a list shows its first paragraph further down.
        assert_eq!(section_summary(body, "later").unwrap(), "Sub text.");
        assert_eq!(section_summary(body, "sub").unwrap(), "Sub text.");
        assert_eq!(section_summary(body, "head").unwrap(), "First **paragraph**\ncontinues.");
        assert!(section_summary(body, "missing").is_none());
        assert_eq!(summary("```\ncode\n```\n\nText"), "Text");
        assert_eq!(summary(""), "");
        let long = format!("{} [[Some page|link text]] end", "word ".repeat(118));
        let s = summary(&long);
        assert!(s.ends_with('…') && !s.contains("[[") && s.len() < long.len(), "{s}");
    }
}
