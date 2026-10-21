//! Deep search (M10): every page's and category file's text, as
//! searchtext.rs reads it, kept in memory while a project is open and cached
//! in `.cache/search-index.json` (never the source of truth) with each file's
//! modification time and size, so only changed files are read again. It
//! follows the link index: a search first brings itself up to date with the
//! files the link index knows.
//!
//! Matching: upper/lower case and accents ignored, each word matches the
//! start of a word, all words must be on the page (in any places),
//! `"phrases"` match as a whole. With spoilers off, spoiler text is not
//! searched at all and snippets leave it out.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::fsutil::{join_rel, rel_name, rel_parent, safe_write};
use crate::index::ProjectIndex;
use crate::projects::{CACHE_DIR, CATEGORIES_DIR, PAGES_DIR};
use crate::searchtext::{Place, Seg, category_segs, fold, fold_map, page_segs, parse_query, word_matches};
use crate::wikilinks::norm;

const CACHE_FILE: &str = "search-index.json";
const CACHE_VERSION: u32 = 1;
const CACHE_SAVE_INTERVAL: Duration = Duration::from_secs(10);
/// Places listed per result (the rest are counted).
const PLACES_SHOWN: usize = 3;
/// Snippet length around the first match, in bytes (about characters).
const SNIPPET_BEFORE: usize = 50;
const SNIPPET_LEN: usize = 180;

/// A segment ready for matching: its text folded, ranges moved into the folded text.
#[derive(Debug, Default, Clone)]
struct Prep {
    norm: String,
    spoilers: Vec<(u32, u32)>,
    links: Vec<(u32, u32, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Doc {
    mtime: u64,
    size: u64,
    segs: Vec<Seg>,
    #[serde(skip)]
    prep: Vec<Prep>,
}

/// The folded offset of text offset `at` (`map` from [`fold_map`]).
fn to_norm(map: &[(u32, u32)], at: u32) -> u32 {
    match map.binary_search_by_key(&at, |m| m.0) {
        Ok(i) => map[i].1,
        Err(i) => map.get(i).map_or(map.last().map_or(0, |m| m.1), |m| m.1),
    }
}

/// The text offset of folded offset `at`: the first character starting at or after it.
fn to_text(map: &[(u32, u32)], at: u32) -> u32 {
    let i = map.partition_point(|m| m.1 < at);
    map.get(i).map_or(map.last().map_or(0, |m| m.0), |m| m.0)
}

fn prepare(seg: &Seg) -> Prep {
    let (norm, map) = fold_map(&seg.text);
    Prep {
        spoilers: seg.spoilers.iter().map(|&(a, b)| (to_norm(&map, a), to_norm(&map, b))).collect(),
        links: seg.links.iter().map(|(a, b, t)| (to_norm(&map, *a), to_norm(&map, *b), fold(t))).collect(),
        norm,
    }
}

impl Doc {
    fn new(mtime: u64, size: u64, segs: Vec<Seg>) -> Self {
        let mut d = Doc { mtime, size, segs, prep: Vec::new() };
        d.prepare();
        d
    }

    fn prepare(&mut self) {
        self.prep = self.segs.iter().map(prepare).collect();
    }
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    docs: HashMap<String, Doc>,
}

/// A file search reads, as the link index knows it.
pub struct Source {
    /// "p:<page id>" or "c:<category file name>".
    key: String,
    path: PathBuf,
    mtime: u64,
    size: u64,
    title: String,
    page: Option<PageMeta>,
}

struct PageMeta {
    id: String,
    template: Option<String>,
    /// Categories, compared with [`norm`].
    categories: Vec<String>,
}

/// Every page and category file of the project in `idx`.
pub fn sources(idx: &ProjectIndex) -> Vec<Source> {
    let pages = idx.dir.join(PAGES_DIR);
    let cats = idx.dir.join(CATEGORIES_DIR);
    let mut out: Vec<Source> = idx
        .pages
        .iter()
        .map(|(id, e)| Source {
            key: format!("p:{id}"),
            path: join_rel(&pages, id),
            mtime: e.mtime,
            size: e.size,
            title: e.title.clone(),
            page: Some(PageMeta {
                id: id.clone(),
                template: e.template.clone(),
                categories: e.categories.iter().map(|c| norm(c)).collect(),
            }),
        })
        .collect();
    out.extend(idx.cats.iter().map(|(file, e)| Source {
        key: format!("c:{file}"),
        path: cats.join(file),
        mtime: e.mtime,
        size: e.size,
        title: e.title.clone(),
        page: None,
    }));
    out
}

/// Runs `f` on every item using several threads (reading many files).
fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    if items.len() < 64 || threads < 2 {
        return items.iter().map(&f).collect();
    }
    let chunk = items.len().div_ceil(threads);
    let f = &f;
    std::thread::scope(|s| {
        let handles: Vec<_> = items.chunks(chunk).map(|part| s.spawn(move || part.iter().map(f).collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

fn read_doc(s: &Source) -> Option<Doc> {
    let text = fs::read_to_string(&s.path).ok()?;
    let segs = match &s.page {
        Some(p) => page_segs(&text, rel_name(&p.id)),
        None => category_segs(&text),
    };
    Some(Doc::new(s.mtime, s.size, segs))
}

/// What a search asks for.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub query: String,
    /// The global eye switch: spoiler text is searched (and shown) only when on.
    #[serde(default)]
    pub spoilers: bool,
    /// Only pages in this group or its subgroups.
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// Template id.
    #[serde(default)]
    pub template: Option<String>,
    /// How many results to return in full (the rest are only counted).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// A piece of a snippet. A hidden spoiler comes without its text.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Part {
    pub text: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hit: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub spoiler: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceHit {
    /// "Infobox: Born", "Section: Early life", "Text", "Alias"…
    pub place: String,
    pub parts: Vec<Part>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// "page" or "category".
    pub kind: &'static str,
    /// Page id, or category name.
    pub id: String,
    pub title: String,
    pub group: String,
    /// Matches on the page.
    pub count: usize,
    /// Where the matches are (the title is left out: it's shown anyway).
    pub places: Vec<PlaceHit>,
    pub more_places: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub hits: Vec<Hit>,
    /// All matching pages (more than `hits` when cut at the limit).
    pub total: usize,
    /// The query's words as matched (folded).
    pub terms: Vec<String>,
}

fn overlaps(ranges: &[(u32, u32)], a: u32, b: u32) -> bool {
    ranges.iter().any(|&(s, e)| s < b && a < e)
}

/// Matches of `term` in one segment (folded ranges), added to `out`.
fn seg_hits(seg: &Seg, p: &Prep, term: &str, spoilers: bool, out: &mut Vec<(u32, u32)>) {
    if seg.hidden && !spoilers {
        return;
    }
    let first = out.len();
    for at in word_matches(&p.norm, term) {
        let (a, b) = (at as u32, (at + term.len()) as u32);
        if spoilers || !overlaps(&p.spoilers, a, b) {
            out.push((a, b));
        }
    }
    // A link also matches by the page it points to (its shown text is marked).
    for (a, b, target) in &p.links {
        if word_matches(target, term).next().is_none() || (!spoilers && overlaps(&p.spoilers, *a, *b)) {
            continue;
        }
        if !out[first..].iter().any(|&(s, e)| s >= *a && e <= *b) {
            out.push((*a, *b));
        }
    }
}

/// Matches per segment, or None if a word isn't on the page.
fn doc_hits(doc: &Doc, terms: &[String], spoilers: bool) -> Option<Vec<Vec<(u32, u32)>>> {
    let mut per_seg = vec![Vec::new(); doc.segs.len()];
    for term in terms {
        let mut found = false;
        for (i, (seg, p)) in doc.segs.iter().zip(&doc.prep).enumerate() {
            let before = per_seg[i].len();
            seg_hits(seg, p, term, spoilers, &mut per_seg[i]);
            found |= per_seg[i].len() > before;
        }
        if !found {
            return None;
        }
    }
    Some(per_seg)
}

fn char_floor(s: &str, mut i: usize) -> usize {
    i = i.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// A short piece of the segment around its first match, matches marked.
fn snippet(seg: &Seg, hits: &[(u32, u32)], spoilers: bool) -> Vec<Part> {
    let (_, map) = fold_map(&seg.text);
    let text = &seg.text;
    let mut hits: Vec<(usize, usize)> =
        hits.iter().map(|&(a, b)| (to_text(&map, a) as usize, to_text(&map, b) as usize)).collect();
    hits.sort_unstable();
    let first = hits.first().copied().unwrap_or((0, 0));
    // Start a little before the first match, at a word; end at a word.
    let mut start = char_floor(text, first.0.saturating_sub(SNIPPET_BEFORE));
    if start > 0 {
        start = text[start..first.0].find(' ').map_or(start, |k| start + k + 1);
    }
    let mut end = char_floor(text, (start + SNIPPET_LEN).max(first.1));
    if end < text.len() {
        end = text[first.1..end].rfind(' ').map_or(end, |k| first.1 + k);
    }
    let spoiler_ranges: Vec<(usize, usize)> = if seg.hidden {
        vec![(0, text.len())]
    } else {
        seg.spoilers.iter().map(|&(a, b)| (a as usize, b as usize)).collect()
    };
    let mut cuts: Vec<usize> = vec![start, end];
    for &(a, b) in hits.iter().chain(&spoiler_ranges) {
        cuts.extend([a, b].into_iter().filter(|&x| x > start && x < end));
    }
    cuts.sort_unstable();
    cuts.dedup();
    let mut parts: Vec<Part> = Vec::new();
    if start > 0 {
        parts.push(Part { text: "\u{2026}".into(), hit: false, spoiler: false });
    }
    for w in cuts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let hit = hits.iter().any(|&(s, e)| s <= a && b <= e);
        let spoiler = spoiler_ranges.iter().any(|&(s, e)| s <= a && b <= e);
        let piece = if spoiler && !spoilers { String::new() } else { text[a..b].to_string() };
        match parts.last_mut() {
            // A hidden spoiler shows as one block, however many pieces it had.
            Some(last) if spoiler && !spoilers && last.spoiler && last.text.is_empty() => {}
            Some(last) if last.hit == hit && last.spoiler == spoiler && !(spoiler && !spoilers) => last.text.push_str(&piece),
            _ => parts.push(Part { text: piece, hit: hit && !(spoiler && !spoilers), spoiler }),
        }
    }
    if end < text.len() {
        parts.push(Part { text: "\u{2026}".into(), hit: false, spoiler: false });
    }
    parts
}

/// Natural order: case ignored, digit runs compared as numbers.
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (fold(a), fold(b));
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (n, m) = (take(&mut x), take(&mut y));
                let (n, m) = (n.trim_start_matches('0'), m.trim_start_matches('0'));
                let o = n.len().cmp(&m.len()).then_with(|| n.cmp(m));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(c), Some(d)) => {
                if c != d {
                    return c.cmp(&d);
                }
                x.next();
                y.next();
            }
        }
    }
}

pub struct SearchIndex {
    pub dir: PathBuf,
    docs: HashMap<String, Doc>,
    unsaved: usize,
    saved_at: Instant,
}

impl SearchIndex {
    /// The cached search index of the project in `dir` (or an empty one).
    pub fn open(dir: &Path) -> Self {
        let mut docs = fs::read(dir.join(CACHE_DIR).join(CACHE_FILE))
            .ok()
            .and_then(|t| serde_json::from_slice::<CacheFile>(&t).ok())
            .filter(|c| c.version == CACHE_VERSION)
            .map(|c| c.docs)
            .unwrap_or_default();
        let mut list: Vec<&mut Doc> = docs.values_mut().collect();
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
        let chunk = list.len().div_ceil(threads).max(1);
        std::thread::scope(|s| {
            for part in list.chunks_mut(chunk) {
                s.spawn(move || part.iter_mut().for_each(|d| d.prepare()));
            }
        });
        SearchIndex { dir: dir.to_path_buf(), docs, unsaved: 0, saved_at: Instant::now() }
    }

    /// Re-reads the files that changed since they were read (by time and
    /// size) and forgets the ones that are gone.
    pub fn sync(&mut self, sources: &[Source]) {
        let keep: HashSet<&str> = sources.iter().map(|s| s.key.as_str()).collect();
        let before = self.docs.len();
        self.docs.retain(|k, _| keep.contains(k.as_str()));
        let mut changed = before - self.docs.len();
        let stale: Vec<&Source> = sources
            .iter()
            .filter(|s| self.docs.get(&s.key).is_none_or(|d| d.mtime != s.mtime || d.size != s.size))
            .collect();
        for (s, doc) in stale.iter().zip(par_map(&stale, |s| read_doc(s))) {
            changed += 1;
            match doc {
                Some(d) => self.docs.insert(s.key.clone(), d),
                None => self.docs.remove(&s.key),
            };
        }
        self.unsaved += changed;
    }

    /// Writes the cache file if it's worth it now (or always with `now`).
    pub fn save_cache(&mut self, now: bool) {
        if self.unsaved == 0 || (!now && self.unsaved < 50 && self.saved_at.elapsed() < CACHE_SAVE_INTERVAL) {
            return;
        }
        let dir = self.dir.join(CACHE_DIR);
        let _ = fs::create_dir_all(&dir);
        #[derive(Serialize)]
        struct Out<'a> {
            version: u32,
            docs: &'a HashMap<String, Doc>,
        }
        if let Ok(json) = serde_json::to_vec(&Out { version: CACHE_VERSION, docs: &self.docs }) {
            if safe_write(&dir.join(CACHE_FILE), &json).is_ok() {
                self.unsaved = 0;
                self.saved_at = Instant::now();
            }
        }
    }

    /// Pages (and category texts) matching `req`, best first.
    pub fn search(&self, sources: &[Source], req: &Request) -> Results {
        let terms = parse_query(&req.query);
        if terms.is_empty() {
            return Results { hits: Vec::new(), total: 0, terms };
        }
        let filtered = req.group.is_some() || req.category.is_some() || req.template.is_some();
        let group = req.group.as_deref().filter(|g| !g.is_empty());
        let category = req.category.as_deref().map(norm);
        let wanted = |s: &Source| match &s.page {
            None => !filtered,
            Some(p) => {
                group.is_none_or(|g| rel_parent(&p.id) == g || p.id.starts_with(&format!("{g}/")))
                    && category.as_ref().is_none_or(|c| p.categories.contains(c))
                    && req.template.as_ref().is_none_or(|t| p.template.as_ref() == Some(t))
            }
        };
        let candidates: Vec<&Source> = sources.iter().filter(|s| wanted(s)).collect();
        let found: Vec<Option<(&Source, Vec<Vec<(u32, u32)>>)>> = par_map(&candidates, |s| {
            let doc = self.docs.get(&s.key)?;
            doc_hits(doc, &terms, req.spoilers).map(|h| (*s, h))
        });
        let mut found: Vec<(&Source, Vec<Vec<(u32, u32)>>, u8, usize)> = found
            .into_iter()
            .flatten()
            .map(|(s, h)| {
                let doc = &self.docs[&s.key];
                let rank = doc.segs.iter().zip(&h).filter(|(_, x)| !x.is_empty()).map(|(g, _)| g.place.rank()).min().unwrap_or(9);
                let count = h.iter().map(Vec::len).sum();
                (s, h, rank, count)
            })
            .collect();
        found.sort_by(|a, b| a.2.cmp(&b.2).then(b.3.cmp(&a.3)).then_with(|| natural_cmp(&a.0.title, &b.0.title)));
        let total = found.len();
        let hits = found
            .into_iter()
            .take(req.limit.unwrap_or(100))
            .map(|(s, h, _, count)| {
                let doc = &self.docs[&s.key];
                let mut places: Vec<PlaceHit> = doc
                    .segs
                    .iter()
                    .zip(&h)
                    .filter(|(seg, x)| !x.is_empty() && seg.place != Place::Title)
                    .map(|(seg, x)| PlaceHit { place: seg.place.label(req.spoilers), parts: snippet(seg, x, req.spoilers), count: x.len() })
                    .collect();
                let more_places = places.len().saturating_sub(PLACES_SHOWN);
                places.truncate(PLACES_SHOWN);
                match &s.page {
                    Some(p) => Hit {
                        kind: "page",
                        id: p.id.clone(),
                        title: s.title.clone(),
                        group: rel_parent(&p.id).to_string(),
                        count,
                        places,
                        more_places,
                    },
                    None => Hit { kind: "category", id: s.title.clone(), title: s.title.clone(), group: String::new(), count, places, more_places },
                }
            })
            .collect();
        Results { hits, total, terms }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::File::create(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    fn project() -> (tempfile::TempDir, ProjectIndex) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("P");
        write(&dir, "project.json", r#"{"name":"P","formatVersion":1}"#);
        write(&dir, "pages/Page A.md", "---\ntitle: Page A\naliases: [Alias Targ]\n---\nThe Targaryens met [[Page B|someone]].\n\n## Later\n\nA ||secret Targ|| here.\n");
        write(&dir, "pages/Group A/Page B.md", "---\ntitle: Page B\ncategories: [Cat A]\ninfobox:\n  template: t-1\n  fields:\n  - label: Born\n    type: date\n    value: { year: 250 }\n  - label: Hidden\n    type: text\n    value: Targ hidden field\n    spoiler: true\n---\nNothing about it. Snow falls.\n");
        write(&dir, "pages/Targaryen.md", "Plain page without front matter, aryen.\n");
        write(&dir, "categories/Cat A.md", "---\nparents: []\n---\nCategory words about Targ.\n");
        let idx = ProjectIndex::open(&dir).unwrap();
        (tmp, idx)
    }

    fn run(idx: &ProjectIndex, req: Request) -> Results {
        let sources = sources(idx);
        let mut s = SearchIndex::open(&idx.dir);
        s.sync(&sources);
        s.search(&sources, &req)
    }

    fn titles(r: &Results) -> Vec<String> {
        r.hits.iter().map(|h| h.title.clone()).collect()
    }

    fn q(query: &str) -> Request {
        Request { query: query.into(), ..Default::default() }
    }

    #[test]
    fn word_starts_ranking_and_places() {
        let (_t, idx) = project();
        let r = run(&idx, q("targ"));
        // Title match first, then the alias, then text and category text.
        assert_eq!(titles(&r), vec!["Targaryen", "Page A", "Cat A"]);
        assert_eq!(r.hits[1].places.iter().map(|p| p.place.as_str()).collect::<Vec<_>>(), vec!["Alias", "Text"]);
        let text = &r.hits[1].places[1];
        assert_eq!(text.parts.iter().filter(|p| p.hit).map(|p| p.text.as_str()).collect::<Vec<_>>(), vec!["Targ"]);
        assert_eq!(r.hits[2].kind, "category");
        assert!(run(&idx, q("aryen")).hits.iter().all(|h| h.title == "Targaryen"));
        assert_eq!(titles(&run(&idx, q("ARYEN"))), vec!["Targaryen"]);
    }

    #[test]
    fn all_words_phrases_links_and_values() {
        let (_t, idx) = project();
        assert_eq!(titles(&run(&idx, q("snow nothing"))), vec!["Page B"]);
        assert!(run(&idx, q("snow targ")).hits.is_empty());
        assert_eq!(titles(&run(&idx, q("\"snow falls\""))), vec!["Page B"]);
        assert!(run(&idx, q("\"falls snow\"")).hits.is_empty());
        // A link matches by its target; the shown text is marked.
        let r = run(&idx, q("\"page b\" met"));
        assert_eq!(titles(&r), vec!["Page A"]);
        let parts = &r.hits[0].places[0].parts;
        assert!(parts.iter().any(|p| p.hit && p.text == "someone"));
        // Infobox values as shown.
        let r = run(&idx, q("250"));
        assert_eq!(r.hits[0].places[0].place, "Infobox: Born");
    }

    #[test]
    fn spoilers_follow_the_switch() {
        let (_t, idx) = project();
        // Off: "secret" is only in a spoiler, so nothing; the field spoiler neither.
        assert!(run(&idx, q("secret")).hits.is_empty());
        assert!(run(&idx, q("hidden field")).hits.is_empty());
        let on = |s: &str| Request { query: s.into(), spoilers: true, ..Default::default() };
        let r = run(&idx, on("secret"));
        assert_eq!(titles(&r), vec!["Page A"]);
        assert!(r.hits[0].places[0].parts.iter().any(|p| p.hit && p.spoiler));
        assert_eq!(titles(&run(&idx, on("hidden field"))), vec!["Page B"]);
        // Off, a snippet around a match leaves the spoiler's text out.
        let r = run(&idx, q("here"));
        let parts = &r.hits[0].places[0].parts;
        assert!(parts.iter().any(|p| p.spoiler && p.text.is_empty()));
        assert!(!parts.iter().any(|p| p.text.contains("secret")));
    }

    #[test]
    fn filters() {
        let (_t, idx) = project();
        let f = |group: Option<&str>, category: Option<&str>, template: Option<&str>| Request {
            query: "page".into(),
            group: group.map(Into::into),
            category: category.map(Into::into),
            template: template.map(Into::into),
            ..Default::default()
        };
        assert_eq!(titles(&run(&idx, f(Some("Group A"), None, None))), vec!["Page B"]);
        assert_eq!(titles(&run(&idx, f(None, Some("cat a"), None))), vec!["Page B"]);
        assert_eq!(titles(&run(&idx, f(None, None, Some("t-1")))), vec!["Page B"]);
        assert!(run(&idx, f(None, None, Some("t-2"))).hits.is_empty());
    }

    #[test]
    fn cache_follows_changes() {
        let (_t, mut idx) = project();
        let mut s = SearchIndex::open(&idx.dir);
        s.sync(&sources(&idx));
        s.save_cache(true);
        write(&idx.dir, "pages/Page C.md", "Brand new words.\n");
        fs::remove_file(idx.dir.join("pages/Targaryen.md")).unwrap();
        idx.refresh(&[]).unwrap();
        let mut s = SearchIndex::open(&idx.dir);
        assert_eq!(s.docs.len(), 4);
        let src = sources(&idx);
        s.sync(&src);
        assert_eq!(titles(&s.search(&src, &q("brand"))), vec!["Page C"]);
        assert!(s.search(&src, &q("aryen")).hits.is_empty());
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("Page 2", "page 10"), Ordering::Less);
        assert_eq!(natural_cmp("Éa", "eb"), Ordering::Less);
    }

    /// Speed on 5,000 generated pages (run with `cargo test --release -- --ignored speed --nocapture`).
    #[test]
    #[ignore]
    fn speed() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("P");
        write(&dir, "project.json", r#"{"name":"P","formatVersion":1}"#);
        let words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "theta", "kappa", "lambda", "omega"];
        for i in 0..5000 {
            let mut body = String::new();
            for s in 0..6 {
                body.push_str(&format!("## Section {s}\n\n"));
                for k in 0..8 {
                    let w = words[(i * 7 + s * 3 + k) % words.len()];
                    body.push_str(&format!("Line {k} of page {i} with {w} words, a [[Page {}|link]] and ||hidden {w}||.\n", (i + k) % 5000));
                }
            }
            write(&dir, &format!("pages/Group {}/Page {i}.md", i % 20), &format!("---\ntitle: Page {i}\ninfobox:\n  fields:\n  - label: Born\n    type: date\n    value: {{ year: {i} }}\n  - label: Note\n    type: text\n    value: Something about {}\n---\n{body}", words[i % 10]));
        }
        let t = Instant::now();
        let idx = ProjectIndex::open(&dir).unwrap();
        println!("link index, first open: {:?}", t.elapsed());
        drop(idx);
        let t = Instant::now();
        let idx = ProjectIndex::open(&dir).unwrap();
        let _ = crate::conflicts::list(tmp.path(), &idx);
        println!("reopen (cached) with conflict check: {:?}", t.elapsed());
        let src = sources(&idx);
        let t = Instant::now();
        let mut s = SearchIndex::open(&idx.dir);
        s.sync(&src);
        println!("build: {:?}", t.elapsed());
        let t = Instant::now();
        s.save_cache(true);
        println!("save: {:?}", t.elapsed());
        let t = Instant::now();
        let mut s = SearchIndex::open(&idx.dir);
        s.sync(&src);
        println!("reopen from cache: {:?}", t.elapsed());
        for query in ["a", "alp", "gamma words", "page 42", "\"of page 4\"", "zzz"] {
            let t = Instant::now();
            let r = s.search(&src, &Request { query: query.into(), ..Default::default() });
            println!("{query:?}: {} results in {:?}", r.total, t.elapsed());
        }
    }
}
