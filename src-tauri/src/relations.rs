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
    // Removing a name that has no page (a family tree's placeholder): `source` is that name.
    let (name, names) = match entry(idx, source) {
        Ok(src) => (src.title.clone(), names_of(src)),
        Err(_) if edit == Edit::Remove => (source.to_string(), vec![norm(source)]),
        Err(e) => return Err(e),
    };
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

/// Where link `l` in page `e`'s infobox shows up on the linked page `t`:
/// its Linked from fields that read the field ("Children", "Chapters (list)"),
/// and its same-named field for two-way links ("Spouse (two-way)").
fn shows_on(e: &Entry, l: &crate::infobox::FieldLink, t: &Entry) -> Vec<String> {
    let mut shows = Vec::new();
    for r in &t.reverse {
        let reads = r.from.iter().any(|f| norm(f) == norm(&l.field));
        let template_ok = r.templates.is_empty() || e.template.as_ref().is_some_and(|tp| r.templates.contains(tp));
        if reads && template_ok {
            shows.push(if r.list { format!("{} (list)", r.label) } else { r.label.clone() });
        }
    }
    if l.two_way && t.fields.iter().any(|f| (f.kind == crate::infobox::LINK || f.kind == crate::infobox::LINKS) && norm(&f.label) == norm(&l.field)) {
        shows.push(format!("{} (two-way)", l.field));
    }
    shows
}

/// A page that shows page `id` through a relation stored on `id`'s own page
/// (its two-way fields, or a Linked from field reading one of its fields),
/// for "What links here".
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShownOn {
    pub id: String,
    pub title: String,
    pub group: String,
    /// Where it shows there: "Children", "Lover (two-way)".
    pub shows: Vec<String>,
}

/// Pages that show page `id` through its own relations (spoiler relations left out).
pub fn shown_on(idx: &ProjectIndex, id: &str) -> AppResult<Vec<ShownOn>> {
    let e = idx.pages.get(id).ok_or_else(|| AppError::NotFound(format!("Page not found: {id}")))?;
    let mut by_name: HashMap<String, &str> = HashMap::new();
    for (pid, p) in &idx.pages {
        for n in names_of(p) {
            by_name.entry(n).or_insert(pid);
        }
    }
    let mut out: Vec<ShownOn> = Vec::new();
    for l in e.field_links.iter().filter(|l| !l.typed && !l.spoiler) {
        let Some(tid) = by_name.get(&norm(&l.target)).copied().filter(|t| *t != id) else { continue };
        let t = &idx.pages[tid];
        let shows = shows_on(e, l, t);
        if shows.is_empty() {
            continue;
        }
        match out.iter_mut().find(|s| s.id == tid) {
            Some(s) => s.shows.extend(shows.into_iter().filter(|x| !s.shows.contains(x)).collect::<Vec<_>>()),
            None => out.push(ShownOn { id: tid.to_string(), title: t.title.clone(), group: crate::fsutil::rel_parent(tid).to_string(), shows }),
        }
    }
    out.sort_by_key(|s| s.title.to_lowercase());
    Ok(out)
}

// ---- the Relations table ----

/// One stored relation: a link in a page's infobox field, and where it shows up.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableRow {
    /// The page the relation is stored on.
    pub id: String,
    pub title: String,
    pub field: String,
    /// The page linked to, as written.
    pub target: String,
    /// The linked page, if it exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_title: Option<String>,
    /// "link" (Page link field), "text" (a [[link]] in a text field that a
    /// Linked from field reads) or "typed" (a name typed into a Linked from field).
    pub kind: &'static str,
    pub two_way: bool,
    pub spoiler: bool,
    /// Where it shows on the linked page: "Children", "Spouse (two-way)", "Chapters (list)".
    pub shows: Vec<String>,
    /// What's wrong, if anything.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

/// A Linked from field reading names that no field on any page has.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FieldProblem {
    pub id: String,
    pub title: String,
    pub field: String,
    pub names: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelationsTable {
    pub rows: Vec<TableRow>,
    pub field_problems: Vec<FieldProblem>,
}

/// Every relation stored in the project's infoboxes, where each shows up,
/// and what doesn't work: links to missing pages, links that no field of the
/// linked page shows, Linked from fields reading names no field has.
/// `[[links]]` in text fields are listed only where a Linked from field reads them.
pub fn table(idx: &ProjectIndex) -> RelationsTable {
    let mut by_name: HashMap<String, &str> = HashMap::new();
    for (pid, e) in &idx.pages {
        for n in names_of(e) {
            by_name.entry(n).or_insert(pid);
        }
    }
    let labels: std::collections::HashSet<String> =
        idx.pages.values().flat_map(|e| e.fields.iter().map(|f| norm(&f.label))).collect();
    let loops = crate::family::loop_relations(idx, &crate::family::FamilySettings::read(&idx.dir));
    let mut out = RelationsTable::default();
    for (pid, e) in &idx.pages {
        for l in &e.field_links {
            let target = by_name.get(&norm(&l.target)).map(|id| (*id, &idx.pages[*id]));
            let kind = if l.typed { "typed" } else if l.in_text { "text" } else { "link" };
            let shows = match target.filter(|(tid, _)| *tid != pid.as_str() && !l.typed) {
                Some((_, t)) => shows_on(e, l, t),
                None => Vec::new(),
            };
            if l.in_text && shows.is_empty() {
                continue;
            }
            let problem = match (&target, kind) {
                (_, "typed") => None,
                (None, _) => Some(format!("No page “{}” yet (red link).", l.target)),
                (Some((tid, _)), _) if *tid == pid.as_str() => Some("Links to its own page.".to_string()),
                (_, "link") if loops.contains(&(pid.clone(), norm(&l.field), norm(&l.target))) => {
                    Some("Makes someone their own ancestor (family tree).".to_string())
                }
                (Some((_, t)), _) if shows.is_empty() => {
                    Some(format!("Doesn't show on {}: no field there reads “{}”.", t.title, l.field))
                }
                _ => None,
            };
            out.rows.push(TableRow {
                id: pid.clone(),
                title: e.title.clone(),
                field: l.field.clone(),
                target: l.target.clone(),
                target_id: target.map(|(id, _)| id.to_string()),
                target_title: target.map(|(_, t)| t.title.clone()),
                kind,
                two_way: l.two_way,
                spoiler: l.spoiler,
                shows: if l.typed { vec![format!("{} (typed in here)", l.field)] } else { shows },
                problem,
            });
        }
        for r in &e.reverse {
            let names: Vec<String> = r.from.iter().filter(|n| !labels.contains(&norm(n))).cloned().collect();
            if !names.is_empty() {
                out.field_problems.push(FieldProblem { id: pid.clone(), title: e.title.clone(), field: r.label.clone(), names });
            }
        }
    }
    out.rows.sort_by(|a, b| (a.title.to_lowercase(), a.field.to_lowercase()).cmp(&(b.title.to_lowercase(), b.field.to_lowercase())));
    out.field_problems.sort_by_key(|p| p.title.to_lowercase());
    out
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
    fn pages_showing_a_page_through_its_relations() {
        let kids = "  - label: Children\n    type: linkedfrom\n    options: { from: [Father] }\n  - label: Spouse\n    type: links\n    options: { twoWay: true }\n";
        let (_l, _p, idx) = setup(&[
            ("Page A.md", &child("Page A", "t", kids)),
            ("Page B.md", &child("Page B", "t", "  - label: Spouse\n    type: links\n    options: { twoWay: true }\n")),
            (
                "Page C.md",
                &child("Page C", "t", "  - label: Father\n    type: links\n    value: [Page A]\n  - label: Spouse\n    type: links\n    options: { twoWay: true }\n    value: [Page A, Page B]\n  - label: Secret\n    type: links\n    spoiler: true\n    options: { twoWay: true }\n    value: [Page B]\n"),
            ),
        ]);
        let shown = shown_on(&idx, "Page C.md").unwrap();
        let short: Vec<(&str, Vec<&str>)> = shown.iter().map(|s| (s.title.as_str(), s.shows.iter().map(String::as_str).collect())).collect();
        assert_eq!(short, vec![("Page A", vec!["Children", "Spouse (two-way)"]), ("Page B", vec!["Spouse (two-way)"])]);
        assert!(shown_on(&idx, "Page B.md").unwrap().is_empty());
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
    fn a_name_without_a_page_can_be_removed() {
        let fields = "  - label: Father\n    type: links\n    value: [Missing Person, 'Lord [[Missing Person]]', Page A]\n";
        let (lib, p, mut idx) = setup(&[("Page A.md", PARENT), ("Page B.md", &child("Page B", "t-a", fields))]);
        let lib = lib.path();
        set_relation(lib, &p, &mut idx, "Page B.md", "Father", "missing person", Edit::Remove).unwrap();
        assert_eq!(infobox(lib, &p, "Page B.md").fields[0].value, Some(serde_json::json!(["Page A"])));
        // Only removing works with a name; adding needs the page.
        assert!(set_relation(lib, &p, &mut idx, "Page B.md", "Father", "Missing Person", Edit::Add).is_err());
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

    #[test]
    fn relations_table_rows_and_problems() {
        let person = "  - label: Father\n    type: links\n    value: VALUE\n  - label: Spouse\n    type: links\n    options: { twoWay: true }\n    value: SPOUSE\n  - label: Children\n    type: linkedfrom\n    options: { from: [Father, Mother] }\n    value: TYPED\n  - label: Note\n    type: text\n    value: NOTE\n";
        let page = |t: &str, father: &str, spouse: &str, typed: &str, note: &str| {
            child(t, "t-a", &person.replace("VALUE", father).replace("SPOUSE", spouse).replace("TYPED", typed).replace("NOTE", note))
        };
        let (_lib, _p, idx) = setup(&[
            ("Page A.md", &page("Page A", "[]", "[Page B]", "[Page Z]", "''")),
            ("Page B.md", &page("Page B", "[Page A, Page Missing]", "[]", "[]", "'[[Page A]]'")),
            ("Page C.md", "---\ntitle: Page C\ninfobox:\n  fields:\n  - label: Owner\n    type: links\n    value: [Page A]\n  - label: Members\n    type: linkedfrom\n    options: { from: [Nowhere] }\n---\n"),
        ]);
        let t = table(&idx);
        let rows: Vec<(&str, &str, &str, Vec<String>, Option<&str>)> =
            t.rows.iter().map(|r| (r.title.as_str(), r.field.as_str(), r.kind, r.shows.clone(), r.problem.as_deref())).collect();
        assert_eq!(
            rows,
            [
                ("Page A", "Children", "typed", vec!["Children (typed in here)".to_string()], None),
                ("Page A", "Spouse", "link", vec!["Spouse (two-way)".to_string()], None),
                ("Page B", "Father", "link", vec!["Children".to_string()], None),
                ("Page B", "Father", "link", vec![], Some("No page “Page Missing” yet (red link).")),
                ("Page C", "Owner", "link", vec![], Some("Doesn't show on Page A: no field there reads “Owner”.")),
            ]
        );
        // The [[link]] in Page B's Note shows nowhere, so it isn't a relation here.
        // No page has a Mother field, nor a Nowhere field.
        let problems: Vec<(&str, &str, Vec<String>)> = t.field_problems.iter().map(|p| (p.title.as_str(), p.field.as_str(), p.names.clone())).collect();
        assert_eq!(
            problems,
            [
                ("Page A", "Children", vec!["Mother".to_string()]),
                ("Page B", "Children", vec!["Mother".to_string()]),
                ("Page C", "Members", vec!["Nowhere".to_string()]),
            ]
        );
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
