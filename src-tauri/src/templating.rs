//! Template operations that look at the project's pages: which pages were
//! created from a template, and pushing template changes to them.

use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::fsutil::rel_parent;
use crate::index::ProjectIndex;
use crate::infobox::{ApplySummary, Template, apply_template};
use crate::pages;
use crate::projects;
use crate::relink::parallel;
use crate::tree::{PageInfo, pages_dir};

/// Pages whose infobox came from template `id`, by title.
pub fn template_pages(idx: &ProjectIndex, id: &str) -> Vec<PageInfo> {
    let mut out: Vec<PageInfo> = idx
        .pages
        .iter()
        .filter(|(_, e)| e.template.as_deref() == Some(id))
        .map(|(pid, e)| PageInfo {
            id: pid.clone(),
            title: e.title.clone(),
            group: rel_parent(pid).to_string(),
            aliases: e.aliases.clone(),
        })
        .collect();
    out.sort_by_key(|p| p.title.to_lowercase());
    out
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ApplyChange {
    pub page: PageInfo,
    pub summary: ApplySummary,
}

#[derive(Debug, Serialize, PartialEq, Default)]
pub struct ApplyResult {
    /// Pages that would change (dry run) or changed.
    pub changes: Vec<ApplyChange>,
    /// Titles of pages that couldn't be read or written.
    pub failed: Vec<String>,
}

fn template(dir: &Path, id: &str) -> AppResult<Template> {
    projects::templates(dir)?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound("That template doesn't exist any more.".into()))
}

/// Applies template `id` to the pages created from it. With `only`, just to
/// those pages; with `dry_run`, nothing is written and the result says which
/// pages would change and how.
pub fn apply(
    library: &Path,
    project: &str,
    idx: &mut ProjectIndex,
    id: &str,
    only: Option<&[String]>,
    dry_run: bool,
) -> AppResult<ApplyResult> {
    let t = template(&idx.dir, id)?;
    let pages_dir = pages_dir(library, project)?;
    let candidates: Vec<PageInfo> = template_pages(idx, id)
        .into_iter()
        .filter(|p| only.is_none_or(|o| o.contains(&p.id)))
        .collect();
    let ids: Vec<String> = candidates.iter().map(|p| p.id.clone()).collect();
    let results = parallel(&ids, |pid| -> AppResult<Option<ApplySummary>> {
        let Some(ib) = pages::read_infobox(&pages_dir, pid)? else { return Ok(None) };
        let Some((next, summary)) = apply_template(&ib, &t) else { return Ok(None) };
        if !dry_run {
            pages::write_infobox(&pages_dir, pid, &next)?;
        }
        Ok(Some(summary))
    });
    let mut out = ApplyResult::default();
    for (page, r) in candidates.into_iter().zip(results) {
        match r {
            Ok(Some(summary)) => out.changes.push(ApplyChange { page, summary }),
            Ok(None) => {}
            Err(_) => out.failed.push(page.title),
        }
    }
    if !dry_run {
        let changed: Vec<&str> = out.changes.iter().map(|c| c.page.id.as_str()).collect();
        idx.refresh(&changed)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::{create_project, set_templates};
    use std::fs;

    fn tpl(fields: serde_json::Value) -> Template {
        serde_json::from_value(serde_json::json!({ "id": "t-1", "name": "Template A", "fields": fields })).unwrap()
    }

    #[test]
    fn apply_dry_run_then_write() {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap().id;
        let dir = lib.path().join(&p);
        let t = tpl(serde_json::json!([{ "key": "a", "label": "Field A", "type": "text" }]));
        set_templates(&dir, &[t.clone()]).unwrap();
        let mut idx = ProjectIndex::open(&dir).unwrap();
        for title in ["Page A", "Page B"] {
            pages::create_page(lib.path(), &p, "", title, false, &idx.page_infos(), Some(&t)).unwrap();
        }
        pages::create_page(lib.path(), &p, "", "Page C", false, &idx.page_infos(), None).unwrap();
        idx.refresh(&[]).unwrap();
        let using: Vec<String> = template_pages(&idx, "t-1").into_iter().map(|p| p.title).collect();
        assert_eq!(using, ["Page A", "Page B"]);

        // Nothing changed yet.
        assert!(apply(lib.path(), &p, &mut idx, "t-1", None, true).unwrap().changes.is_empty());

        let t2 = tpl(serde_json::json!([
            { "key": "a", "label": "Field A", "type": "text" },
            { "key": "b", "label": "Field B", "type": "number" }
        ]));
        set_templates(&dir, &[t2]).unwrap();
        let dry = apply(lib.path(), &p, &mut idx, "t-1", None, true).unwrap();
        assert_eq!(dry.changes.len(), 2);
        assert_eq!(dry.changes[0].summary.added, 1);
        assert!(!fs::read_to_string(dir.join("pages/Page A.md")).unwrap().contains("Field B"));

        let done = apply(lib.path(), &p, &mut idx, "t-1", Some(&["Page B.md".to_string()]), false).unwrap();
        assert_eq!(done.changes.len(), 1);
        assert!(!fs::read_to_string(dir.join("pages/Page A.md")).unwrap().contains("Field B"));
        assert!(fs::read_to_string(dir.join("pages/Page B.md")).unwrap().contains("label: Field B"));
        assert_eq!(apply(lib.path(), &p, &mut idx, "t-1", None, true).unwrap().changes.len(), 1);
    }

    /// Speed check from the M5 spec. Run with
    /// `cargo test --release -- --ignored --nocapture big_infobox_project`.
    #[test]
    #[ignore]
    fn big_infobox_project_speed() {
        use std::time::Instant;
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap().id;
        let dir = lib.path().join(&p);
        let t = tpl(serde_json::json!([
            { "key": "father", "label": "Father", "type": "link" },
            { "key": "mother", "label": "Mother", "type": "link" },
            { "key": "spouse", "label": "Spouse", "type": "links", "options": { "twoWay": true } },
            { "key": "children", "label": "Children", "type": "linkedfrom", "options": { "from": ["Father", "Mother"] } },
            { "key": "born", "label": "Born", "type": "date" },
            { "key": "note", "label": "Note", "type": "text" }
        ]));
        set_templates(&dir, &[t.clone()]).unwrap();
        for g in 0..50 {
            fs::create_dir_all(dir.join(format!("pages/Group {g}"))).unwrap();
        }
        for i in 0..5000 {
            let (f, m, s) = ((i * 7 + 1) % 5000, (i * 13 + 2) % 5000, (i * 17 + 3) % 5000);
            let text = format!(
                "---\ntitle: Page {i}\ninfobox:\n  template: t-1\n  fields:\n  - key: father\n    label: Father\n    type: link\n    value: Page {f}\n  - key: mother\n    label: Mother\n    type: link\n    value: Page {m}\n  - key: spouse\n    label: Spouse\n    type: links\n    options:\n      twoWay: true\n    value:\n    - Page {s}\n  - key: children\n    label: Children\n    type: linkedfrom\n    options:\n      from: [Father, Mother]\n  - key: born\n    label: Born\n    type: date\n    value:\n      year: {i}\n  - key: note\n    label: Note\n    type: text\n    value: See [[Page {f}]]\n---\nOpening paragraph of page {i}.\n\nText [[Page {s}]].\n"
            );
            fs::write(dir.join(format!("pages/Group {}/Page {i}.md", i % 50)), text).unwrap();
        }
        let t0 = Instant::now();
        let idx = ProjectIndex::open(&dir).unwrap();
        println!("first open (no cache): {:?}", t0.elapsed());
        drop(idx);
        let t0 = Instant::now();
        let mut idx = ProjectIndex::open(&dir).unwrap();
        let reopen = t0.elapsed();
        println!("reopen (cache): {reopen:?}");
        let t0 = Instant::now();
        let inc = crate::relink::incoming_fields(&idx, "Group 0/Page 0.md").unwrap();
        let incoming = t0.elapsed();
        println!("incoming field links: {incoming:?} ({} links)", inc.len());

        // Apply a changed template to 1,000 of the pages.
        let mut t2 = t.clone();
        t2.fields.push(serde_json::from_value(serde_json::json!({ "key": "title", "label": "Title", "type": "text" })).unwrap());
        t2.fields.swap(0, 1);
        set_templates(&dir, &[t2]).unwrap();
        let only: Vec<String> = (0..1000).map(|i| format!("Group {}/Page {i}.md", i % 50)).collect();
        let t0 = Instant::now();
        let r = apply(lib.path(), &p, &mut idx, "t-1", Some(&only), true).unwrap();
        println!("apply preview for 1,000 pages: {:?}", t0.elapsed());
        assert_eq!(r.changes.len(), 1000);
        let t0 = Instant::now();
        let r = apply(lib.path(), &p, &mut idx, "t-1", Some(&only), false).unwrap();
        let applied = t0.elapsed();
        println!("apply to 1,000 pages: {applied:?}");
        assert_eq!((r.changes.len(), r.failed.len()), (1000, 0));
        assert!(reopen.as_millis() < 1000, "reopen too slow");
        assert!(incoming.as_millis() < 50, "incoming field links too slow");
        assert!(applied.as_secs() < 5, "apply too slow");
    }
}
