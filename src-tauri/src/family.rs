//! Family trees (M12): who is whose parent and partner, read from the link
//! index. Project settings (project.json `familyTree`) say which Page link
//! fields make a family: parent fields point from a child to a parent
//! (*Father*, *Mother*), partner fields link partners (*Spouse*, *Lover*).
//! Children are never stored: they come from the parent fields, plus names
//! typed into a Linked from field that reads a parent field. Nothing about
//! trees is stored in pages. Which people a tree shows, and where, is worked
//! out in the window (src/family/).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::index::ProjectIndex;
use crate::infobox::Life;
use crate::wikilinks::{category_of, norm};

/// One field of the settings and how its lines are drawn.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldStyle {
    #[serde(default)]
    pub field: String,
    /// "solid" (default), "dashed" or "dotted".
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub line: String,
}

/// project.json `familyTree` (unknown keys are kept by projects.rs, which stores the raw value).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct FamilySettings {
    #[serde(default)]
    pub parents: Vec<FieldStyle>,
    #[serde(default)]
    pub partners: Vec<FieldStyle>,
}

impl FamilySettings {
    pub fn read(dir: &std::path::Path) -> FamilySettings {
        crate::projects::settings(dir)
            .ok()
            .and_then(|s| s.family_tree)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }

    fn index_of(list: &[FieldStyle], name: &str) -> Option<u32> {
        list.iter().position(|f| !f.field.trim().is_empty() && norm(&f.field) == norm(name)).map(|i| i as u32)
    }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FamilyPerson {
    /// The page; none for a name no page has (a placeholder).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(flatten)]
    pub life: Life,
}

/// A child -> parent relation (numbers: places in `people`).
#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct ParentLink {
    pub child: u32,
    pub parent: u32,
    /// Place of the field in the settings' parent fields.
    pub field: u32,
    /// Place of the entry in its field (parents' order).
    pub pos: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub spoiler: bool,
    /// Typed into a Linked from field on the parent's page.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub typed: bool,
    /// Part of a loop: someone ends up their own ancestor.
    #[serde(rename = "loop", skip_serializing_if = "std::ops::Not::not")]
    pub in_loop: bool,
}

/// A partner link as stored on page `a` (the window merges both sides).
#[derive(Debug, Serialize, PartialEq)]
pub struct PartnerLink {
    pub a: u32,
    pub b: u32,
    /// Place of the field in the settings' partner fields.
    pub field: u32,
    pub pos: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub spoiler: bool,
    /// Words around the link on `a`'s page ("(m. 283)").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FamilyData {
    pub settings: FamilySettings,
    pub people: Vec<FamilyPerson>,
    pub parents: Vec<ParentLink>,
    pub partners: Vec<PartnerLink>,
}

/// Every family relation of the project.
pub fn family(idx: &ProjectIndex, settings: &FamilySettings) -> FamilyData {
    let ids: Vec<&String> = idx.pages.keys().collect();
    // Titles and aliases -> page number (titles win over aliases).
    let mut by_name: HashMap<String, usize> = HashMap::new();
    for (i, e) in idx.pages.values().enumerate() {
        for a in &e.aliases {
            by_name.entry(norm(a)).or_insert(i);
        }
    }
    for (i, e) in idx.pages.values().enumerate() {
        by_name.insert(norm(&e.title), i);
    }
    let entries: Vec<_> = idx.pages.values().collect();
    let mut people = People { ids: &ids, entries: &entries, by_name: &by_name, list: Vec::new(), page_at: HashMap::new(), missing_at: HashMap::new() };
    // (child, parent) -> link; the same relation entered twice (a Father
    // field and a typed-in child) counts once, a spoiler only if both are.
    let mut parents: BTreeMap<(u32, u32), ParentLink> = BTreeMap::new();
    let mut add_parent = |l: ParentLink| {
        if l.child == l.parent {
            return;
        }
        parents
            .entry((l.child, l.parent))
            .and_modify(|o| {
                o.spoiler &= l.spoiler;
                if l.field < o.field {
                    o.field = l.field;
                    o.pos = l.pos;
                }
                o.typed &= l.typed;
            })
            .or_insert(l);
    };
    let mut partners: Vec<PartnerLink> = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let mut counts: HashMap<String, u32> = HashMap::new();
        let mut next_pos = |field: &str| {
            let n = counts.entry(norm(field)).or_insert(0);
            *n += 1;
            *n - 1
        };
        for l in &e.field_links {
            if l.in_text {
                continue;
            }
            if l.typed {
                // A name typed into a Linked from field reading a parent field: a child of this page.
                let Some(def) = e.reverse.iter().find(|r| norm(&r.label) == norm(&l.field)) else { continue };
                let Some(field) = def.from.iter().filter_map(|f| FamilySettings::index_of(&settings.parents, f)).min() else { continue };
                let pos = next_pos(&l.field);
                let me = people.page(i);
                if let Some(child) = people.named(&l.target) {
                    add_parent(ParentLink { child, parent: me, field, pos, spoiler: l.spoiler, typed: true, in_loop: false });
                }
            } else if let Some(field) = FamilySettings::index_of(&settings.parents, &l.field) {
                let pos = next_pos(&l.field);
                let me = people.page(i);
                if let Some(parent) = people.named(&l.target) {
                    add_parent(ParentLink { child: me, parent, field, pos, spoiler: l.spoiler, typed: false, in_loop: false });
                }
            } else if let Some(field) = FamilySettings::index_of(&settings.partners, &l.field) {
                let pos = next_pos(&l.field);
                let me = people.page(i);
                if let Some(b) = people.named(&l.target).filter(|&b| b != me) {
                    partners.push(PartnerLink { a: me, b, field, pos, spoiler: l.spoiler, words: l.words.clone() });
                }
            }
        }
    }
    let people = people.list;
    let mut parents: Vec<ParentLink> = parents.into_values().collect();
    for i in loop_links(people.len(), &parents) {
        parents[i].in_loop = true;
    }
    FamilyData { settings: settings.clone(), people, parents, partners }
}

/// People are numbered in the order they're met.
struct People<'a> {
    ids: &'a [&'a String],
    entries: &'a [&'a crate::index::Entry],
    by_name: &'a HashMap<String, usize>,
    list: Vec<FamilyPerson>,
    page_at: HashMap<usize, u32>,
    missing_at: HashMap<String, u32>,
}

impl People<'_> {
    /// The person of page number `i`.
    fn page(&mut self, i: usize) -> u32 {
        if let Some(&n) = self.page_at.get(&i) {
            return n;
        }
        let e = self.entries[i];
        self.list.push(FamilyPerson {
            id: Some(self.ids[i].clone()),
            title: e.title.clone(),
            aliases: e.aliases.clone(),
            image: e.image.clone(),
            template: e.template.clone(),
            life: e.life.clone(),
        });
        let n = self.list.len() as u32 - 1;
        self.page_at.insert(i, n);
        n
    }

    /// The person a name links to: a page, else a placeholder.
    fn named(&mut self, name: &str) -> Option<u32> {
        let name = name.trim();
        if name.is_empty() || category_of(name).is_some() {
            return None;
        }
        let key = norm(name);
        if let Some(&i) = self.by_name.get(&key) {
            return Some(self.page(i));
        }
        if let Some(&n) = self.missing_at.get(&key) {
            return Some(n);
        }
        self.list.push(FamilyPerson { id: None, title: name.to_string(), aliases: Vec::new(), image: None, template: None, life: Life::default() });
        let n = self.list.len() as u32 - 1;
        self.missing_at.insert(key, n);
        Some(n)
    }
}

/// Parent links that are part of a loop (someone is their own ancestor):
/// the links inside a strongly connected group of the child -> parent graph.
fn loop_links(n: usize, links: &[ParentLink]) -> Vec<usize> {
    let mut out_edges: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, l) in links.iter().enumerate() {
        out_edges[l.child as usize].push(i);
    }
    // Tarjan's algorithm, without recursion (families can be deep).
    let mut index = vec![usize::MAX; n];
    let mut low = vec![0usize; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut group = vec![usize::MAX; n];
    let mut groups = 0usize;
    let mut counter = 0usize;
    for start in 0..n {
        if index[start] != usize::MAX {
            continue;
        }
        let mut work: Vec<(usize, usize)> = vec![(start, 0)];
        index[start] = counter;
        low[start] = counter;
        counter += 1;
        stack.push(start);
        on_stack[start] = true;
        while let Some(&mut (v, ref mut next)) = work.last_mut() {
            if *next < out_edges[v].len() {
                let w = links[out_edges[v][*next]].parent as usize;
                *next += 1;
                if index[w] == usize::MAX {
                    index[w] = counter;
                    low[w] = counter;
                    counter += 1;
                    stack.push(w);
                    on_stack[w] = true;
                    work.push((w, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
            } else {
                work.pop();
                if let Some(&(u, _)) = work.last() {
                    low[u] = low[u].min(low[v]);
                }
                if low[v] == index[v] {
                    while let Some(w) = stack.pop() {
                        on_stack[w] = false;
                        group[w] = groups;
                        if w == v {
                            break;
                        }
                    }
                    groups += 1;
                }
            }
        }
    }
    links
        .iter()
        .enumerate()
        .filter(|(_, l)| group[l.child as usize] == group[l.parent as usize])
        .map(|(i, _)| i)
        .collect()
}

/// Relations (page id, field, target as written, compared with [`norm`])
/// that make someone their own ancestor, for the Relations screen.
pub fn loop_relations(idx: &ProjectIndex, settings: &FamilySettings) -> HashSet<(String, String, String)> {
    let data = family(idx, settings);
    let mut out = HashSet::new();
    for l in data.parents.iter().filter(|l| l.in_loop && !l.typed) {
        let child = &data.people[l.child as usize];
        let parent = &data.people[l.parent as usize];
        let (Some(id), Some(field)) = (&child.id, settings.parents.get(l.field as usize)) else { continue };
        for name in std::iter::once(&parent.title).chain(&parent.aliases) {
            out.insert((id.clone(), norm(&field.field), norm(name)));
        }
    }
    out
}

/// The family data, or only its fingerprint when the window already has it.
#[derive(Debug, Serialize)]
pub struct FamilyReply {
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<FamilyData>,
}

pub fn reply(idx: &ProjectIndex, settings: &FamilySettings, known: Option<&str>) -> FamilyReply {
    use std::hash::{Hash, Hasher};
    let data = family(idx, settings);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_vec(&data).unwrap_or_default().hash(&mut h);
    let hash = format!("{:016x}", h.finish());
    let data = (known != Some(hash.as_str())).then_some(data);
    FamilyReply { hash, data }
}

/// Names of the Page link fields pages have (for the settings), in natural order.
pub fn link_field_names(idx: &ProjectIndex) -> Vec<String> {
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for e in idx.pages.values() {
        for f in e.fields.iter().filter(|f| f.kind == crate::infobox::LINK || f.kind == crate::infobox::LINKS) {
            if !f.label.trim().is_empty() {
                seen.entry(norm(&f.label)).or_insert_with(|| f.label.trim().to_string());
            }
        }
    }
    seen.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::create_project;
    use std::fs;

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

    fn settings() -> FamilySettings {
        let f = |name: &str, line: &str| FieldStyle { field: name.into(), line: line.into() };
        FamilySettings { parents: vec![f("Father", ""), f("Mother", ""), f("Adoptive father", "dashed")], partners: vec![f("Spouse", ""), f("Lover", "dashed")] }
    }

    fn page(title: &str, fields: &str) -> String {
        format!("---\ntitle: {title}\ninfobox:\n  fields:\n{fields}---\n")
    }

    fn links(label: &str, values: &[&str]) -> String {
        let list: Vec<String> = values.iter().map(|v| format!("'{v}'")).collect();
        format!("  - label: {label}\n    type: links\n    value: [{}]\n", list.join(", "))
    }

    fn num(d: &FamilyData, title: &str) -> u32 {
        d.people.iter().position(|p| p.title == title).unwrap() as u32
    }

    #[test]
    fn family_from_the_link_index() {
        let born = "  - label: Born\n    type: date\n    options: { age: birth }\n    value: { year: 250, qualifier: c, era: AC }\n  - label: Died\n    type: dateplace\n    options: { age: death }\n    spoiler: true\n    value: { date: { start: { year: 300 }, end: { year: 301 } }, text: Place A }\n";
        let (_lib, idx) = setup(&[
            ("Page A.md", &page("Page A", &format!("{}{}{born}", links("Spouse", &["[[Page B]] (m. 283)"]), links("Lover", &["Page D"])))),
            ("Page B.md", &page("Page B", &links("Spouse", &["Page A"]))),
            ("Page C.md", &page("Page C", &format!("{}{}", links("Father", &["Page A"]), links("mother", &["Alias B", "Page A"])))),
            // A name typed into a Linked from field reading Father: a child of Page A (and nobody else's).
            ("Page E.md", "---\ntitle: Page E\naliases: [Alias B]\n---\n"),
            ("Page F.md", &page("Page F", "  - label: Children\n    type: linkedfrom\n    options: { from: [Father, Other] }\n    value: [Missing child]\n  - label: Other\n    type: links\n    value: [Page A]\n")),
        ]);
        let d = family(&idx, &settings());
        // Pages without any family field aren't people unless linked (Page E is, through its alias).
        let titles: Vec<&str> = d.people.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles.len(), 7, "{titles:?}");
        assert!(!titles.contains(&"Main Page"));
        let a = &d.people[num(&d, "Page A") as usize];
        assert_eq!(a.life.birth.as_ref().unwrap().year, 250.0);
        assert_eq!(a.life.birth.as_ref().unwrap().qualifier.as_deref(), Some("c"));
        assert_eq!(a.life.birth.as_ref().unwrap().era.as_deref(), Some("AC"));
        let death = a.life.death.as_ref().unwrap();
        assert!(death.spoiler && death.year == 300.0);
        // Partners: one link per stored side, with words and field number.
        let ab: Vec<&PartnerLink> = d.partners.iter().filter(|l| l.a == num(&d, "Page A")).collect();
        assert_eq!(ab.len(), 2);
        assert_eq!(ab[0].b, num(&d, "Page B"));
        assert_eq!(ab[0].words.as_deref(), Some("(m. 283)"));
        assert_eq!(ab[1].field, 1);
        assert_eq!(d.people[ab[1].b as usize].id, None, "Page D is a placeholder");
        assert!(d.partners.iter().any(|l| l.a == num(&d, "Page B") && l.b == num(&d, "Page A") && l.words.is_none()));
        // Parents (field names case-insensitive), in field order.
        let c = num(&d, "Page C");
        let of_c: Vec<(u32, u32, u32)> = d.parents.iter().filter(|l| l.child == c).map(|l| (l.parent, l.field, l.pos)).collect();
        // Page A is both Father and Mother: once, as the first field.
        assert!(of_c.contains(&(num(&d, "Page A"), 0, 0)));
        assert!(of_c.contains(&(num(&d, "Page E"), 1, 0)));
        assert_eq!(of_c.len(), 2);
        let typed = d.parents.iter().find(|l| l.parent == num(&d, "Page F")).unwrap();
        assert!(typed.typed && d.people[typed.child as usize].title == "Missing child");
        // The Other field isn't in the settings.
        assert!(!d.parents.iter().any(|l| l.child == num(&d, "Page F")));
    }

    #[test]
    fn loops_are_found() {
        let (_lib, idx) = setup(&[
            ("Page A.md", &page("Page A", &links("Father", &["Page B"]))),
            ("Page B.md", &page("Page B", &links("Father", &["Page C"]))),
            ("Page C.md", &page("Page C", &links("Mother", &["Page A"]))),
            ("Page D.md", &page("Page D", &links("Father", &["Page A"]))),
        ]);
        let d = family(&idx, &settings());
        let looped: Vec<(String, String)> = d
            .parents
            .iter()
            .filter(|l| l.in_loop)
            .map(|l| (d.people[l.child as usize].title.clone(), d.people[l.parent as usize].title.clone()))
            .collect();
        assert_eq!(looped.len(), 3);
        assert!(!d.parents.iter().any(|l| l.in_loop && d.people[l.child as usize].title == "Page D"));
        let rel = loop_relations(&idx, &settings());
        assert!(rel.contains(&("Page C.md".to_string(), "mother".to_string(), "page a".to_string())));
        assert_eq!(rel.len(), 3);
        // The Relations screen flags them (with the settings in project.json).
        let mut s = crate::projects::settings(&idx.dir).unwrap();
        s.family_tree = Some(serde_json::to_value(settings()).unwrap());
        crate::projects::set_settings(&idx.dir, &s).unwrap();
        let table = crate::relations::table(&idx);
        let flagged: Vec<&str> = table.rows.iter().filter(|r| r.problem.as_deref().is_some_and(|p| p.contains("own ancestor"))).map(|r| r.title.as_str()).collect();
        assert_eq!(flagged, vec!["Page A", "Page B", "Page C"]);
    }

    #[test]
    fn spoilers_and_reply() {
        let secret = "  - label: Father\n    type: links\n    spoiler: true\n    value: [Page A]\n";
        let (_lib, idx) = setup(&[("Page A.md", "x\n"), ("Page B.md", &page("Page B", secret))]);
        let d = family(&idx, &settings());
        assert!(d.parents[0].spoiler);
        let first = reply(&idx, &settings(), None);
        assert!(first.data.is_some());
        assert!(reply(&idx, &settings(), Some(&first.hash)).data.is_none());
        // Other settings, other data.
        assert!(reply(&idx, &FamilySettings::default(), Some(&first.hash)).data.is_some());
        assert_eq!(link_field_names(&idx), vec!["Father".to_string()]);
    }

    #[test]
    #[ignore]
    fn speed() {
        use std::time::Instant;
        let tmp = tempfile::tempdir().unwrap();
        let p = create_project(tmp.path(), "P").unwrap().id;
        let dir = tmp.path().join(&p);
        for i in 0..5000 {
            let fields = if i > 0 && i < 500 { links("Father", &[&format!("Page {}", (i - 1) / 2)]) } else { String::new() };
            fs::write(dir.join(format!("pages/Page {i}.md")), page(&format!("Page {i}"), &fields)).unwrap();
        }
        let idx = ProjectIndex::open(&dir).unwrap();
        let t = Instant::now();
        let r = reply(&idx, &settings(), None);
        let json = serde_json::to_vec(&r).unwrap();
        eprintln!("family: {} KB in {:?}", json.len() / 1024, t.elapsed());
    }
}
