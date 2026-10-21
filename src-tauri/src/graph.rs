//! The graph view (M11): pages as nodes, links between them as lines, read
//! from the link index. Text links and infobox field links count (relations
//! too); embeds don't. Several links between the same two pages make one
//! line, which knows both directions, whether a text link is among them and
//! the names of the fields behind it (spoiler fields flagged). Links to pages
//! that don't exist become red-link nodes. Filters, extra nodes (categories,
//! groups) and colours are worked out in the window (src/graph/model.ts).
//!
//! Where the nodes sit is remembered per project on each computer, in the
//! project's cache folder (never synced).

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;
use crate::fsutil::safe_write;
use crate::index::ProjectIndex;
use crate::wikilinks::{category_of, norm};

const LAYOUT_FILE: &str = "graph-layout.json";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
}

/// An infobox field behind a line.
#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct GraphField {
    pub name: String,
    /// Every link from this field along the line is a spoiler (a spoiler
    /// field, or inside `||…||`): its name shows only with the eye switch on.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub spoiler: bool,
}

/// One line between two nodes. Node numbers: pages first (their place in
/// `pages`), then red links (`pages.len()` + place in `missing`).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphLink {
    /// The smaller node number first.
    pub a: u32,
    pub b: u32,
    /// Directions: a links to b, b links to a.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ab: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ba: bool,
    /// At least one link in page text.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub text: bool,
    /// Infobox fields behind the line, each name once.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<GraphField>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GraphData {
    pub pages: Vec<GraphPage>,
    /// Names linked to that no page has (as first written).
    pub missing: Vec<String>,
    pub links: Vec<GraphLink>,
}

/// Every page and line of the project.
pub fn graph(idx: &ProjectIndex) -> GraphData {
    let pages: Vec<GraphPage> = idx
        .pages
        .iter()
        .map(|(id, e)| GraphPage {
            id: id.clone(),
            title: e.title.clone(),
            aliases: e.aliases.clone(),
            template: e.template.clone(),
            categories: e.categories.clone(),
        })
        .collect();
    // Titles and aliases -> node number (titles win over aliases).
    let mut by_name: HashMap<String, u32> = HashMap::new();
    for (i, e) in idx.pages.values().enumerate() {
        for a in &e.aliases {
            by_name.entry(norm(a)).or_insert(i as u32);
        }
    }
    for (i, e) in idx.pages.values().enumerate() {
        by_name.insert(norm(&e.title), i as u32);
    }
    let mut missing: Vec<String> = Vec::new();
    let mut missing_at: HashMap<String, u32> = HashMap::new();
    let mut lines: BTreeMap<(u32, u32), GraphLink> = BTreeMap::new();
    let n = pages.len() as u32;
    for (i, e) in idx.pages.values().enumerate() {
        let from = i as u32;
        let mut node_of = |target: &str| -> Option<u32> {
            if target.trim().is_empty() || category_of(target).is_some() {
                return None;
            }
            let key = norm(target);
            if let Some(&p) = by_name.get(&key) {
                return Some(p);
            }
            Some(*missing_at.entry(key).or_insert_with(|| {
                missing.push(target.trim().to_string());
                n + missing.len() as u32 - 1
            }))
        };
        let mut add = |to: u32, field: Option<(&str, bool)>| {
            if to == from {
                return;
            }
            let (a, b) = (from.min(to), from.max(to));
            let line = lines.entry((a, b)).or_insert_with(|| GraphLink { a, b, ab: false, ba: false, text: false, fields: Vec::new() });
            if from == a {
                line.ab = true;
            } else {
                line.ba = true;
            }
            match field {
                None => line.text = true,
                Some((name, spoiler)) => match line.fields.iter_mut().find(|f| norm(&f.name) == norm(name)) {
                    // One open link is enough to name the field openly.
                    Some(f) => f.spoiler &= spoiler,
                    None => line.fields.push(GraphField { name: name.to_string(), spoiler }),
                },
            }
        };
        for l in &e.links {
            if let Some(to) = node_of(&l.target) {
                add(to, None);
            }
        }
        for l in &e.field_links {
            if let Some(to) = node_of(&l.target) {
                add(to, Some((&l.field, l.spoiler)));
            }
        }
    }
    GraphData { pages, missing, links: lines.into_values().collect() }
}

/// The remembered node positions (whatever the window stored), if any.
pub fn layout(project_dir: &Path) -> Option<serde_json::Value> {
    let text = fs::read_to_string(crate::projects::cache_dir(project_dir).join(LAYOUT_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_layout(project_dir: &Path, layout: &serde_json::Value) -> AppResult<()> {
    let dir = crate::projects::cache_dir(project_dir);
    fs::create_dir_all(&dir)?;
    Ok(safe_write(&dir.join(LAYOUT_FILE), &serde_json::to_vec(layout)?)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;

    fn setup(pages: &[(&str, &str)]) -> (tempfile::TempDir, ProjectIndex) {
        let lib = tempfile::tempdir().unwrap();
        let p = create_project(lib.path(), "Project A").unwrap().id;
        let dir = lib.path().join(&p);
        fs::remove_file(dir.join("pages/Main Page.md")).unwrap();
        for (id, text) in pages {
            let path = dir.join("pages").join(id);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        (lib, idx)
    }

    fn line<'a>(g: &'a GraphData, x: &str, y: &str) -> Option<&'a GraphLink> {
        let num = |name: &str| {
            g.pages
                .iter()
                .position(|p| p.title == name)
                .or_else(|| g.missing.iter().position(|m| m == name).map(|i| g.pages.len() + i))
                .unwrap() as u32
        };
        let (a, b) = (num(x).min(num(y)), num(x).max(num(y)));
        g.links.iter().find(|l| l.a == a && l.b == b)
    }

    const FIELDS: &str = "---\ntitle: Page B\ninfobox:\n  fields:\n  - label: Father\n    type: links\n    value: [Page A]\n  - label: Secret\n    type: links\n    spoiler: true\n    value: [Page C]\n  - label: Note\n    type: text\n    value: \"[[Page A]] and ||[[Page D]]||\"\n---\nText [[page a]] and [[Alias C]].\n";

    #[test]
    fn one_line_per_pair_with_directions_and_fields() {
        let (_lib, idx) = setup(&[
            ("Page A.md", "---\ntitle: Page A\n---\nSee [[Page B]] and [[Page B#Sec|again]], [[Page A]], [[#Top]].\n{{Page C}}\n"),
            ("Page B.md", FIELDS),
            ("Group/Page C.md", "---\ntitle: Page C\naliases: [Alias C]\n---\n[[Category:Cat A]]\n"),
        ]);
        let g = graph(&idx);
        assert_eq!(g.pages.len(), 3);
        let ab = line(&g, "Page A", "Page B").unwrap();
        assert!(ab.ab && ab.ba && ab.text);
        assert_eq!(
            ab.fields,
            vec![GraphField { name: "Father".into(), spoiler: false }, GraphField { name: "Note".into(), spoiler: false }]
        );
        // Through an alias, and a spoiler field; the embed {{Page C}} doesn't count.
        let bc = line(&g, "Page B", "Page C").unwrap();
        assert!(bc.text);
        assert_eq!(bc.fields, vec![GraphField { name: "Secret".into(), spoiler: true }]);
        assert!(line(&g, "Page A", "Page C").is_none());
        // A missing page from a link inside ||…|| in a text field: a red-link node with a spoiler field.
        assert_eq!(g.missing, vec!["Page D".to_string()]);
        let bd = line(&g, "Page B", "Page D").unwrap();
        assert!(!bd.text);
        assert_eq!(bd.fields, vec![GraphField { name: "Note".into(), spoiler: true }]);
        // No self links, no section-only links, no category links.
        assert_eq!(g.links.len(), 3);
    }

    #[test]
    fn red_links_are_merged_by_name() {
        let (_lib, idx) = setup(&[
            ("Page A.md", "[[Missing X]] [[missing x]]\n"),
            ("Page B.md", "[[MISSING X]]\n"),
        ]);
        let g = graph(&idx);
        assert_eq!(g.missing, vec!["Missing X".to_string()]);
        assert_eq!(g.links.len(), 2);
        assert!(g.links.iter().all(|l| l.b == 2 && l.ab && !l.ba));
    }

    #[test]
    fn layout_round_trip() {
        let (_lib, idx) = setup(&[]);
        assert!(layout(&idx.dir).is_none());
        let v = serde_json::json!({"positions": {"p:Page A.md": [1.5, -2.0]}});
        save_layout(&idx.dir, &v).unwrap();
        assert_eq!(layout(&idx.dir), Some(v));
    }

    #[test]
    #[ignore]
    fn speed() {
        use std::time::Instant;
        let tmp = tempfile::tempdir().unwrap();
        let p = create_project(tmp.path(), "P").unwrap().id;
        let dir = tmp.path().join(&p);
        for i in 0..5000 {
            let links: String = (1..=5).map(|k| format!("[[Page {}]] ", (i * 7 + k * 131) % 5100)).collect();
            fs::write(dir.join(format!("pages/Page {i}.md")), format!("---\ntitle: Page {i}\n---\n{links}\n")).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        let t = Instant::now();
        let g = graph(&idx);
        let json = serde_json::to_vec(&g).unwrap();
        eprintln!("graph: {} pages, {} lines, {} KB in {:?}", g.pages.len(), g.links.len(), json.len() / 1024, t.elapsed());
    }
}
