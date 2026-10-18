//! Everything that looks at links between pages: renaming a page together
//! with every link to it, "What links here", hover previews and counts.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::fsutil::rel_parent;
use crate::index::ProjectIndex;
use crate::pages;
use crate::projects;
use crate::tree::{PageInfo, pages_dir};
use crate::wikilinks::{Heading, has_link_chars, norm, section_summary, slugify};

fn entry<'a>(idx: &'a ProjectIndex, id: &str) -> AppResult<&'a crate::index::Entry> {
    idx.pages.get(id).ok_or_else(|| AppError::NotFound(format!("Page not found: {id}")))
}

/// Ids of pages with a link to `name`, and how many such links there are.
fn linking(idx: &ProjectIndex, name: &str) -> (Vec<String>, usize) {
    let n = norm(name);
    let mut ids = Vec::new();
    let mut count = 0;
    for (id, e) in &idx.pages {
        let here = e.links.iter().filter(|l| !l.target.is_empty() && norm(&l.target) == n).count()
            + e.field_links.iter().filter(|l| norm(&l.target) == n).count();
        if here > 0 {
            ids.push(id.clone());
            count += here;
        }
    }
    (ids, count)
}

#[derive(Debug, Serialize, PartialEq)]
pub struct LinkCount {
    pub links: usize,
    pub pages: usize,
}

/// How many links (in how many pages) use `name` as their target.
pub fn link_count(idx: &ProjectIndex, name: &str) -> LinkCount {
    let (ids, links) = linking(idx, name);
    LinkCount { links, pages: ids.len() }
}

#[derive(Debug, Serialize)]
pub struct RenameResult {
    pub page: PageInfo,
    /// Links rewritten, and in how many pages.
    pub links: usize,
    pub pages: usize,
    /// Titles of pages whose links couldn't be updated.
    pub failed: Vec<String>,
}

/// Runs `f` on every id, using a few threads when there are many.
pub fn parallel<T: Send>(ids: &[String], f: impl Fn(&str) -> T + Sync) -> Vec<T> {
    if ids.len() < 16 {
        return ids.iter().map(|id| f(id)).collect();
    }
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk = ids.len().div_ceil(threads);
    let f = &f;
    std::thread::scope(|s| {
        let handles: Vec<_> =
            ids.chunks(chunk).map(|part| s.spawn(move || part.iter().map(|id| f(id)).collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

/// Renames a page and points every link to its old title at the new one
/// (`[[Old]]` -> `[[New]]`, `[[Old#S|text]]` -> `[[New#S|text]]`). Links
/// through an alias are left alone. The main page setting follows.
#[allow(clippy::too_many_arguments)]
pub fn rename_with_links(
    library: &Path,
    project: &str,
    idx: &mut ProjectIndex,
    id: &str,
    new_title: &str,
    allow_long: bool,
    keep_alias: bool,
) -> AppResult<RenameResult> {
    let old = entry(idx, id)?.title.clone();
    let mut page = pages::rename_page(library, project, id, new_title, allow_long, &idx.page_infos())?;
    idx.refresh(&[&page.id])?;
    let pages_dir: PathBuf = pages_dir(library, project)?;

    if keep_alias && norm(&old) != norm(&page.title) && !has_link_chars(&old) {
        let mut aliases = page.aliases.clone();
        aliases.push(old.clone());
        page = pages::set_aliases(library, project, &page.id, &aliases, &idx.page_infos())?;
    }

    let (ids, _) = linking(idx, &old);
    let results = parallel(&ids, |pid| pages::rewrite_page_links(&pages_dir, pid, &old, &page.title));
    let mut result = RenameResult { page, links: 0, pages: 0, failed: Vec::new() };
    for (pid, r) in ids.iter().zip(results) {
        match r {
            Ok(0) => {}
            Ok(n) => {
                result.links += n;
                result.pages += 1;
            }
            Err(_) => result.failed.push(idx.pages.get(pid).map(|e| e.title.clone()).unwrap_or_else(|| pid.clone())),
        }
    }

    let dir = idx.dir.clone();
    if projects::main_page(&dir).is_some_and(|m| norm(&m) == norm(&old)) {
        projects::set_main_page(&dir, Some(&result.page.title))?;
    }
    let mut changed: Vec<&str> = ids.iter().map(String::as_str).collect();
    changed.push(&result.page.id);
    idx.refresh(&changed)?;
    Ok(result)
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Backlink {
    pub id: String,
    pub title: String,
    pub group: String,
    /// Aliases the page links through (empty: links to the title).
    pub via: Vec<String>,
    /// The lines that contain the links (only when asked for).
    pub lines: Vec<String>,
    /// Infobox fields that link here.
    pub fields: Vec<String>,
}

/// Pages that link to page `id`, by its title or one of its aliases.
pub fn backlinks(
    library: &Path,
    project: &str,
    idx: &ProjectIndex,
    id: &str,
    context: bool,
) -> AppResult<Vec<Backlink>> {
    let target = entry(idx, id)?;
    let mut names: BTreeMap<String, Option<&str>> = BTreeMap::new();
    for a in &target.aliases {
        names.insert(norm(a), Some(a));
    }
    names.insert(norm(&target.title), None);
    let pages_dir = if context { Some(pages_dir(library, project)?) } else { None };
    let mut out = Vec::new();
    for (pid, e) in idx.pages.iter().filter(|(pid, _)| pid.as_str() != id) {
        let mut via: Vec<String> = Vec::new();
        let mut lines: Vec<usize> = Vec::new();
        let mut fields: Vec<String> = Vec::new();
        let mut note_alias = |alias: &Option<&str>| {
            if let Some(a) = alias {
                if !via.iter().any(|v| v == a) {
                    via.push(a.to_string());
                }
            }
        };
        for l in e.links.iter().filter(|l| !l.target.is_empty()) {
            let Some(alias) = names.get(&norm(&l.target)) else { continue };
            note_alias(alias);
            if !lines.contains(&(l.line as usize)) {
                lines.push(l.line as usize);
            }
        }
        for l in &e.field_links {
            let Some(alias) = names.get(&norm(&l.target)) else { continue };
            note_alias(alias);
            if !fields.contains(&l.field) {
                fields.push(l.field.clone());
            }
        }
        if lines.is_empty() && fields.is_empty() {
            continue;
        }
        let lines = match &pages_dir {
            Some(dir) => pages::body_lines(dir, pid, &lines[..lines.len().min(3)]).unwrap_or_default(),
            None => Vec::new(),
        };
        out.push(Backlink {
            id: pid.clone(),
            title: e.title.clone(),
            group: rel_parent(pid).to_string(),
            via,
            lines,
            fields,
        });
    }
    out.sort_by_key(|b| b.title.to_lowercase());
    Ok(out)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub title: String,
    pub group: String,
    /// Opening paragraph (or start of the section), as Markdown.
    pub text: String,
    /// The section that was asked for, if the page has it.
    pub section: Option<String>,
    /// The page's first infobox image (file inside `assets/`).
    pub image: Option<String>,
}

/// What a hover card shows for a link to page `id` (and `section`).
pub fn preview(
    library: &Path,
    project: &str,
    idx: &ProjectIndex,
    id: &str,
    section: Option<&str>,
) -> AppResult<Preview> {
    let e = entry(idx, id)?;
    let mut p = Preview {
        title: e.title.clone(),
        group: rel_parent(id).to_string(),
        text: e.summary.clone(),
        section: None,
        image: e.image.clone(),
    };
    if let Some(s) = section.filter(|s| !s.trim().is_empty()) {
        let anchor = slugify(s);
        if let Some(h) = e.headings.iter().find(|h| h.anchor == anchor) {
            let body = pages::read_body(&pages_dir(library, project)?, id)?;
            p.text = section_summary(&body, &anchor).unwrap_or_default();
            p.section = Some(h.text.clone());
        }
    }
    Ok(p)
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
}

/// Every infobox field link that points at page `id` (by title or alias),
/// for "Linked from" and two-way fields. Sorted by title.
pub fn incoming_fields(idx: &ProjectIndex, id: &str) -> AppResult<Vec<IncomingField>> {
    let target = entry(idx, id)?;
    let names: Vec<String> = std::iter::once(&target.title).chain(&target.aliases).map(|n| norm(n)).collect();
    let mut out = Vec::new();
    for (pid, e) in idx.pages.iter().filter(|(pid, _)| pid.as_str() != id) {
        for l in &e.field_links {
            if names.contains(&norm(&l.target))
                && !out.iter().any(|o: &IncomingField| &o.id == pid && norm(&o.field) == norm(&l.field))
            {
                out.push(IncomingField { field: l.field.clone(), id: pid.clone(), title: e.title.clone(), two_way: l.two_way });
            }
        }
    }
    out.sort_by_key(|o| o.title.to_lowercase());
    Ok(out)
}

pub fn sections(idx: &ProjectIndex, id: &str) -> AppResult<Vec<Heading>> {
    Ok(entry(idx, id)?.headings.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::{create_project, main_page, set_main_page};
    use std::fs;

    fn setup(pages_: &[(&str, &str)]) -> (tempfile::TempDir, String, ProjectIndex) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap().id;
        let dir = lib.path().join(&p);
        fs::remove_file(dir.join("pages/Main Page.md")).unwrap();
        for (id, text) in pages_ {
            let path = dir.join("pages").join(id);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        (lib, p, idx)
    }

    fn read(lib: &Path, p: &str, id: &str) -> String {
        fs::read_to_string(lib.join(p).join("pages").join(id)).unwrap()
    }

    #[test]
    fn rename_rewrites_links_everywhere() {
        let (lib, p, mut idx) = setup(&[
            ("Old.md", "---\ntitle: Old\naliases: [Nick]\n---\nSelf: [[Old]]\n"),
            ("G/A.md", "[[Old]] [[old|kept]] [[Old#S]] [[Nick]] `[[Old]]`\n"),
            ("B.md", "---\ntitle: B\nx: 1\n---\n| [[Old\\|t]] |\n"),
            ("C.md", "No links to it. [[Other]]\n"),
        ]);
        set_main_page(&idx.dir.clone(), Some("old")).unwrap();
        assert_eq!(link_count(&idx, "Old"), LinkCount { links: 5, pages: 3 });
        let r = rename_with_links(lib.path(), &p, &mut idx, "Old.md", "New Name", false, false).unwrap();
        assert_eq!((r.page.id.as_str(), r.links, r.pages), ("New Name.md", 5, 3));
        assert!(r.failed.is_empty());
        assert_eq!(read(lib.path(), &p, "G/A.md"), "[[New Name]] [[New Name|kept]] [[New Name#S]] [[Nick]] `[[Old]]`\n");
        assert_eq!(read(lib.path(), &p, "B.md"), "---\ntitle: B\nx: 1\n---\n| [[New Name\\|t]] |\n");
        assert!(read(lib.path(), &p, "New Name.md").ends_with("Self: [[New Name]]\n"));
        assert_eq!(main_page(&idx.dir).as_deref(), Some("New Name"));
        // The index knows straight away: no stale links left.
        assert_eq!(link_count(&idx, "Old").links, 0);
        assert_eq!(link_count(&idx, "New Name").links, 5);
        assert_eq!(backlinks(lib.path(), &p, &idx, "New Name.md", false).unwrap().len(), 2);
    }

    #[test]
    fn rename_can_keep_old_title_as_alias() {
        let (lib, p, mut idx) = setup(&[("Old.md", ""), ("A.md", "[[Old]]")]);
        let r = rename_with_links(lib.path(), &p, &mut idx, "Old.md", "New", false, true).unwrap();
        assert_eq!(r.page.aliases, ["Old"]);
        assert_eq!(read(lib.path(), &p, "A.md"), "[[New]]");
        assert!(read(lib.path(), &p, "New.md").contains("aliases:\n- Old\n"));
        // A case-only rename doesn't add itself as an alias.
        let r = rename_with_links(lib.path(), &p, &mut idx, "New.md", "new", false, true).unwrap();
        assert_eq!(r.page.aliases, ["Old"]);
    }

    #[test]
    fn rename_refuses_taken_names_and_changes_nothing() {
        let (lib, p, mut idx) = setup(&[("Old.md", ""), ("A.md", "---\naliases: [Taken]\n---\n[[Old]]")]);
        assert!(rename_with_links(lib.path(), &p, &mut idx, "Old.md", "taken", false, false).is_err());
        assert!(read(lib.path(), &p, "A.md").ends_with("[[Old]]"));
    }

    #[test]
    fn backlinks_list_pages_aliases_and_lines() {
        let (lib, p, idx) = setup(&[
            ("T.md", "---\ntitle: Target\naliases: [Alias]\n---\n[[Target]] self\n"),
            ("G/A.md", "one [[Target]]\n\ntwo [[alias|x]] and [[Target#S]]\n"),
            ("b.md", "[[Nothing]]\n"),
            ("C.md", "---\ntitle: c page\n---\n[[Alias]]"),
        ]);
        let list = backlinks(lib.path(), &p, &idx, "T.md", true).unwrap();
        assert_eq!(
            list,
            [
                Backlink {
                    id: "G/A.md".into(),
                    title: "A".into(),
                    group: "G".into(),
                    via: vec!["Alias".into()],
                    lines: vec!["one [[Target]]".into(), "two [[alias|x]] and [[Target#S]]".into()],
                    fields: vec![],
                },
                Backlink {
                    id: "C.md".into(),
                    title: "c page".into(),
                    group: "".into(),
                    via: vec!["Alias".into()],
                    lines: vec!["[[Alias]]".into()],
                    fields: vec![],
                },
            ]
        );
        assert!(backlinks(lib.path(), &p, &idx, "T.md", false).unwrap()[0].lines.is_empty());
    }

    #[test]
    fn infobox_links_count_rename_and_list() {
        let (lib, p, mut idx) = setup(&[
            ("Old.md", "---\ntitle: Old\naliases: [Nick]\n---\n"),
            (
                "A.md",
                "---\ninfobox:\n  fields:\n  - label: Father\n    type: link\n    value: Old\n  - label: Spouse\n    type: links\n    options: { twoWay: true }\n    value: [Nick, Other]\n  - label: Note\n    type: text\n    value: '[[old|x]]'\n---\nText [[Old]]\n",
            ),
            ("B.md", "---\ninfobox:\n  fields:\n  - label: Father\n    type: link\n    value: Old\n---\n"),
        ]);
        let bl = backlinks(lib.path(), &p, &idx, "Old.md", true).unwrap();
        assert_eq!(bl.len(), 2);
        assert_eq!((bl[0].fields.clone(), bl[0].via.clone()), (vec!["Father".into(), "Spouse".into(), "Note".into()], vec!["Nick".into()]));
        assert_eq!(bl[0].lines, ["Text [[Old]]"]);
        assert_eq!((bl[1].fields.clone(), bl[1].lines.len()), (vec!["Father".into()], 0));
        let inc = incoming_fields(&idx, "Old.md").unwrap();
        let got: Vec<_> = inc.iter().map(|i| (i.field.as_str(), i.id.as_str(), i.two_way)).collect();
        assert_eq!(got, [("Father", "A.md", false), ("Spouse", "A.md", true), ("Note", "A.md", false), ("Father", "B.md", false)]);
        assert_eq!(link_count(&idx, "Old"), LinkCount { links: 4, pages: 2 });
        let r = rename_with_links(lib.path(), &p, &mut idx, "Old.md", "New", false, false).unwrap();
        assert_eq!((r.links, r.pages), (4, 2));
        let a = read(lib.path(), &p, "A.md");
        assert!(a.contains("value: New\n") && a.contains("- Nick\n") && a.contains("[[New|x]]") && a.ends_with("Text [[New]]\n"), "{a}");
        assert_eq!(link_count(&idx, "Old").links, 0);
        assert_eq!(incoming_fields(&idx, "New.md").unwrap().len(), 4);
    }

    #[test]
    fn previews_and_sections() {
        let (lib, p, idx) = setup(&[("A.md", "Opening text.\n\n## Early Life\n\nYoung.\n\n## Early Life\n\nAgain.\n")]);
        let pv = preview(lib.path(), &p, &idx, "A.md", None).unwrap();
        assert_eq!((pv.title.as_str(), pv.text.as_str(), pv.section), ("A", "Opening text.", None));
        let pv = preview(lib.path(), &p, &idx, "A.md", Some("early life")).unwrap();
        assert_eq!((pv.text.as_str(), pv.section.as_deref()), ("Young.", Some("Early Life")));
        let pv = preview(lib.path(), &p, &idx, "A.md", Some("Early-Life-2")).unwrap();
        assert_eq!(pv.text, "Again.");
        // A missing section shows the page's opening.
        let pv = preview(lib.path(), &p, &idx, "A.md", Some("Nope")).unwrap();
        assert_eq!((pv.text.as_str(), pv.section), ("Opening text.", None));
        let s: Vec<_> = sections(&idx, "A.md").unwrap().into_iter().map(|h| h.anchor).collect();
        assert_eq!(s, ["early-life", "early-life-2"]);
    }

    /// Speed check from the M4 spec. Run with
    /// `cargo test --release -- --ignored --nocapture big_project`.
    #[test]
    #[ignore]
    fn big_project_speed() {
        use std::time::Instant;
        let (lib, p, _) = setup(&[]);
        let dir = lib.path().join(&p);
        for g in 0..50 {
            fs::create_dir_all(dir.join(format!("pages/Group {g}"))).unwrap();
        }
        for i in 0..5000 {
            let mut body = format!("Opening paragraph of page {i} with some words.\n\n## Section one\n\n");
            for k in 0..20 {
                let target = if i % 10 == 0 && k == 0 { 0 } else { (i * 7 + k * 13) % 5000 };
                body.push_str(&format!("Text [[Page {target}]] more text.\n"));
            }
            let text = format!("---\ntitle: Page {i}\n---\n{body}");
            fs::write(dir.join(format!("pages/Group {}/Page {i}.md", i % 50)), text).unwrap();
        }
        let t = Instant::now();
        let mut idx = ProjectIndex::open(&dir).unwrap();
        println!("first open (no cache): {:?}", t.elapsed());
        drop(idx);
        let t = Instant::now();
        idx = ProjectIndex::open(&dir).unwrap();
        let reopen = t.elapsed();
        println!("reopen (cache): {reopen:?}");
        let t = Instant::now();
        let infos = idx.page_infos();
        println!("page list: {:?} ({} pages)", t.elapsed(), infos.len());
        let before = link_count(&idx, "Page 0");
        println!("links to Page 0: {} in {} pages", before.links, before.pages);
        assert!(before.pages >= 500);
        let t = Instant::now();
        let r = rename_with_links(lib.path(), &p, &mut idx, "Group 0/Page 0.md", "Renamed page", false, false).unwrap();
        let rename = t.elapsed();
        println!("rename with {} links in {} pages: {rename:?}", r.links, r.pages);
        assert!(r.failed.is_empty());
        assert_eq!(link_count(&idx, "Page 0").links, 0);
        let t = Instant::now();
        let bl = backlinks(lib.path(), &p, &idx, "Group 0/Renamed page.md", true).unwrap();
        println!("backlinks with context: {:?} ({} pages)", t.elapsed(), bl.len());
        assert!(reopen.as_millis() < 1000, "reopen too slow");
        assert!(rename.as_secs() < 5, "rename too slow");
    }
}
