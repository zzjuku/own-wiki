//! Relations between pages through infobox fields (M9): what other pages'
//! fields say about a page (Linked from fields, two-way fields, page lists),
//! and writing a relation into another page's field from the reverse side.
//!
//! A relation is stored once, on the specific side: John's *Father* field
//! links Alex; Alex's *Children* ("Linked from: Father, Mother") shows John
//! from the link index. Adding John on Alex's page writes Alex into John's
//! field ([`set_relation`]): the only case where the app writes into another
//! page's file. Family-tree edits (M15) reuse it.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::index::{Entry, ProjectIndex};
use crate::infobox::{
    DIVIDER, Field, HEADING, Infobox, LINK, LINKED_FROM, LINKS, link_value_page, strings,
};
use crate::pages;
use crate::tree::pages_dir;
use crate::wikilinks::norm;

fn entry<'a>(idx: &'a ProjectIndex, id: &str) -> AppResult<&'a Entry> {
    idx.pages.get(id).ok_or_else(|| AppError::NotFound(format!("Page not found: {id}")))
}

/// The title and aliases of a page, as compared.
fn names_of(e: &Entry) -> Vec<String> {
    std::iter::once(&e.title).chain(&e.aliases).map(|n| norm(n)).collect()
}

/// A link from another page's infobox field to this page.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IncomingField {
    /// The field's label on the linking page.
    pub field: String,
    pub id: String,
    pub title: String,
    pub two_way: bool,
    /// Every link from that field to here is hidden as a spoiler.
    pub spoiler: bool,
    /// Template the linking page's infobox came from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

/// Every infobox field link that points at page `id` (by title or alias):
/// one entry per linking page and field, sorted by title.
pub fn incoming_fields(idx: &ProjectIndex, id: &str) -> AppResult<Vec<IncomingField>> {
    let names = names_of(entry(idx, id)?);
    let mut out: Vec<IncomingField> = Vec::new();
    for (pid, e) in idx.pages.iter().filter(|(pid, _)| pid.as_str() != id) {
        let start = out.len();
        for l in e.field_links.iter().filter(|l| names.contains(&norm(&l.target))) {
            match out[start..].iter_mut().find(|o| norm(&o.field) == norm(&l.field)) {
                // One open link is enough to show it openly.
                Some(o) => o.spoiler &= l.spoiler,
                None => out.push(IncomingField {
                    field: l.field.clone(),
                    id: pid.clone(),
                    title: e.title.clone(),
                    two_way: l.two_way,
                    spoiler: l.spoiler,
                    template: e.template.clone(),
                }),
            }
        }
    }
    out.sort_by_key(|o| o.title.to_lowercase());
    Ok(out)
}

/// What a page needs to show its Linked from fields, two-way fields and page
/// lists: the incoming field links, and the sortable values (number and date
/// fields) of the pages they come from and of the pages typed into its
/// Linked from fields.
#[derive(Debug, Serialize, PartialEq, Default)]
pub struct Relations {
    pub incoming: Vec<IncomingField>,
    /// Page id -> field label (as compared) -> sort key.
    pub values: BTreeMap<String, BTreeMap<String, Vec<f64>>>,
}

pub fn relations(idx: &ProjectIndex, id: &str, typed: &[String]) -> AppResult<Relations> {
    let incoming = incoming_fields(idx, id)?;
    let mut values = BTreeMap::new();
    let mut add = |pid: &str| {
        if let Some(e) = idx.pages.get(pid).filter(|e| !e.values.is_empty()) {
            values.entry(pid.to_string()).or_insert_with(|| e.values.clone());
        }
    };
    for i in &incoming {
        add(&i.id);
    }
    if !typed.is_empty() {
        let mut by_name: HashMap<String, &str> = HashMap::new();
        for (pid, e) in &idx.pages {
            for n in names_of(e) {
                by_name.entry(n).or_insert(pid);
            }
        }
        for t in typed {
            if let Some(pid) = by_name.get(&norm(link_value_page(t))) {
                add(pid);
            }
        }
    }
    Ok(Relations { incoming, values })
}

/// The names typed by hand into an infobox's Linked from fields.
pub fn typed_names(ib: &Infobox) -> Vec<String> {
    ib.fields
        .iter()
        .filter(|f| f.kind == LINKED_FROM)
        .filter_map(|f| f.value.as_ref())
        .flat_map(|v| strings(v).into_iter().map(str::to_string))
        .collect()
}

/// How [`set_relation`] changes the other page's field.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Edit {
    /// Add the page (a one-page field must be empty or hold it already).
    Add,
    /// The page becomes the field's only value.
    Replace,
    /// Take the page out (by title or alias).
    Remove,
}

/// Writes page `source` into (or out of) the field named `field` (compared
/// with [`norm`]) on page `target`. A target without such a field gets it as
/// its own Page link field (and an infobox, if it has none). Only Page link
/// fields can be written; anything else is refused.
pub fn set_relation(
    library: &Path,
    project: &str,
    idx: &mut ProjectIndex,
    target: &str,
    field: &str,
    source: &str,
    edit: Edit,
) -> AppResult<()> {
    if target == source {
        return Err(AppError::Invalid("A page can't be listed in its own field.".into()));
    }
    let src = entry(idx, source)?;
    let name = src.title.clone();
    let names = names_of(src);
    let target_title = entry(idx, target)?.title.clone();
    let pages = pages_dir(library, project)?;
    let mut ib = pages::read_infobox(&pages, target)
        .map_err(|_| AppError::Invalid(format!("{target_title}'s infobox can't be read, so it can't be changed here.")))?
        .unwrap_or_default();
    let is_source = |s: &str| names.contains(&norm(link_value_page(s)));
    let label = field.trim();
    let found = ib.fields.iter().position(|f| f.kind != HEADING && f.kind != DIVIDER && norm(&f.label) == norm(label));
    match found {
        None if edit == Edit::Remove => return Ok(()),
        None => ib.fields.push(Field {
            label: label.to_string(),
            kind: LINKS.into(),
            value: Some(Value::from(vec![name])),
            ..Default::default()
        }),
        Some(i) => {
            let f = &mut ib.fields[i];
            let current: Vec<String> = f.value.as_ref().map(|v| strings(v).into_iter().map(str::to_string).collect()).unwrap_or_default();
            let current: Vec<String> = current.into_iter().filter(|s| !s.trim().is_empty()).collect();
            let has = current.iter().any(|s| is_source(s));
            let next: Vec<String> = match f.kind.as_str() {
                LINK | LINKS => match edit {
                    Edit::Add if has => return Ok(()),
                    Edit::Add if f.kind == LINK && !current.is_empty() => {
                        return Err(AppError::Invalid(format!(
                            "{target_title}'s {} holds one page only. Replace it instead.",
                            f.label
                        )));
                    }
                    Edit::Add => current.into_iter().chain([name]).collect(),
                    Edit::Replace => vec![name],
                    Edit::Remove if !has => return Ok(()),
                    Edit::Remove => current.into_iter().filter(|s| !is_source(s)).collect(),
                },
                _ => {
                    return Err(AppError::Invalid(format!(
                        "{target_title}'s field “{}” isn't a Page link field, so it can't be filled from here.",
                        f.label
                    )));
                }
            };
            f.value = match (f.kind.as_str(), next.len()) {
                (_, 0) => None,
                (LINK, _) => next.into_iter().next().map(Value::from),
                _ => Some(Value::from(next)),
            };
        }
    }
    pages::write_infobox(&pages, target, &ib)?;
    idx.reload_page(target);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;
    use std::fs;

    fn setup(pages_: &[(&str, &str)]) -> (tempfile::TempDir, String, ProjectIndex) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap().id;
        let dir = lib.path().join(&p);
        fs::remove_file(dir.join("pages/Main Page.md")).unwrap();
        for (id, text) in pages_ {
            fs::write(dir.join("pages").join(id), text).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        (lib, p, idx)
    }

    fn read(lib: &Path, p: &str, id: &str) -> String {
        fs::read_to_string(lib.join(p).join("pages").join(id)).unwrap()
    }

    fn infobox(lib: &Path, p: &str, id: &str) -> Infobox {
        pages::read_infobox(&lib.join(p).join("pages"), id).unwrap().unwrap()
    }

    const PARENT: &str = "---\ntitle: Page A\naliases: [Alias A]\n---\n";

    fn child(title: &str, template: &str, fields: &str) -> String {
        format!("---\ntitle: {title}\ninfobox:\n  template: {template}\n  fields:\n{fields}---\n")
    }

    #[test]
    fn relations_with_templates_spoilers_and_values() {
        let (_lib, _p, idx) = setup(&[
            ("Page A.md", PARENT),
            (
                "Page B.md",
                &child("Page B", "t-a", "  - label: Father\n    type: links\n    value: [Alias A]\n  - label: Born\n    type: date\n    value: { year: 20 }\n"),
            ),
            (
                "Page C.md",
                &child("Page C", "t-b", "  - label: Mother\n    type: link\n    value: Page A\n    spoiler: true\n  - label: Note\n    type: text\n    value: '[[Page A]] ||[[Page A]]||'\n"),
            ),
            ("Page D.md", "---\ntitle: Page D\ninfobox:\n  fields:\n  - label: Chapter no.\n    type: number\n    value: 3\n---\n"),
        ]);
        let r = relations(&idx, "Page A.md", &["page d".into(), "Missing".into()]).unwrap();
        let got: Vec<_> = r.incoming.iter().map(|i| (i.field.as_str(), i.title.as_str(), i.spoiler, i.template.as_deref())).collect();
        assert_eq!(
            got,
            [("Father", "Page B", false, Some("t-a")), ("Mother", "Page C", true, Some("t-b")), ("Note", "Page C", false, Some("t-b"))]
        );
        // Values of the linking pages that have any, and of typed-in pages.
        assert_eq!(r.values.keys().collect::<Vec<_>>(), ["Page B.md", "Page D.md"]);
        assert_eq!(r.values["Page B.md"]["born"], [20.0, 0.0, 0.0]);
        assert_eq!(r.values["Page D.md"]["chapter no."], [3.0]);
    }

    #[test]
    fn write_back_adds_replaces_and_removes() {
        let fields = "  - key: f\n    label: Father\n    type: links\n    value: [Page Z]\n  - label: Mother\n    type: link\n    value: Page Y\n  - label: Note\n    type: text\n";
        let (lib, p, mut idx) = setup(&[("Page A.md", PARENT), ("Page B.md", &child("Page B", "t-a", fields)), ("Page C.md", "Text only.\n")]);
        let lib = lib.path();

        // Add next to another page; a second Add changes nothing.
        set_relation(lib, &p, &mut idx, "Page B.md", "father", "Page A.md", Edit::Add).unwrap();
        set_relation(lib, &p, &mut idx, "Page B.md", "Father", "Page A.md", Edit::Add).unwrap();
        assert_eq!(infobox(lib, &p, "Page B.md").fields[0].value, Some(serde_json::json!(["Page Z", "Page A"])));
        // The index knows at once.
        let inc = incoming_fields(&idx, "Page A.md").unwrap();
        assert_eq!(inc.iter().map(|i| (i.field.as_str(), i.id.as_str())).collect::<Vec<_>>(), [("Father", "Page B.md")]);

        // A one-page field that holds another page: Add is refused, Replace works.
        let err = set_relation(lib, &p, &mut idx, "Page B.md", "Mother", "Page A.md", Edit::Add).unwrap_err();
        assert!(err.to_string().contains("one page only"), "{err}");
        set_relation(lib, &p, &mut idx, "Page B.md", "Mother", "Page A.md", Edit::Replace).unwrap();
        assert_eq!(infobox(lib, &p, "Page B.md").fields[1].value, Some(serde_json::json!("Page A")));

        // Text fields are never written.
        let err = set_relation(lib, &p, &mut idx, "Page B.md", "Note", "Page A.md", Edit::Add).unwrap_err();
        assert!(err.to_string().contains("isn't a Page link field"), "{err}");

        // Remove finds the page by alias too; an emptied field has no value.
        fs::write(
            lib.join(&p).join("pages/Page B.md"),
            child("Page B", "t-a", "  - label: Father\n    type: links\n    value: [Alias A#Early life]\n"),
        )
        .unwrap();
        idx.refresh(&[]).unwrap();
        set_relation(lib, &p, &mut idx, "Page B.md", "Father", "Page A.md", Edit::Remove).unwrap();
        assert_eq!(infobox(lib, &p, "Page B.md").fields[0].value, None);
        assert!(incoming_fields(&idx, "Page A.md").unwrap().is_empty());

        // Words around a link stay out of the way: the entry is found by its link.
        fs::write(
            lib.join(&p).join("pages/Page B.md"),
            child("Page B", "t-a", "  - label: Father\n    type: links\n    value: ['Lord [[Page A]]', Page Z]\n"),
        )
        .unwrap();
        idx.refresh(&[]).unwrap();
        assert_eq!(incoming_fields(&idx, "Page A.md").unwrap().len(), 1);
        set_relation(lib, &p, &mut idx, "Page B.md", "Father", "Page A.md", Edit::Add).unwrap();
        assert_eq!(infobox(lib, &p, "Page B.md").fields[0].value, Some(serde_json::json!(["Lord [[Page A]]", "Page Z"])));
        set_relation(lib, &p, &mut idx, "Page B.md", "Father", "Page A.md", Edit::Remove).unwrap();
        assert_eq!(infobox(lib, &p, "Page B.md").fields[0].value, Some(serde_json::json!(["Page Z"])));

        // A page without the field (and without an infobox) gets it as its own field.
        set_relation(lib, &p, &mut idx, "Page C.md", "Father", "Page A.md", Edit::Add).unwrap();
        let c = read(lib, &p, "Page C.md");
        assert!(c.starts_with("---\ninfobox:\n  fields:\n  - label: Father\n    type: links\n    value:\n    - Page A\n---\nText only.\n"), "{c}");
        assert_eq!(incoming_fields(&idx, "Page A.md").unwrap().len(), 1);
        // Removing from a page that doesn't have the field changes nothing.
        set_relation(lib, &p, &mut idx, "Page C.md", "Mother", "Page A.md", Edit::Remove).unwrap();
        assert_eq!(read(lib, &p, "Page C.md"), c);
    }

    #[test]
    fn write_back_refuses_unreadable_infobox_and_own_page() {
        let (lib, p, mut idx) = setup(&[("Page A.md", PARENT), ("Page B.md", "---\ninfobox: [1, 2]\n---\nBody\n")]);
        let err = set_relation(lib.path(), &p, &mut idx, "Page B.md", "Father", "Page A.md", Edit::Add).unwrap_err();
        assert!(err.to_string().contains("can't be read"), "{err}");
        assert_eq!(read(lib.path(), &p, "Page B.md"), "---\ninfobox: [1, 2]\n---\nBody\n");
        assert!(set_relation(lib.path(), &p, &mut idx, "Page A.md", "Father", "Page A.md", Edit::Add).is_err());
    }

    /// Speed check from the M9 spec: a page with 1,000 incoming entries.
    /// Run with `cargo test --release -- --ignored --nocapture many_incoming`.
    #[test]
    #[ignore]
    fn many_incoming_speed() {
        use std::time::Instant;
        let (_lib, p, _) = setup(&[]);
        let dir = _lib.path().join(&p);
        fs::write(dir.join("pages/Parent.md"), "Parent.\n").unwrap();
        for i in 0..5000 {
            let parent = if i < 1000 { "Parent".to_string() } else { format!("Page {}", i / 2) };
            let text = child(&format!("Page {i}"), "t-a", &format!("  - label: Father\n    type: link\n    value: {parent}\n  - label: Born\n    type: date\n    value: {{ year: {i} }}\n"));
            fs::write(dir.join(format!("pages/Page {i}.md")), text).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        drop(idx);
        let t = Instant::now();
        let idx = ProjectIndex::open(&dir).unwrap();
        let reopen = t.elapsed();
        let t = Instant::now();
        let r = relations(&idx, "Parent.md", &[]).unwrap();
        let took = t.elapsed();
        println!("reopen: {reopen:?}; relations with {} entries: {took:?}", r.incoming.len());
        assert_eq!((r.incoming.len(), r.values.len()), (1000, 1000));
        assert!(reopen.as_millis() < 1000, "reopen too slow");
        assert!(took.as_millis() < 100, "relations too slow");
    }
}
