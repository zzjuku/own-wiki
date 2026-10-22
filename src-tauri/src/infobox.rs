//! Templates and infoboxes.
//!
//! A template (stored in `project.json` under `templates`) is a starting
//! point: a list of typed fields, an infobox colour and starter text. A page
//! created from it gets its own copy of the fields in its front matter
//! (`infobox:`), with the values next to their definitions:
//!
//! ```yaml
//! infobox:
//!   template: example-k2j4      # id of the template it came from
//!   color: '#cedff2'
//!   fields:
//!   - key: born                 # the template field it came from (absent: the page's own field)
//!     label: Born
//!     type: date
//!     options: { ranges: true }
//!     value: { start: { year: 250, qualifier: c }, end: present }
//!     spoiler: true             # pages only: the value is hidden until clicked
//!   hidden:                     # values of fields that were removed, kept until restored or discarded
//!   - label: Old field
//!     type: text
//!     value: something
//! ```
//!
//! Changing a template never changes pages by itself; [`apply_template`]
//! pushes the change to a page when the user asks for it. Unknown keys are
//! kept everywhere, so files written by a newer app version survive.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use std::collections::BTreeMap;

use crate::wikilinks::{norm, parse_links, rewrite_links, spoiler_ranges};

// Field types (all of them are listed for reference; the Rust side only
// needs to treat some specially).
#[allow(dead_code)]
pub const ALL_KINDS: &[&str] = &[TEXT, LONG_TEXT, NUMBER, YES_NO, CHOICE, LIST, LINK, LINKS, LINKED_FROM, DATE, DATE_PLACE, DATE_TEXT, IMAGE, HEADING, DIVIDER];
pub const TEXT: &str = "text";
pub const LONG_TEXT: &str = "longtext";
pub const NUMBER: &str = "number";
pub const YES_NO: &str = "yesno";
pub const CHOICE: &str = "choice";
pub const LIST: &str = "list";
pub const LINK: &str = "link";
pub const LINKS: &str = "links";
pub const LINKED_FROM: &str = "linkedfrom";
pub const DATE: &str = "date";
/// A date (or range) with a place after it: `{date, text}`, or a list of them
/// (option `multiple`).
pub const DATE_PLACE: &str = "dateplace";
/// A date (or range) with a smaller note after it; same value as [`DATE_PLACE`].
pub const DATE_TEXT: &str = "datetext";

/// The `{date, text}` entries of a Date, place / Date, text value.
fn date_entries(v: &Value) -> Vec<&Value> {
    match v {
        Value::Array(a) => a.iter().filter(|e| e.is_object()).collect(),
        Value::Object(_) => vec![v],
        _ => Vec::new(),
    }
}
pub const IMAGE: &str = "image";
pub const HEADING: &str = "heading";
/// A thin line in the box with an optional label (the field's label); no value.
pub const DIVIDER: &str = "divider";

fn default_kind() -> String {
    TEXT.into()
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// One field: its definition and (on pages) its value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    /// Template fields: a stable id within the template. Page fields: the
    /// template field they came from; absent for fields the page added itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "type", default = "default_kind")]
    pub kind: String,
    /// Help line shown under the field in the Infobox tab.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub hint: String,
    /// Type options: `choices` (choice), `twoWay` (link, links), `from`
    /// (linked from), `ranges` (date).
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub options: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Field {
    fn has_value(&self) -> bool {
        self.value.as_ref().is_some_and(|v| !is_empty_value(v))
    }

    /// The page hides this field's value as a spoiler (`spoiler: true`, kept in `extra`).
    pub fn is_spoiler(&self) -> bool {
        self.extra.get("spoiler").and_then(Value::as_bool).unwrap_or(false)
    }

    fn definition_eq(&self, other: &Field) -> bool {
        self.label == other.label && self.kind == other.kind && self.hint == other.hint && self.options == other.options
    }
}

/// Empty strings, lists and objects count as no value.
pub fn is_empty_value(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(a) => a.iter().all(is_empty_value),
        Value::Object(o) => o.values().all(is_empty_value),
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    /// Infobox colour (title bar and section headings); none = the theme's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Pre-fills the text of new pages.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub starter_text: String,
    #[serde(default)]
    pub fields: Vec<Field>,
    /// Default categories: new pages get a copy; Apply adds missing ones.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Infobox {
    /// Id of the template the page was created from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The page chose its own colour (Apply then leaves it alone).
    #[serde(default, skip_serializing_if = "is_false")]
    pub own_color: bool,
    #[serde(default)]
    pub fields: Vec<Field>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden: Vec<Field>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A new page's infobox, copied from `t`.
pub fn instantiate(t: &Template) -> Infobox {
    Infobox {
        template: Some(t.id.clone()),
        color: t.color.clone(),
        own_color: false,
        fields: t.fields.iter().map(|f| Field { value: None, ..f.clone() }).collect(),
        hidden: Vec::new(),
        extra: Map::new(),
    }
}

// ---- links in fields ----

/// A link stored in an infobox field (for the link index).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FieldLink {
    /// The field's label.
    pub field: String,
    /// The page name as stored.
    pub target: String,
    /// From a two-way Page link(s) field.
    #[serde(default, skip_serializing_if = "is_false")]
    pub two_way: bool,
    /// Hidden as a spoiler: the field is a spoiler, or the link sits inside
    /// `||…||` in a text field.
    #[serde(default, skip_serializing_if = "is_false")]
    pub spoiler: bool,
    /// A `[[link]]` in a text-like field (not a Page link value).
    #[serde(default, skip_serializing_if = "is_false")]
    pub in_text: bool,
    /// A name typed into a Linked from field (shows only on its own page).
    #[serde(default, skip_serializing_if = "is_false")]
    pub typed: bool,
    /// The words around a Page link entry's link (`[[Bea]] (m. 283)` ->
    /// "(m. 283)"), shown on family-tree couple lines (M12).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<String>,
}

/// A field of a page, as the link index keeps it: its label and type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldName {
    pub label: String,
    pub kind: String,
}

/// A page's Linked from field, as the link index keeps it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReverseDef {
    pub label: String,
    /// Names of the fields it reads.
    #[serde(default)]
    pub from: Vec<String>,
    /// Only pages from these templates (ids); empty = any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub templates: Vec<String>,
    /// Shown as a list at the bottom of the page.
    #[serde(default, skip_serializing_if = "is_false")]
    pub list: bool,
}

fn option_strings(f: &Field, name: &str) -> Vec<String> {
    f.options.get(name).map(|v| strings(v).into_iter().map(str::to_string).collect()).unwrap_or_default()
}

/// The page's value fields (label and type) and its Linked from fields.
pub fn field_infos(ib: &Infobox) -> (Vec<FieldName>, Vec<ReverseDef>) {
    let fields = ib.fields.iter().filter(|f| f.kind != HEADING && f.kind != DIVIDER);
    let names = fields.clone().map(|f| FieldName { label: f.label.clone(), kind: f.kind.clone() }).collect();
    let reverse = fields
        .filter(|f| f.kind == LINKED_FROM)
        .map(|f| ReverseDef {
            label: f.label.clone(),
            from: option_strings(f, "from"),
            templates: option_strings(f, "templates"),
            list: f.options.get("show").and_then(Value::as_str) == Some("list"),
        })
        .collect();
    (names, reverse)
}

pub(crate) fn strings(v: &Value) -> Vec<&str> {
    match v {
        Value::String(s) => vec![s.as_str()],
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

fn option_bool(f: &Field, name: &str) -> bool {
    f.options.get(name).and_then(Value::as_bool).unwrap_or(false)
}

/// The page part of a link field value ("Page" of "Page#Section").
///
/// A value can also hold words around the link (`Lord [[Page A]]`, set in the
/// Infobox tab): then the page is the one in its first `[[link]]`.
pub(crate) fn link_value_page(s: &str) -> &str {
    if s.contains("[[") {
        return parse_links(s).into_iter().find(|l| !l.page.is_empty()).map(|l| &s[l.page_start..l.page_end]).unwrap_or("");
    }
    s.split('#').next().unwrap_or("").trim()
}

/// The words around a link field value's link, if it has any.
fn link_value_words(s: &str) -> Option<String> {
    let l = parse_links(s).into_iter().find(|l| !l.page.is_empty())?;
    let rest = format!("{} {}", &s[..l.start], &s[l.end..]);
    let words = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    (!words.is_empty()).then_some(words)
}

/// Every link in the infobox's fields (not in hidden values). Typed-in
/// entries of Linked from fields count like Page link values.
pub fn field_links(ib: &Infobox) -> Vec<FieldLink> {
    let mut out = Vec::new();
    for f in &ib.fields {
        let Some(v) = &f.value else { continue };
        let spoiler = f.is_spoiler();
        let link = |target: String, two_way: bool, spoiler: bool| FieldLink {
            field: f.label.clone(),
            target,
            two_way,
            spoiler,
            in_text: false,
            typed: f.kind == LINKED_FROM,
            words: None,
        };
        // [[links]] in text, each a spoiler if it sits inside ||…||.
        let text_links = |s: &str, out: &mut Vec<FieldLink>| {
            let hidden = spoiler_ranges(s);
            for l in parse_links(s).into_iter().filter(|l| !l.page.is_empty()) {
                let inside = hidden.iter().any(|&(a, b)| a <= l.start && l.end <= b);
                out.push(FieldLink { in_text: true, ..link(l.page, false, spoiler || inside) });
            }
        };
        match f.kind.as_str() {
            LINK | LINKS | LINKED_FROM => {
                let two_way = f.kind != LINKED_FROM && option_bool(f, "twoWay");
                for s in strings(v) {
                    let page = link_value_page(s);
                    if !page.is_empty() {
                        out.push(FieldLink { words: link_value_words(s), ..link(page.to_string(), two_way, spoiler) });
                    }
                }
            }
            TEXT | LONG_TEXT | LIST => {
                for s in strings(v) {
                    text_links(s, &mut out);
                }
            }
            IMAGE => {
                if let Some(c) = v.get("caption").and_then(Value::as_str) {
                    text_links(c, &mut out);
                }
            }
            DATE_PLACE | DATE_TEXT => {
                for e in date_entries(v) {
                    if let Some(t) = e.get("text").and_then(Value::as_str) {
                        text_links(t, &mut out);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// A date value's sort key: year, month, day (missing ones 0); a range sorts
/// by its start. Eras aren't compared until calendars exist (M14).
fn date_key(v: &Value) -> Option<Vec<f64>> {
    let point = match v.get("start") {
        Some(start) => start,
        None if v.get("end").is_some() => return None,
        None => v,
    };
    let num = |k: &str| point.get(k).and_then(Value::as_f64);
    Some(vec![num("year")?, num("month").unwrap_or(0.0), num("day").unwrap_or(0.0)])
}

/// The values page lists and reverse fields can sort by: Number and Date
/// fields that have a value and aren't spoilers (a hidden value mustn't show
/// through the order). Keyed by the field's label as compared ([`norm`]).
pub fn sortable_values(ib: &Infobox) -> BTreeMap<String, Vec<f64>> {
    let mut out = BTreeMap::new();
    for f in ib.fields.iter().filter(|f| !f.is_spoiler()) {
        let key = match (f.kind.as_str(), &f.value) {
            (NUMBER, Some(v)) => v.as_f64().map(|n| vec![n]),
            (DATE, Some(v)) if v.is_object() => date_key(v),
            (DATE_PLACE | DATE_TEXT, Some(v)) => date_entries(v).first().and_then(|e| e.get("date")).and_then(date_key),
            _ => None,
        };
        if let Some(k) = key {
            out.entry(norm(&f.label)).or_insert(k);
        }
    }
    out
}

/// Short values of Text, List, Choice and Page link fields (not spoilers),
/// keyed by the field's label as compared ([`norm`]): a family tree's house
/// field reads them (M12). A value with links gives the linked pages' names;
/// spoiler parts (`||…||`) are left out.
pub fn short_texts(ib: &Infobox) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in ib.fields.iter().filter(|f| !f.is_spoiler()) {
        let Some(v) = &f.value else { continue };
        let mut values: Vec<String> = Vec::new();
        match f.kind.as_str() {
            LINK | LINKS => values.extend(strings(v).into_iter().map(link_value_page).map(str::to_string)),
            TEXT | LIST | CHOICE => {
                for s in strings(v) {
                    let hidden = spoiler_ranges(s);
                    let links: Vec<String> = parse_links(s)
                        .into_iter()
                        .filter(|l| !l.page.is_empty() && !hidden.iter().any(|&(a, b)| a <= l.start && l.end <= b))
                        .map(|l| l.page)
                        .collect();
                    if !links.is_empty() || s.contains("[[") {
                        values.extend(links);
                        continue;
                    }
                    let mut plain = String::new();
                    let mut last = 0;
                    for &(a, b) in &hidden {
                        plain.push_str(&s[last..a]);
                        last = b;
                    }
                    plain.push_str(&s[last..]);
                    values.push(plain);
                }
            }
            _ => continue,
        }
        let values: Vec<String> = values.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s.len() <= 200).collect();
        if !values.is_empty() {
            out.entry(norm(&f.label)).or_default().extend(values);
        }
    }
    out
}

/// A birth or death date for family trees (M12): the date's start point.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LifeDate {
    pub year: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub month: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub era: Option<String>,
    /// "c", "before" or "after".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualifier: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub spoiler: bool,
}

/// Birth and death dates: the first Date or Date, place field set to Age:
/// Birth / Death that has a year (like the ages in the infobox).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Life {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birth: Option<LifeDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub death: Option<LifeDate>,
}

impl Life {
    pub fn is_empty(&self) -> bool {
        self.birth.is_none() && self.death.is_none()
    }
}

pub fn life(ib: &Infobox) -> Life {
    let date = |role: &str| {
        ib.fields
            .iter()
            .filter(|f| (f.kind == DATE || f.kind == DATE_PLACE) && f.options.get("age").and_then(Value::as_str) == Some(role))
            .find_map(|f| {
                let v = f.value.as_ref()?;
                let v = if f.kind == DATE_PLACE { date_entries(v).first()?.get("date")? } else { v };
                let p = v.get("start").unwrap_or(v);
                let text = |k: &str| p.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
                Some(LifeDate {
                    year: p.get("year")?.as_f64()?,
                    month: p.get("month").and_then(Value::as_f64),
                    day: p.get("day").and_then(Value::as_f64),
                    era: text("era"),
                    qualifier: text("qualifier"),
                    spoiler: f.is_spoiler(),
                })
            })
    };
    Life { birth: date("birth"), death: date("death") }
}

/// The file (inside `assets/`) of the first image field with an image that
/// isn't a spoiler and isn't a small picture beside the title (hover cards show it).
pub fn first_image(ib: &Infobox) -> Option<String> {
    ib.fields
        .iter()
        .filter(|f| f.kind == IMAGE && !f.is_spoiler() && f.options.get("place").and_then(Value::as_str) != Some("beside"))
        .filter_map(|f| f.value.as_ref()?.get("file")?.as_str())
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

fn rewrite_text(s: &mut String, old: &str, new: &str) -> usize {
    let (text, n) = rewrite_links(s, old, new);
    if n > 0 {
        *s = text;
    }
    n
}

fn rewrite_link_value(s: &mut String, old: &str, new: &str) -> usize {
    if s.contains("[[") {
        return rewrite_text(s, old, new);
    }
    let page = link_value_page(s);
    if page.is_empty() || norm(page) != norm(old) {
        return 0;
    }
    *s = match s.find('#') {
        Some(h) => format!("{new}{}", &s[h..]),
        None => new.to_string(),
    };
    1
}

fn rewrite_field(f: &mut Field, old: &str, new: &str) -> usize {
    let kind = f.kind.clone();
    let Some(v) = f.value.as_mut() else { return 0 };
    let mut n = 0;
    let mut each = |s: &mut String| match kind.as_str() {
        LINK | LINKS | LINKED_FROM => n += rewrite_link_value(s, old, new),
        TEXT | LONG_TEXT | LIST => n += rewrite_text(s, old, new),
        _ => {}
    };
    match v {
        Value::String(s) => each(s),
        Value::Array(a) if kind == DATE_PLACE || kind == DATE_TEXT => {
            for e in a.iter_mut() {
                if let Some(Value::String(t)) = e.get_mut("text") {
                    n += rewrite_text(t, old, new);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| {
            if let Value::String(s) = x {
                each(s)
            }
        }),
        Value::Object(o) if kind == IMAGE => {
            if let Some(Value::String(c)) = o.get_mut("caption") {
                n += rewrite_text(c, old, new);
            }
        }
        Value::Object(o) if kind == DATE_PLACE || kind == DATE_TEXT => {
            if let Some(Value::String(t)) = o.get_mut("text") {
                n += rewrite_text(t, old, new);
            }
        }
        _ => {}
    }
    n
}

/// Points links to `old` at `new` in every field value (hidden values too).
/// Returns how many changed.
pub fn rewrite_infobox_links(ib: &mut Infobox, old: &str, new: &str) -> usize {
    ib.fields.iter_mut().chain(ib.hidden.iter_mut()).map(|f| rewrite_field(f, old, new)).sum()
}

// ---- applying a template to existing pages ----

const STRING_KINDS: &[&str] = &[TEXT, LONG_TEXT, CHOICE, LINK];
const LIST_KINDS: &[&str] = &[LIST, LINKS, LINKED_FROM];

/// A value moved to another field type, converted where nothing is lost
/// (one text <-> a one-entry list, number <-> text). Anything else stays as
/// it is; the form warns about values that don't fit.
pub fn convert_value(v: Value, to: &str) -> Value {
    let to_string = STRING_KINDS.contains(&to);
    let to_list = LIST_KINDS.contains(&to);
    let date_text = to == DATE_PLACE || to == DATE_TEXT;
    match v {
        // A date gets an empty text next to it; a date with no text is a plain date again.
        Value::Object(o) if date_text && !o.contains_key("date") && !o.contains_key("text") => {
            serde_json::json!({ "date": Value::Object(o) })
        }
        Value::Object(mut o) if to == DATE && o.contains_key("date") && o.get("text").is_none_or(is_empty_value) => {
            o.remove("date").unwrap_or(Value::Null)
        }
        Value::Array(a) if to_string && a.len() <= 1 && a.iter().all(Value::is_string) => {
            a.into_iter().next().unwrap_or(Value::Null)
        }
        Value::String(s) if to_list => Value::Array(vec![Value::String(s)]),
        Value::Number(n) if to_string => Value::String(n.to_string()),
        Value::Number(n) if to_list => Value::Array(vec![Value::String(n.to_string())]),
        Value::String(s) if to == NUMBER => match s.trim().parse::<i64>() {
            Ok(i) => Value::from(i),
            Err(_) => match s.trim().parse::<f64>().ok().and_then(serde_json::Number::from_f64) {
                Some(n) => Value::Number(n),
                None => Value::String(s),
            },
        },
        other => other,
    }
}

/// What applying a template changed on one page.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplySummary {
    /// Fields added from the template.
    pub added: usize,
    /// Fields whose label, type, hint or options changed.
    pub updated: usize,
    /// Removed fields whose values were hidden.
    pub hidden: usize,
    /// Removed fields that had no value.
    pub removed: usize,
    pub reordered: bool,
    pub color: bool,
    /// Default categories the page gets.
    #[serde(default)]
    pub categories: usize,
}

/// Brings a page's infobox in line with template `t`: adds new fields,
/// updates labels, types, hints, options and order, and hides the values of
/// fields removed from the template. The page's own fields stay where they
/// are (after the same template field as before). The colour follows the
/// template unless the page chose its own. `None` if nothing would change.
pub fn apply_template(ib: &Infobox, t: &Template) -> Option<(Infobox, ApplySummary)> {
    let mut sum = ApplySummary::default();
    let tkeys: Vec<&str> = t.fields.iter().filter_map(|f| f.key.as_deref()).collect();
    let keyed = |f: &Field| f.key.as_deref().is_some_and(|k| tkeys.contains(&k));

    // Template fields the page doesn't have yet may adopt a page field with
    // the same label, so no field appears twice.
    let mut fields = ib.fields.clone();
    for tf in &t.fields {
        let Some(k) = &tf.key else { continue };
        if fields.iter().any(|f| f.key.as_ref() == Some(k)) {
            continue;
        }
        if let Some(f) = fields.iter_mut().find(|f| !keyed(f) && f.key.is_none() && norm(&f.label) == norm(&tf.label)) {
            f.key = Some(k.clone());
        }
    }

    // The page's own fields, each with the template field it follows.
    // Surviving fields are tracked by id ("k:key" / "o:n") to notice reordering.
    let mut own: Vec<(Option<String>, String, Field)> = Vec::new();
    let mut before: Vec<String> = Vec::new();
    let mut last: Option<String> = None;
    let mut hidden = ib.hidden.clone();
    for f in &fields {
        if keyed(f) {
            last = f.key.clone();
            before.push(format!("k:{}", last.as_deref().unwrap_or("")));
        } else if f.key.is_some() {
            // Removed from the template.
            if f.has_value() {
                hidden.push(Field { key: None, ..f.clone() });
                sum.hidden += 1;
            } else {
                sum.removed += 1;
            }
        } else {
            let id = format!("o:{}", own.len());
            before.push(id.clone());
            own.push((last.clone(), id, f.clone()));
        }
    }

    let mut out: Vec<Field> = Vec::new();
    let mut after: Vec<String> = Vec::new();
    let push_own = |anchor: Option<&String>, out: &mut Vec<Field>, after: &mut Vec<String>| {
        for (a, id, f) in &own {
            if a.as_ref() == anchor {
                out.push(f.clone());
                after.push(id.clone());
            }
        }
    };
    push_own(None, &mut out, &mut after);
    for tf in &t.fields {
        let Some(k) = &tf.key else { continue };
        let mut f = match fields.iter().find(|f| f.key.as_ref() == Some(k)) {
            Some(existing) => {
                let mut f = existing.clone();
                if !f.definition_eq(tf) {
                    sum.updated += 1;
                }
                if f.kind != tf.kind {
                    f.value = f.value.take().map(|v| convert_value(v, &tf.kind));
                }
                after.push(format!("k:{k}"));
                f
            }
            None => {
                sum.added += 1;
                Field { value: None, ..tf.clone() }
            }
        };
        f.label = tf.label.clone();
        f.kind = tf.kind.clone();
        f.hint = tf.hint.clone();
        f.options = tf.options.clone();
        out.push(f);
        push_own(Some(k), &mut out, &mut after);
    }
    sum.reordered = before != after;

    let mut next = Infobox { fields: out, hidden, ..ib.clone() };
    if !ib.own_color && next.color != t.color {
        next.color = t.color.clone();
        sum.color = true;
    }
    if next == *ib {
        return None;
    }
    Some((next, sum))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn field(key: Option<&str>, label: &str, kind: &str, value: Option<Value>) -> Field {
        Field { key: key.map(str::to_string), label: label.into(), kind: kind.into(), value, ..Default::default() }
    }

    fn template(fields: Vec<Field>) -> Template {
        Template { id: "t1".into(), name: "Template A".into(), color: Some("#123456".into()), starter_text: String::new(), fields, categories: Vec::new(), extra: Map::new() }
    }

    #[test]
    fn yaml_round_trip_keeps_unknown_keys() {
        let yaml = "template: t1\ncolor: '#abcdef'\nfields:\n- key: a\n  label: Field A\n  type: text\n  value: x\n  future: 1\n- label: Own\n  type: number\n  value: 7\nlater: true\n";
        let ib: Infobox = serde_yaml_ng::from_str(yaml).unwrap();
        assert_eq!(ib.fields.len(), 2);
        assert_eq!(ib.fields[1].value, Some(json!(7)));
        let back = serde_yaml_ng::to_string(&ib).unwrap();
        assert!(back.contains("future: 1"), "{back}");
        assert!(back.contains("later: true"), "{back}");
        assert!(!back.contains("ownColor"), "{back}");
        assert!(!back.contains("hidden"), "{back}");
    }

    #[test]
    fn instantiate_copies_fields_without_values() {
        let mut t = template(vec![field(Some("a"), "Field A", TEXT, None), field(Some("h"), "Section", HEADING, None)]);
        t.fields[0].hint = "Hint".into();
        let ib = instantiate(&t);
        assert_eq!(ib.template.as_deref(), Some("t1"));
        assert_eq!(ib.color.as_deref(), Some("#123456"));
        assert_eq!(ib.fields, t.fields);
    }

    #[test]
    fn first_image_skips_spoiler_fields() {
        let mut a = field(Some("a"), "Picture A", IMAGE, Some(serde_json::json!({ "file": "a.png" })));
        a.extra.insert("spoiler".into(), Value::Bool(true));
        let mut beside = field(Some("c"), "Arms", IMAGE, Some(serde_json::json!({ "file": "c.png" })));
        beside.options.insert("place".into(), json!("beside"));
        let b = field(Some("b"), "Picture B", IMAGE, Some(serde_json::json!({ "file": "b.png" })));
        let ib = Infobox { template: None, color: None, own_color: false, fields: vec![a, beside, b], hidden: vec![], extra: Map::new() };
        assert_eq!(first_image(&ib), Some("b.png".into()));
    }

    #[test]
    fn field_links_from_every_link_carrying_type() {
        let mut two = field(None, "Spouse", LINKS, Some(json!(["Page B", "Page C#Sec", ""])));
        two.options.insert("twoWay".into(), json!(true));
        let ib = Infobox {
            fields: vec![
                field(None, "Father", LINK, Some(json!("Page A"))),
                two,
                field(None, "Note", TEXT, Some(json!("see [[Page D|d]] and `[[x]]`"))),
                field(None, "Things", LIST, Some(json!(["[[Page E]]", "plain"]))),
                field(None, "Pic", IMAGE, Some(json!({"file": "a.png", "caption": "[[Page F]]"}))),
                field(None, "Count", NUMBER, Some(json!(3))),
            ],
            hidden: vec![field(None, "Old", LINK, Some(json!("Hidden")))],
            ..Default::default()
        };
        let got: Vec<(String, String, bool)> = field_links(&ib).into_iter().map(|l| (l.field, l.target, l.two_way)).collect();
        let want = [
            ("Father", "Page A", false),
            ("Spouse", "Page B", true),
            ("Spouse", "Page C", true),
            ("Note", "Page D", false),
            ("Things", "Page E", false),
            ("Pic", "Page F", false),
        ];
        assert_eq!(got, want.map(|(a, b, c)| (a.to_string(), b.to_string(), c)));
        assert_eq!(first_image(&ib).as_deref(), Some("a.png"));
    }

    #[test]
    fn field_links_mark_spoilers_and_typed_in_entries() {
        let mut secret = field(None, "Father", LINK, Some(json!("Page A")));
        secret.extra.insert("spoiler".into(), Value::Bool(true));
        let ib = Infobox {
            fields: vec![
                secret,
                field(None, "Note", TEXT, Some(json!("[[Page B]] and ||hidden [[Page C]]|| [[Page D]]"))),
                field(None, "Children", LINKED_FROM, Some(json!(["Page E"]))),
            ],
            ..Default::default()
        };
        let got: Vec<(String, String, bool, bool)> =
            field_links(&ib).into_iter().map(|l| (l.field, l.target, l.two_way, l.spoiler)).collect();
        let want = [
            ("Father", "Page A", false, true),
            ("Note", "Page B", false, false),
            ("Note", "Page C", false, true),
            ("Note", "Page D", false, false),
            ("Children", "Page E", false, false),
        ];
        assert_eq!(got, want.map(|(a, b, c, d)| (a.to_string(), b.to_string(), c, d)));
        // Typed-in entries follow renames.
        let mut ib = ib;
        assert_eq!(rewrite_infobox_links(&mut ib, "page e", "Page F"), 1);
        assert_eq!(ib.fields[2].value, Some(json!(["Page F"])));
    }

    #[test]
    fn sortable_values_from_numbers_and_dates() {
        let mut hidden = field(None, "Secret", NUMBER, Some(json!(9)));
        hidden.extra.insert("spoiler".into(), Value::Bool(true));
        let ib = Infobox {
            fields: vec![
                field(None, "Chapter no.", NUMBER, Some(json!(12))),
                field(None, "Born", DATE, Some(json!({ "year": 250, "month": 3, "era": "AE" }))),
                field(None, "Reign", DATE, Some(json!({ "start": { "year": -5 }, "end": "present" }))),
                field(None, "Undated", DATE, Some(json!({ "month": 4 }))),
                field(None, "Note", TEXT, Some(json!("12"))),
                hidden,
            ],
            ..Default::default()
        };
        let v = sortable_values(&ib);
        assert_eq!(v.len(), 3, "{v:?}");
        assert_eq!(v["chapter no."], [12.0]);
        assert_eq!(v["born"], [250.0, 3.0, 0.0]);
        assert_eq!(v["reign"], [-5.0, 0.0, 0.0]);
    }

    #[test]
    fn rename_rewrites_field_values() {
        let mut ib = Infobox {
            fields: vec![
                field(None, "Father", LINK, Some(json!("old"))),
                field(None, "Kids", LINKS, Some(json!(["Old#S", "Other"]))),
                field(None, "Note", TEXT, Some(json!("[[Old|o]] [[Alias of Old]]"))),
                field(None, "Pic", IMAGE, Some(json!({"file": "a.png", "caption": "[[Old]]"}))),
            ],
            hidden: vec![field(None, "H", LINK, Some(json!("Old")))],
            ..Default::default()
        };
        assert_eq!(rewrite_infobox_links(&mut ib, "Old", "New"), 5);
        assert_eq!(ib.fields[0].value, Some(json!("New")));
        assert_eq!(ib.fields[1].value, Some(json!(["New#S", "Other"])));
        assert_eq!(ib.fields[2].value, Some(json!("[[New|o]] [[Alias of Old]]")));
        assert_eq!(ib.fields[3].value, Some(json!({"file": "a.png", "caption": "[[New]]"})));
        assert_eq!(ib.hidden[0].value, Some(json!("New")));
    }

    #[test]
    fn link_values_with_words_around_the_link() {
        let mut ib = Infobox {
            fields: vec![field(None, "Father", LINKS, Some(json!(["Lord [[Page A]] (supposedly)", "Page B"])))],
            ..Default::default()
        };
        let got: Vec<String> = field_links(&ib).into_iter().map(|l| l.target).collect();
        assert_eq!(got, ["Page A", "Page B"]);
        assert_eq!(rewrite_infobox_links(&mut ib, "page a", "Page C"), 1);
        assert_eq!(ib.fields[0].value, Some(json!(["Lord [[Page C]] (supposedly)", "Page B"])));
        assert_eq!(link_value_page("Words only"), "Words only");
        assert_eq!(link_value_page("Lord [[Page A#Early life]]"), "Page A");
    }

    #[test]
    fn date_text_fields_links_sort_and_convert() {
        let ib = Infobox {
            fields: vec![
                field(None, "Born", DATE_PLACE, Some(json!({ "date": { "year": 283 }, "text": "[[Page A]]" }))),
                field(None, "Reign", DATE_TEXT, Some(json!([{ "date": { "start": { "year": 290 } }, "text": "King of [[Page B]]" }, { "text": "Lord" }]))),
            ],
            ..Default::default()
        };
        let got: Vec<(String, String)> = field_links(&ib).into_iter().map(|l| (l.field, l.target)).collect();
        assert_eq!(got, [("Born".to_string(), "Page A".to_string()), ("Reign".into(), "Page B".into())]);
        let v = sortable_values(&ib);
        assert_eq!((v["born"].clone(), v["reign"].clone()), (vec![283.0, 0.0, 0.0], vec![290.0, 0.0, 0.0]));
        let mut ib = ib;
        assert_eq!(rewrite_infobox_links(&mut ib, "Page B", "Page C"), 1);
        assert_eq!(ib.fields[1].value.as_ref().unwrap()[0]["text"], "King of [[Page C]]");
        assert_eq!(convert_value(json!({ "year": 5 }), DATE_TEXT), json!({ "date": { "year": 5 } }));
        assert_eq!(convert_value(json!({ "date": { "year": 5 } }), DATE), json!({ "year": 5 }));
        assert_eq!(convert_value(json!({ "date": { "year": 5 }, "text": "x" }), DATE), json!({ "date": { "year": 5 }, "text": "x" }));
    }

    #[test]
    fn convert_values_between_types() {
        assert_eq!(convert_value(json!("x"), LIST), json!(["x"]));
        assert_eq!(convert_value(json!(["x"]), TEXT), json!("x"));
        assert_eq!(convert_value(json!(["x", "y"]), TEXT), json!(["x", "y"]));
        assert_eq!(convert_value(json!(" 12 "), NUMBER), json!(12));
        assert_eq!(convert_value(json!("1.5"), NUMBER), json!(1.5));
        assert_eq!(convert_value(json!("abc"), NUMBER), json!("abc"));
        assert_eq!(convert_value(json!(4), TEXT), json!("4"));
        assert_eq!(convert_value(json!(true), TEXT), json!(true));
    }

    #[test]
    fn apply_adds_updates_hides_and_keeps_own_fields() {
        let page = Infobox {
            template: Some("t1".into()),
            color: Some("#123456".into()),
            fields: vec![
                field(Some("a"), "Field A", TEXT, Some(json!("va"))),
                field(None, "Own 1", TEXT, Some(json!("o1"))),
                field(Some("b"), "Field B", TEXT, Some(json!("vb"))),
                field(Some("gone"), "Gone", TEXT, Some(json!("kept"))),
                field(Some("empty"), "Empty gone", TEXT, None),
                field(None, "Own 2", TEXT, None),
            ],
            ..Default::default()
        };
        let mut t = template(vec![
            field(Some("b"), "Field B renamed", LIST, None),
            field(Some("new"), "New field", NUMBER, None),
            field(Some("a"), "Field A", TEXT, None),
        ]);
        t.color = Some("#654321".into());
        let (next, sum) = apply_template(&page, &t).unwrap();
        let labels: Vec<&str> = next.fields.iter().map(|f| f.label.as_str()).collect();
        // Own 1 followed Field A, Own 2 followed Field B.
        assert_eq!(labels, ["Field B renamed", "Own 2", "New field", "Field A", "Own 1"]);
        assert_eq!(next.fields[0].value, Some(json!(["vb"])), "value moves along and converts");
        assert_eq!(next.fields[0].kind, LIST);
        assert_eq!(next.hidden.len(), 1);
        assert_eq!((next.hidden[0].label.as_str(), next.hidden[0].value.clone()), ("Gone", Some(json!("kept"))));
        assert_eq!(next.hidden[0].key, None);
        assert_eq!(next.color.as_deref(), Some("#654321"));
        assert_eq!(sum, ApplySummary { added: 1, updated: 1, hidden: 1, removed: 1, reordered: true, color: true, categories: 0 });
        // Applying again changes nothing.
        assert!(apply_template(&next, &t).is_none());
    }

    #[test]
    fn apply_keeps_own_colour_and_adopts_same_label() {
        let page = Infobox {
            color: Some("#ffffff".into()),
            own_color: true,
            fields: vec![field(None, "field a", TEXT, Some(json!("mine")))],
            ..Default::default()
        };
        let t = template(vec![field(Some("a"), "Field A", TEXT, None)]);
        let (next, sum) = apply_template(&page, &t).unwrap();
        assert_eq!(next.color.as_deref(), Some("#ffffff"));
        assert_eq!(next.fields.len(), 1);
        assert_eq!((next.fields[0].key.as_deref(), next.fields[0].label.as_str()), (Some("a"), "Field A"));
        assert_eq!(next.fields[0].value, Some(json!("mine")));
        assert_eq!((sum.added, sum.updated, sum.color), (0, 1, false));
    }
}
