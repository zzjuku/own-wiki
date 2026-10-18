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

use crate::wikilinks::{norm, parse_links, rewrite_links};

// Field types (all of them are listed for reference; the Rust side only
// needs to treat some specially).
#[allow(dead_code)]
pub const ALL_KINDS: &[&str] = &[TEXT, LONG_TEXT, NUMBER, YES_NO, CHOICE, LIST, LINK, LINKS, LINKED_FROM, DATE, IMAGE, HEADING];
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
pub const IMAGE: &str = "image";
pub const HEADING: &str = "heading";

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
}

fn strings(v: &Value) -> Vec<&str> {
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
fn link_value_page(s: &str) -> &str {
    s.split('#').next().unwrap_or("").trim()
}

/// Every link in the infobox's fields (not in hidden values).
pub fn field_links(ib: &Infobox) -> Vec<FieldLink> {
    let mut out = Vec::new();
    for f in &ib.fields {
        let Some(v) = &f.value else { continue };
        match f.kind.as_str() {
            LINK | LINKS => {
                let two_way = option_bool(f, "twoWay");
                for s in strings(v) {
                    let page = link_value_page(s);
                    if !page.is_empty() {
                        out.push(FieldLink { field: f.label.clone(), target: page.to_string(), two_way });
                    }
                }
            }
            TEXT | LONG_TEXT | LIST => {
                for s in strings(v) {
                    for l in parse_links(s).into_iter().filter(|l| !l.page.is_empty()) {
                        out.push(FieldLink { field: f.label.clone(), target: l.page, two_way: false });
                    }
                }
            }
            IMAGE => {
                if let Some(c) = v.get("caption").and_then(Value::as_str) {
                    for l in parse_links(c).into_iter().filter(|l| !l.page.is_empty()) {
                        out.push(FieldLink { field: f.label.clone(), target: l.page, two_way: false });
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// The file (inside `assets/`) of the first image field with an image.
pub fn first_image(ib: &Infobox) -> Option<String> {
    ib.fields
        .iter()
        .filter(|f| f.kind == IMAGE)
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
        LINK | LINKS => n += rewrite_link_value(s, old, new),
        TEXT | LONG_TEXT | LIST => n += rewrite_text(s, old, new),
        _ => {}
    };
    match v {
        Value::String(s) => each(s),
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
const LIST_KINDS: &[&str] = &[LIST, LINKS];

/// A value moved to another field type, converted where nothing is lost
/// (one text <-> a one-entry list, number <-> text). Anything else stays as
/// it is; the form warns about values that don't fit.
pub fn convert_value(v: Value, to: &str) -> Value {
    let to_string = STRING_KINDS.contains(&to);
    let to_list = LIST_KINDS.contains(&to);
    match v {
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
        Template { id: "t1".into(), name: "Template A".into(), color: Some("#123456".into()), starter_text: String::new(), fields, extra: Map::new() }
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
        assert_eq!(sum, ApplySummary { added: 1, updated: 1, hidden: 1, removed: 1, reordered: true, color: true });
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
