//! What deep search (search.rs) reads of a page or category file: its text
//! as the reader sees it, cut into places ("Infobox: Born", "Section: Early
//! life"), with Markdown syntax left out, the spoilers in it and the links'
//! targets (a link matches by its shown text and by the page it points to).
//!
//! Searched: title, aliases, page text (tables, footnotes, captions, quote
//! boxes included), every infobox value as shown, category text. Not
//! searched: hidden template values, embeds (they count on their own page),
//! code blocks, `<pagelist>` and `<familytree>` lines.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infobox::{self, Field, Infobox, strings};
use crate::pages::{meta_aliases, meta_infobox, meta_title, parse};
use crate::textimages::{gallery_close, gallery_open, image_at, image_is_spoiler, quote_close, quote_open};
use crate::wikilinks::{
    atx_heading, embed_line, footnote_def_label, is_hr, links_in_line, spoiler_at, text_lines,
};

/// Where in the page a piece of text is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "name", rename_all = "camelCase")]
pub enum Place {
    Title,
    Alias,
    /// An infobox field (its label).
    Field(String),
    /// Page text before the first heading.
    Text,
    /// Page text under a heading (its text).
    Section(String),
    /// Footnotes.
    Notes,
    CategoryText,
}

impl Place {
    /// Results list title and alias matches first, then infobox, then text.
    pub fn rank(&self) -> u8 {
        match self {
            Place::Title => 0,
            Place::Alias => 1,
            Place::Field(_) => 2,
            _ => 3,
        }
    }

    /// The place as shown in results; spoilers in a heading are hidden unless `spoilers`.
    pub fn label(&self, spoilers: bool) -> String {
        match self {
            Place::Title => "Title".into(),
            Place::Alias => "Alias".into(),
            Place::Field(l) => format!("Infobox: {}", if l.trim().is_empty() { "(no label)" } else { l.trim() }),
            Place::Text => "Text".into(),
            Place::Section(h) => format!("Section: {}", unmark_spoilers(h, spoilers)),
            Place::Notes => "Notes".into(),
            Place::CategoryText => "Category text".into(),
        }
    }
}

/// Text with `||spoilers||`: their text (`show`), else a block in their place.
fn unmark_spoilers(text: &str, show: bool) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(a) = rest.find("||") {
        let Some(len) = rest[a + 2..].find("||") else { break };
        out.push_str(&rest[..a]);
        out.push_str(if show { &rest[a + 2..a + 2 + len] } else { "\u{2592}\u{2592}\u{2592}" });
        rest = &rest[a + 4 + len..];
    }
    out.push_str(rest);
    out
}

/// A run of plain text in one place. Ranges are byte offsets in `text`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Seg {
    pub place: Place,
    pub text: String,
    /// Parts hidden as spoilers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spoilers: Vec<(u32, u32)>,
    /// Links whose target differs from their shown text: shown text's range, target.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<(u32, u32, String)>,
    /// The whole text is a spoiler (a spoiler field).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
}

/// Collects plain text, collapsing white space.
#[derive(Default)]
struct Plain {
    text: String,
    spoilers: Vec<(u32, u32)>,
    links: Vec<(u32, u32, String)>,
}

impl Plain {
    fn len(&self) -> u32 {
        self.text.len() as u32
    }

    fn push(&mut self, s: &str) {
        for c in s.chars() {
            if c.is_whitespace() {
                if !self.text.is_empty() && !self.text.ends_with(' ') {
                    self.text.push(' ');
                }
            } else {
                self.text.push(c);
            }
        }
    }

    /// A gap between two pieces (lines, cells, list items).
    fn gap(&mut self, sep: &str) {
        let trimmed = self.text.trim_end().len();
        self.text.truncate(trimmed);
        if !self.text.is_empty() {
            self.text.push_str(sep);
        }
    }

    /// Text from `start` to here is a spoiler.
    fn spoiler_from(&mut self, start: u32) {
        let end = self.text.trim_end().len() as u32;
        if end > start {
            self.spoilers.push((start, end));
        }
    }

    /// Plain text of inline Markdown (one line): links show their text,
    /// emphasis marks, code ticks, tags and footnote marks go.
    fn inline(&mut self, text: &str) {
        let mut links = Vec::new();
        links_in_line(text, 0, 0, &mut links);
        let mut links = links.into_iter().peekable();
        let b = text.as_bytes();
        let mut i = 0;
        while i < text.len() {
            while links.peek().is_some_and(|l| l.start < i) {
                links.next();
            }
            if let Some(l) = links.peek().filter(|l| l.start == i) {
                let start = self.len();
                self.push(&l.shown_text());
                let shown = &self.text[start as usize..];
                if !l.page.is_empty() && fold(shown).trim() != fold(&l.page).trim() {
                    let end = self.text.trim_end().len() as u32;
                    self.links.push((start, end.max(start), l.page.clone()));
                }
                i = l.end;
                links.next();
                continue;
            }
            let c = text[i..].chars().next().unwrap();
            match c {
                '\\' if i + 1 < text.len() => {
                    let next = text[i + 1..].chars().next().unwrap();
                    if next.is_ascii_punctuation() {
                        self.push(&next.to_string());
                        i += 1 + next.len_utf8();
                    } else {
                        self.push("\\");
                        i += 1;
                    }
                }
                '`' => {
                    let n = b[i..].iter().take_while(|&&c| c == b'`').count();
                    let ticks = &text[i..i + n];
                    match text[i + n..].find(ticks) {
                        Some(end) => {
                            self.push(text[i + n..i + n + end].trim());
                            i += n + end + n;
                        }
                        None => {
                            self.push(ticks);
                            i += n;
                        }
                    }
                }
                '|' if spoiler_at(text, i).is_some() => {
                    let end = spoiler_at(text, i).unwrap();
                    let start = self.len();
                    self.inline(&text[i + 2..end - 2]);
                    self.spoiler_from(start);
                    i = end;
                }
                '*' | '~' => i += 1,
                '_' => {
                    let prev = text[..i].chars().next_back();
                    let next = text[i + 1..].chars().next();
                    if prev.is_some_and(char::is_alphanumeric) && next.is_some_and(char::is_alphanumeric) {
                        self.push("_");
                    }
                    i += 1;
                }
                '[' if text[i..].starts_with("[[") && image_at(text, i).is_some() => {
                    let (end, inner) = image_at(text, i).unwrap();
                    let caption = image_caption(inner);
                    if !caption.is_empty() {
                        self.gap(" ");
                        let start = self.len();
                        self.inline(&caption);
                        if image_is_spoiler(inner) {
                            self.spoiler_from(start);
                        }
                        self.push(" ");
                    }
                    i = end;
                }
                '[' if text[i..].starts_with("[^") => match text[i..].find(']') {
                    Some(end) if !text[i + 2..i + end].contains(char::is_whitespace) => i += end + 1,
                    _ => {
                        self.push("[");
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
                                self.inline(&text[open + 1..open + close]);
                                i = after + paren + 1;
                                continue;
                            }
                        }
                    }
                    self.push(&c.to_string());
                    i += 1;
                }
                '<' => match text[i..].find('>') {
                    Some(end) if text[i + 1..].starts_with(|ch: char| ch.is_ascii_alphabetic() || ch == '/') => {
                        self.push(" ");
                        i += end + 1;
                    }
                    _ => {
                        self.push("<");
                        i += 1;
                    }
                },
                '&' => {
                    let entity = ENTITIES.iter().find(|(e, _)| text[i..].starts_with(e));
                    match entity {
                        Some((e, s)) => {
                            self.push(s);
                            i += e.len();
                        }
                        None => {
                            self.push("&");
                            i += 1;
                        }
                    }
                }
                _ => {
                    self.push(&text[i..i + c.len_utf8()]);
                    i += c.len_utf8();
                }
            }
        }
    }

    fn into_seg(self, place: Place, hidden: bool) -> Option<Seg> {
        let text = self.text.trim_end().to_string();
        if text.is_empty() {
            return None;
        }
        Some(Seg { place, text, spoilers: self.spoilers, links: self.links, hidden })
    }
}

const ENTITIES: &[(&str, &str)] =
    &[("&#124;", "|"), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&nbsp;", " ")];

/// The caption inside `File:Name.png|right|medium|Caption` (option words skipped).
fn image_caption(inner: &str) -> String {
    let mut parts = inner.split('|').skip(1).peekable();
    while let Some(p) = parts.peek() {
        let w = p.trim_end_matches('\\').trim().to_ascii_lowercase();
        if matches!(w.as_str(), "right" | "left" | "center" | "centre" | "full" | "small" | "medium" | "large" | "spoiler") {
            parts.next();
        } else {
            break;
        }
    }
    parts.collect::<Vec<_>>().join("|").replace("&#124;", "|")
}

/// Text segments in the order of their places; text in one place is joined.
#[derive(Default)]
struct Segs {
    list: Vec<(Place, Plain)>,
}

impl Segs {
    fn at(&mut self, place: &Place) -> &mut Plain {
        let i = match self.list.iter().position(|(p, _)| p == place) {
            Some(i) => i,
            None => {
                self.list.push((place.clone(), Plain::default()));
                self.list.len() - 1
            }
        };
        let plain = &mut self.list[i].1;
        plain.gap(" ");
        plain
    }

    fn finish(self, out: &mut Vec<Seg>) {
        out.extend(self.list.into_iter().filter_map(|(place, plain)| plain.into_seg(place, false)));
    }
}

/// Drops a line's block markers: `>` quotes, list bullets and numbers, task boxes.
fn strip_block_marks(line: &str) -> &str {
    let mut t = line.trim();
    loop {
        if let Some(rest) = t.strip_prefix('>') {
            t = rest.trim_start();
            continue;
        }
        if t.len() > 1 && t.starts_with(['-', '*', '+']) && t[1..].starts_with([' ', '\t']) {
            t = t[1..].trim_start();
            continue;
        }
        if let Some(p) = t.find(['.', ')']) {
            if p > 0 && p <= 9 && t[..p].bytes().all(|c| c.is_ascii_digit()) && t[p + 1..].starts_with([' ', '\t']) {
                t = t[p + 1..].trim_start();
                continue;
            }
        }
        break;
    }
    for tick in ["[ ] ", "[x] ", "[X] "] {
        if let Some(rest) = t.strip_prefix(tick) {
            return rest;
        }
    }
    t
}

/// A table row's cells (`\|` inside cells is a `|` of a link or spoiler);
/// None for a line that isn't a table row; Some(empty) for the `|---|` line.
fn table_cells(line: &str) -> Option<Vec<String>> {
    let t = line.trim();
    if !t.starts_with('|') {
        return None;
    }
    if t.chars().all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t')) {
        return Some(Vec::new());
    }
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut chars = t.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                cell.push('|');
                chars.next();
            }
            '|' => cells.push(std::mem::take(&mut cell)),
            _ => cell.push(c),
        }
    }
    cells.push(cell);
    Some(cells.into_iter().map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).collect())
}

/// One line of text (outside galleries) into `plain`.
fn line_into(plain: &mut Plain, line: &str) {
    if let Some(cells) = table_cells(line) {
        for c in cells {
            plain.gap(" ");
            plain.inline(&c);
        }
        return;
    }
    let t = strip_block_marks(line);
    for tag in ["by", "source"] {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        if t.len() >= open.len() && t[..open.len()].eq_ignore_ascii_case(&open) && t.to_ascii_lowercase().ends_with(&close) {
            plain.inline(&t[open.len()..t.len() - close.len()]);
            return;
        }
    }
    plain.inline(t);
}

/// A heading's plain text for its place's label; its spoilers stay marked
/// `||…||` so the label can hide them ([`Place::label`]).
fn heading_label(raw: &str) -> String {
    let mut h = Plain::default();
    h.inline(raw);
    let text = h.text.trim_end();
    let mut out = String::new();
    let mut last = 0;
    for &(a, b) in &h.spoilers {
        let (a, b) = (a as usize, (b as usize).min(text.len()));
        out.push_str(&text[last..a]);
        out.push_str("||");
        out.push_str(&text[a..b]);
        out.push_str("||");
        last = b;
    }
    out.push_str(&text[last.min(text.len())..]);
    out
}

/// Page or category text, cut into places. `fixed`: everything goes into
/// this place (category text); else Text / Section / Notes.
fn body_segs(body: &str, fixed: Option<Place>, out: &mut Vec<Seg>) {
    let mut segs = Segs::default();
    let mut section = fixed.clone().unwrap_or(Place::Text);
    let notes = fixed.clone().unwrap_or(Place::Notes);
    let mut gallery: Option<bool> = None;
    let mut in_notes = false;
    text_lines(body, |_, _, line| {
        let t = line.trim();
        if let Some(spoiler) = gallery {
            if gallery_close(line) {
                gallery = None;
            } else if let Some((_, caption)) = t.split_once('|') {
                let plain = segs.at(&section);
                let start = plain.len();
                plain.inline(&caption.replace("&#124;", "|"));
                if spoiler {
                    plain.spoiler_from(start);
                }
            }
            return;
        }
        if let Some(spoiler) = gallery_open(line) {
            gallery = Some(spoiler);
            return;
        }
        if t.is_empty() {
            in_notes = false;
            return;
        }
        if in_notes && (line.starts_with("  ") || line.starts_with('\t')) {
            segs.at(&notes).inline(t);
            return;
        }
        in_notes = false;
        if let Some(label) = footnote_def_label(t) {
            in_notes = true;
            segs.at(&notes).inline(&t[label.len() + 4..]);
            return;
        }
        if let Some((_, raw)) = atx_heading(line) {
            if fixed.is_none() {
                section = Place::Section(heading_label(raw));
            }
            segs.at(&section).inline(raw);
            return;
        }
        if quote_open(line)
            || quote_close(line)
            || is_hr(t)
            || embed_line(line, 0, 0).is_some()
            || t.starts_with("<pagelist")
            || t.starts_with("<familytree")
            || t.starts_with("<!--")
        {
            return;
        }
        line_into(segs.at(&section), line);
    });
    segs.finish(out);
}

// ---- infobox values, as shown ----

/// A number as the infobox shows it (en: "1,234.5"; at most 3 decimals).
pub fn number_text(n: f64) -> String {
    if !n.is_finite() {
        return n.to_string();
    }
    let rounded = (n * 1000.0).round() / 1000.0;
    let neg = rounded < 0.0;
    let s = format!("{:.3}", rounded.abs());
    let (int, frac) = s.split_once('.').unwrap_or((&s, ""));
    let mut grouped = String::new();
    for (k, c) in int.chars().enumerate() {
        if k > 0 && (int.len() - k) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let frac = frac.trim_end_matches('0');
    let sign = if neg && (int != "0" || !frac.is_empty()) { "-" } else { "" };
    if frac.is_empty() { format!("{sign}{grouped}") } else { format!("{sign}{grouped}.{frac}") }
}

/// A JSON number as JavaScript's String() writes it (whole numbers without ".0").
fn js_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", n as i64) } else { n.to_string() }
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// One date: "c. 3.4.250 AC" (same as pointText in src/infobox.ts).
fn point_text(p: &Value, with_era: bool) -> String {
    let Some(year) = num(p.get("year")) else { return String::new() };
    let year = if year < 0.0 { format!("\u{2212}{}", js_number(-year)) } else { js_number(year) };
    let month = num(p.get("month")).filter(|m| *m != 0.0);
    let day = num(p.get("day")).filter(|d| *d != 0.0);
    let dm = match month {
        Some(m) => format!("{}{}.", day.map(|d| format!("{}.", js_number(d))).unwrap_or_default(), js_number(m)),
        None => String::new(),
    };
    let q = match p.get("qualifier").and_then(Value::as_str) {
        Some("c") => "c. ",
        Some("before") => "before ",
        Some("after") => "after ",
        _ => "",
    };
    let era = p.get("era").and_then(Value::as_str).map(str::trim).filter(|e| with_era && !e.is_empty());
    format!("{q}{dm}{year}{}", era.map(|e| format!(" {e}")).unwrap_or_default())
}

/// A date or range as shown (same as formatDate in src/infobox.ts).
pub fn format_date(v: &Value) -> String {
    let Some(o) = v.as_object() else { return String::new() };
    if !o.contains_key("start") && !o.contains_key("end") {
        return point_text(v, true);
    }
    let empty = Value::Object(Default::default());
    let start = o.get("start").filter(|s| s.is_object()).unwrap_or(&empty);
    if o.get("end").and_then(Value::as_str) == Some("present") {
        let s = point_text(start, true);
        return if s.is_empty() { s } else { format!("{s} \u{2013} present") };
    }
    let end = o.get("end").filter(|e| e.is_object()).unwrap_or(&empty);
    let era = |p: &Value| p.get("era").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let same_era = era(start) == era(end);
    let s = point_text(start, !same_era || end.get("year").is_none());
    let e = point_text(end, true);
    match (s.is_empty(), e.is_empty()) {
        (false, false) => format!("{s} \u{2013} {e}"),
        (false, true) => s,
        (true, false) => format!("until {e}"),
        _ => String::new(),
    }
}

/// A Page link entry: a page name, or words around a link.
fn link_entry(plain: &mut Plain, entry: &str) {
    if entry.contains("[[") {
        plain.inline(entry);
    } else {
        plain.inline(&format!("[[{}]]", entry.replace(['[', ']', '|', '\n'], "").trim()));
    }
}

/// A field's value as plain text, as the infobox shows it.
fn field_plain(f: &Field) -> Plain {
    let mut p = Plain::default();
    let Some(v) = f.value.as_ref().filter(|v| !infobox::is_empty_value(v)) else { return p };
    let text_like = |p: &mut Plain, v: &Value| match v {
        Value::String(s) => s.lines().for_each(|l| {
            p.gap(" ");
            line_into(p, l)
        }),
        Value::Number(n) => p.push(&n.to_string()),
        Value::Bool(b) => p.push(if *b { "Yes" } else { "No" }),
        Value::Array(items) => items.iter().filter_map(Value::as_str).for_each(|s| {
            p.gap(", ");
            p.inline(s)
        }),
        _ => {}
    };
    match f.kind.as_str() {
        infobox::NUMBER => match v.as_f64() {
            Some(n) => p.push(&number_text(n)),
            None => text_like(&mut p, v),
        },
        infobox::YES_NO => match v.as_bool() {
            Some(b) => p.push(if b { "Yes" } else { "No" }),
            None => text_like(&mut p, v),
        },
        infobox::LINK | infobox::LINKS | infobox::LINKED_FROM => {
            for s in strings(v) {
                p.gap(", ");
                link_entry(&mut p, s);
            }
        }
        infobox::DATE => p.push(&format_date(v)),
        infobox::DATE_PLACE | infobox::DATE_TEXT => {
            let entries: Vec<&Value> = match v {
                Value::Array(a) => a.iter().filter(|e| e.is_object()).collect(),
                Value::Object(_) => vec![v],
                _ => Vec::new(),
            };
            for e in entries {
                p.gap("; ");
                if let Some(d) = e.get("date") {
                    p.push(&format_date(d));
                }
                if let Some(t) = e.get("text").and_then(Value::as_str) {
                    p.gap(" ");
                    p.inline(t);
                }
            }
        }
        infobox::IMAGE => {
            if let Some(c) = v.get("caption").and_then(Value::as_str) {
                p.inline(c);
            }
        }
        infobox::HEADING | infobox::DIVIDER => {}
        _ => text_like(&mut p, v),
    }
    // Notes (M13) are read with their field.
    for t in f.note_texts() {
        p.gap(" ");
        p.inline(t);
    }
    p
}

fn infobox_segs(ib: &Infobox, out: &mut Vec<Seg>) {
    for f in &ib.fields {
        if let Some(seg) = field_plain(f).into_seg(Place::Field(f.label.clone()), f.is_spoiler()) {
            out.push(seg);
        }
    }
}

/// Everything search reads of a page file.
pub fn page_segs(file_text: &str, file_name: &str) -> Vec<Seg> {
    let (fm, body) = parse(file_text).unwrap_or_else(|_| (Default::default(), file_text.to_string()));
    let mut out = Vec::new();
    let title = meta_title(&fm, file_name);
    out.push(Seg { place: Place::Title, text: title, spoilers: vec![], links: vec![], hidden: false });
    for a in meta_aliases(&fm) {
        out.push(Seg { place: Place::Alias, text: a, spoilers: vec![], links: vec![], hidden: false });
    }
    if let Ok(Some(ib)) = meta_infobox(&fm) {
        infobox_segs(&ib, &mut out);
    }
    body_segs(&body, None, &mut out);
    out
}

/// Everything search reads of a category file: its text.
pub fn category_segs(file_text: &str) -> Vec<Seg> {
    let (_, body) = parse(file_text).unwrap_or_else(|_| (Default::default(), file_text.to_string()));
    let mut out = Vec::new();
    body_segs(&body, Some(Place::CategoryText), &mut out);
    out
}

// ---- matching ----

/// Folds one character for matching: accents dropped, lower case (same as
/// foldChar in src/search.ts).
pub fn fold_char(c: char, out: &mut String) {
    use unicode_normalization::char::{decompose_canonical, is_combining_mark};
    if c.is_whitespace() {
        out.push(' ');
        return;
    }
    decompose_canonical(c, |d| {
        if !is_combining_mark(d) {
            out.extend(d.to_lowercase());
        }
    });
}

pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    s.chars().for_each(|c| fold_char(c, &mut out));
    out
}

/// `text` folded, with (text offset, folded offset) at every character start
/// (and one past the end).
pub fn fold_map(text: &str) -> (String, Vec<(u32, u32)>) {
    let mut out = String::with_capacity(text.len());
    let mut map = Vec::with_capacity(text.len() + 1);
    for (i, c) in text.char_indices() {
        map.push((i as u32, out.len() as u32));
        fold_char(c, &mut out);
    }
    map.push((text.len() as u32, out.len() as u32));
    (out, map)
}

/// Letters and digits (same as WORD_CHAR in src/search.ts).
pub fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || c.is_numeric()
}

/// The words and `"phrases"` of a query, folded; words without a letter or digit are dropped.
pub fn parse_query(q: &str) -> Vec<String> {
    let mut raw = Vec::new();
    let mut rest = q;
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        if let Some(after) = rest.strip_prefix('"') {
            let end = after.find('"').unwrap_or(after.len());
            raw.push(&after[..end]);
            rest = after.get(end + 1..).unwrap_or("");
        } else {
            let end = rest.find(|c: char| c.is_whitespace() || c == '"').unwrap_or(rest.len());
            raw.push(&rest[..end]);
            rest = &rest[end..];
        }
    }
    let mut terms: Vec<String> = Vec::new();
    for r in raw {
        let t = fold(r).split_whitespace().collect::<Vec<_>>().join(" ");
        if t.chars().any(is_word_char) && !terms.contains(&t) {
            terms.push(t);
        }
    }
    terms
}

/// Where `term` (folded) occurs in `hay` (folded) at the start of a word.
pub fn word_matches<'a>(hay: &'a str, term: &'a str) -> impl Iterator<Item = usize> + 'a {
    let starts_word = term.chars().next().is_some_and(is_word_char);
    hay.match_indices(term)
        .map(|(i, _)| i)
        .filter(move |&i| !starts_word || !hay[..i].chars().next_back().is_some_and(is_word_char))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(segs: &[Seg]) -> Vec<(String, String)> {
        segs.iter().map(|s| (s.place.label(true), s.text.clone())).collect()
    }

    #[test]
    fn page_places_and_plain_text() {
        let file = "---\ntitle: Page A\naliases: [Alias A]\ninfobox:\n  fields:\n  - label: Born\n    type: date\n    value: { year: 250, qualifier: c }\n  - label: Father\n    type: links\n    value: [Page B, 'Lord [[Page C]] (supposedly)']\n  - label: Secret\n    type: text\n    value: Hidden thing\n    spoiler: true\n  hidden:\n  - label: Old\n    type: text\n    value: Old value\n---\nIntro **bold** [[Page D|shown]].\n\n## Early life\n\n- Item with `code` and ||secret word||\n| A | [[Page E\\|E]] |\n|---|---|\n{{Page F}}\n<pagelist from=\"X\">\n[[File:Pic.png|right|spoiler|Caption [[Page G]]]]\n\n<quote>\nQuoted words\n<by>[[Page H]]</by>\n</quote>\n\nNote ref[^1].\n\n[^1]: The note.\n";
        let segs = page_segs(file, "Page A.md");
        assert_eq!(
            texts(&segs),
            vec![
                ("Title".into(), "Page A".into()),
                ("Alias".into(), "Alias A".into()),
                ("Infobox: Born".into(), "c. 250".into()),
                ("Infobox: Father".into(), "Page B, Lord Page C (supposedly)".into()),
                ("Infobox: Secret".into(), "Hidden thing".into()),
                ("Text".into(), "Intro bold shown.".into()),
                ("Section: Early life".into(), "Early life Item with code and secret word A E Caption Page G Quoted words Page H Note ref.".into()),
                ("Notes".into(), "The note.".into()),
            ]
        );
        assert!(segs[4].hidden);
        let text = &segs[5];
        assert_eq!(text.links, vec![(11, 16, "Page D".into())]);
        let early = &segs[6];
        let spoiled: Vec<&str> = early.spoilers.iter().map(|&(a, b)| &early.text[a as usize..b as usize]).collect();
        assert_eq!(spoiled, vec!["secret word", "Caption Page G"]);
        let linked: Vec<(&str, &str)> = early.links.iter().map(|(a, b, t)| (&early.text[*a as usize..*b as usize], t.as_str())).collect();
        assert_eq!(linked, vec![("E", "Page E")]);
    }

    #[test]
    fn notes_are_searched_with_their_field() {
        let file = "---\ntitle: Page A\ninfobox:\n  fields:\n  - label: House\n    type: links\n    value: [Page B]\n    notes:\n    - i: 0\n      text: '*(by marriage)*'\n---\nText.\n";
        let segs = page_segs(file, "Page A.md");
        let house = segs.iter().find(|s| matches!(&s.place, Place::Field(l) if l == "House")).unwrap();
        assert_eq!(house.text, "Page B (by marriage)");
    }

    #[test]
    fn values_as_shown() {
        assert_eq!(number_text(1234567.0), "1,234,567");
        assert_eq!(number_text(-1234.56789), "-1,234.568");
        assert_eq!(number_text(0.5), "0.5");
        let d: Value = serde_json::from_str(r#"{"start":{"year":283,"era":"AC"},"end":{"year":298,"era":"AC","month":3,"day":4}}"#).unwrap();
        assert_eq!(format_date(&d), "283 \u{2013} 4.3.298 AC");
        let p: Value = serde_json::from_str(r#"{"start":{"year":-5},"end":"present"}"#).unwrap();
        assert_eq!(format_date(&p), "\u{2212}5 \u{2013} present");
    }

    #[test]
    fn shared_search_cases() {
        let cases: Value = serde_json::from_str(include_str!("../../shared-tests/search.json")).unwrap();
        for case in cases["fold"].as_array().unwrap() {
            assert_eq!(fold(case[0].as_str().unwrap()), case[1].as_str().unwrap(), "fold {}", case[0]);
        }
        for case in cases["queries"].as_array().unwrap() {
            let got = parse_query(case["query"].as_str().unwrap());
            let want: Vec<String> = serde_json::from_value(case["terms"].clone()).unwrap();
            assert_eq!(got, want, "query {}", case["query"]);
        }
        for case in cases["matches"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let (folded, map) = fold_map(text);
            let mut got: Vec<String> = Vec::new();
            for term in parse_query(case["query"].as_str().unwrap()) {
                for at in word_matches(&folded, &term) {
                    let from = map.iter().find(|m| m.1 as usize >= at).unwrap().0 as usize;
                    let to = map.iter().find(|m| m.1 as usize >= at + term.len()).unwrap().0 as usize;
                    got.push(text[from..to].to_string());
                }
            }
            let want: Vec<String> = serde_json::from_value(case["found"].clone()).unwrap();
            assert_eq!(got, want, "{}", case["name"]);
        }
    }
}
