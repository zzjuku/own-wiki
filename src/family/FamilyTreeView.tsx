// The Family tree screen (M12): a tree centred on one person, read from the
// relations in infobox fields (Project settings → Family tree says which).
// Generations up and down and "Partners' parents" are remembered on this
// computer; Back returns to the same person and view.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { makeIndexStore } from "../indexStore";
import { IS_MAC } from "../QuickOpen";
import { matchesAll, parseQuery } from "../search";
import { compareNames } from "../tree";
import { useWiki } from "../wiki";
import { norm } from "../wikilinks";
import { Family, type FamilyData } from "./data";
import { layoutTree, type Metrics, sideBySide } from "./layout";
import { alignTrees, buildAllTrees, buildTree } from "./model";
import { MAX_GENERATIONS, useTreePrefs } from "./prefs";
import { hasPicture, measureText, type Selection, TEXT_H, TreeCanvas, type TreeFonts, type TreeHandle, type View, ZoomButtons } from "./TreeCanvas";
import { SelectionBar } from "./FamilyEditing";
import { treePng, treeSvg } from "./exportImage";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useReportError } from "../notify";
import { GearIcon } from "../SidebarHeader";

export const useFamilyData = makeIndexStore<FamilyData>((p, known) => api.familyData(p, known));

/** Pages with a parent, child or partner, per family data. */
const inFamilyCache = new WeakMap<FamilyData, Set<string>>();
/** The page has a parent, child or partner (its header then shows the Family tree button). */
export function useInFamily(project: string, pageId: string): boolean {
  const data = useFamilyData(project);
  if (!data) return false;
  let ids = inFamilyCache.get(data);
  if (!ids) {
    // (Relations hidden as spoilers don't count: the button mustn't give them away.)
    const open = <T extends { spoiler?: boolean }>(list: T[]) => list.filter((l) => !l.spoiler);
    const people = new Set<number>([...open(data.parents).flatMap((l) => [l.child, l.parent]), ...open(data.partners).flatMap((l) => [l.a, l.b])]);
    ids = new Set([...people].map((i) => data.people[i].id).filter((id): id is string => !!id));
    inFamilyCache.set(data, ids);
  }
  return ids.has(pageId);
}

export const FAMILY_KEYS = IS_MAC ? "⌘⌥T" : "Ctrl+Alt+T";

/** Cmd+Alt+T (Ctrl+Alt+T on Windows); Alt changes the letter on the Mac, so the key's place is checked. */
export function isFamilyKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyT";
}

/** The "person" of the All families view (as a centre and in the history: "family:*"). */
export const ALL_FAMILIES = "*";
/** One house's trees: "*house:" + the house name as compared. */
export const HOUSE_PREFIX = "*house:";
const houseKey = (name: string) => HOUSE_PREFIX + norm(name);

/** Where the view was, per project and person (kept while the app runs; Back returns there). */
const views = new Map<string, View>();

// Boxes with a picture: 150 × 170 picture, name and years below.
/** Space between the trees of All families. */
const ALL_GAP = 120;
const BOX = { boxW: 160, boxH: 62, cardH: 175 + TEXT_H, unknownW: 40, stubH: 26, gap: 22, coupleGap: 30, rowGap: 72 };

/** The tree's fonts, read from the theme. */
function treeFonts(): TreeFonts & { label: string; stub: string } {
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-tree").trim() || "sans-serif";
  return { name: `600 14px ${family}`, years: `12px ${family}`, label: `italic 11px ${family}`, stub: `12px ${family}` };
}

/** Box sizes and text measuring in the theme's tree font. */
export function useTreeMetrics(fam: Family | null) {
  const theme = useWiki().settings.theme;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fonts = useMemo(treeFonts, [theme]);
  const metrics = useMemo<Metrics>(
    () => ({
      ...BOX,
      measure: (text, kind) => measureText(text, kind === "label" ? fonts.label : fonts.stub),
      stubText: (b) => `↪ ${fam?.people[b.person!]?.title ?? ""}`,
      tall: (b) => !!fam && hasPicture(b, fam),
    }),
    [fonts, fam],
  );
  return { fonts, metrics };
}

/** The family data, with a page that has no relations yet added (so it can be shown alone). */
export function withPerson(data: FamilyData, id: string | null, title: string | undefined): FamilyData {
  if (!id || !title || data.people.some((p) => p.id === id)) return data;
  return { ...data, people: [...data.people, { id, title }] };
}

export function FamilyTreeView({
  centre,
  onCentre,
  openPage,
  revealAll,
  onOpenPage,
  onOpenSettings,
}: {
  /** Page id of the person in the middle (null: choose one). */
  centre: string | null;
  /** Another person was chosen (`record`: Back returns to the one before). */
  onCentre: (id: string, record: boolean) => void;
  /** The page that was open before (the tree starts on it if it's in a family). */
  openPage: string | null;
  revealAll: boolean;
  onOpenPage: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const wiki = useWiki();
  const report = useReportError();
  const project = wiki.project;
  const raw = useFamilyData(project);
  const [prefs, setPrefs] = useTreePrefs(project);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection | null>(null);
  const handle = useRef<TreeHandle>(null);

  const houseName = centre?.startsWith(HOUSE_PREFIX) ? centre.slice(HOUSE_PREFIX.length) : null;
  const all = centre === ALL_FAMILIES || houseName !== null;
  const title = useMemo(() => (centre && !centre.startsWith("*") ? wiki.names.entries.find((e) => e.page.id === centre)?.page.title : undefined), [wiki.names, centre]);
  const data = useMemo(() => (raw ? withPerson(raw, centre, title) : null), [raw, centre, title]);
  const fam = useMemo(() => (data ? new Family(data) : null), [data]);
  const nothingSet = !!raw && !raw.settings.parents.length && !raw.settings.partners.length;

  // Nothing chosen yet: the open page if it's in a family, else the last person.
  useEffect(() => {
    if (centre || !fam) return;
    const inFamily = (id: string | null) => id !== null && fam.byPage.has(id) && fam.inFamily(fam.byPage.get(id)!);
    const pick = inFamily(openPage) ? openPage : inFamily(prefs.last) || prefs.last?.startsWith("*") ? prefs.last : null;
    if (pick) onCentre(pick, false);
  }, [centre, fam, openPage, prefs.last, onCentre]);
  useEffect(() => {
    if (centre && centre !== prefs.last) setPrefs({ last: centre });
  }, [centre, prefs.last, setPrefs]);

  // No family fields set: say so and open the settings (once).
  const askedSettings = useRef(false);
  useEffect(() => {
    if (nothingSet && !askedSettings.current) {
      askedSettings.current = true;
      onOpenSettings();
    }
  }, [nothingSet, onOpenSettings]);

  const { fonts, metrics } = useTreeMetrics(fam);
  const centreIndex = centre && fam ? fam.byPage.get(centre) : undefined;
  const layout = useMemo(() => {
    if (!fam) return null;
    const opts = { ...prefs, revealAll, revealed };
    if (all) {
      // Side by side, one row height for all, generations lined up.
      const house = houseName === null ? undefined : fam.houses.findIndex((h) => norm(h) === houseName);
      if (house === -1) return null;
      const trees = buildAllTrees(fam, opts, house);
      const rowH = trees.some((t) => t.boxes.some(metrics.tall)) ? metrics.cardH : metrics.boxH;
      const shifts = alignTrees(fam, trees, revealAll);
      return sideBySide(trees.map((t, i) => ({ layout: layoutTree(t, metrics, rowH), shift: shifts[i] * (rowH + metrics.rowGap) })), ALL_GAP);
    }
    if (centreIndex === undefined) return null;
    return layoutTree(buildTree(fam, centreIndex, opts), metrics);
  }, [fam, all, houseName, centreIndex, prefs, revealAll, revealed, metrics]);

  // A new person in the middle: their remembered view, else the whole tree (or them, if it's big).
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!layout || !centre || shownFor.current === centre) return;
    shownFor.current = centre;
    setRevealed(new Set());
    const saved = views.get(`${project}\n${centre}`);
    const h = handle.current;
    if (!h) return;
    if (saved) return h.setView(saved);
    h.fit();
    const first = all ? layout.boxes[0]?.key : `n${centreIndex}`;
    if (h.getView().k < 0.45 && first) h.centreOn(first, false);
  }, [layout, centre, centreIndex, project, all]);
  useEffect(() => {
    const key = `${project}\n${centre}`;
    return () => {
      const v = handle.current?.getView();
      if (v && centre) views.set(key, v);
    };
  }, [project, centre]);

  // A selection that's gone from the tree (after an edit, another person) lets go.
  useEffect(() => {
    if (!selected || !layout) return;
    const gone = selected.kind === "box" ? !layout.boxes.some((b) => b.key === selected.key) : !layout.lines[selected.index]?.select;
    if (gone) setSelected(null);
  }, [layout, selected]);
  useEffect(() => setSelected(null), [centre]);
  useEffect(() => {
    if (!selected) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".backdrop") && setSelected(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected]);

  /** A placeholder's page (the template of a page linking to them suggested). */
  const createPage = (i: number) => fam && wiki.createFromLink(fam.people[i].title, relatedPage(fam, i), { stay: true });

  /** New person…: creates a page and shows their tree (a family can grow from there). */
  const newPerson = () =>
    wiki.createFromLink("", undefined, {
      stay: true,
      heading: "New person",
      note: "Creates a page and shows it here; then add parents, children and partners.",
      template: centreIndex !== undefined ? fam?.people[centreIndex].template : undefined,
      onCreated: (p) => onCentre(p.id, true),
    });

  /** Save as image: the whole tree as PNG or SVG, to a file chosen here. */
  async function saveImage() {
    const svg = handle.current?.svg();
    if (!layout || !svg) return;
    setSelected(null);
    const name = houseName !== null ? (fam?.houses.find((h) => norm(h) === houseName) ?? "House") : all ? "All families" : (title ?? "Family tree");
    const path = await saveDialog({
      title: "Save the family tree as an image",
      defaultPath: `${name.replace(/[\\/:*?"<>|]/g, "-")} family tree.png`,
      filters: [
        { name: "PNG picture", extensions: ["png"] },
        { name: "SVG drawing (sharp at any size)", extensions: ["svg"] },
      ],
    }).catch(() => null);
    if (!path) return;
    // (A frame later: the selection is gone from the drawing.)
    await new Promise(requestAnimationFrame);
    try {
      const svgFile = /\.svg$/i.test(path);
      const file = /\.(png|svg)$/i.test(path) ? path : `${path}.png`;
      const bytes = svgFile ? new TextEncoder().encode(await treeSvg(svg, layout)) : await treePng(svg, layout);
      await api.saveImageFile(file, bytes);
    } catch (e) {
      report(e);
    }
  }

  // Test hook (not in the built app).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __familyTree?: unknown }).__familyTree = { layout, handle: handle.current };
  }, [layout]);

  const count = layout ? layout.boxes.filter((b) => b.box.kind === "person" || b.box.kind === "placeholder").length : 0;
  const setGen = (which: "up" | "down", v: number) => setPrefs({ [which]: Math.max(0, Math.min(MAX_GENERATIONS, Math.round(v) || 0)) });

  return (
    <div className="page family-view">
      <header className="page-head family-head">
        <div className="page-titles">
          <h1>Family tree</h1>
        </div>
        {fam && !nothingSet && <PersonPicker fam={fam} current={centre} onPick={(id) => onCentre(id, true)} />}
        <div className="spacer" />
        {layout && <span className="muted small family-count">{count === 1 ? "1 person" : `${count.toLocaleString("en")} people`}</span>}
        <label className="family-gen" title="Generations shown above the person">
          <span>Up</span>
          <input type="number" min={0} max={MAX_GENERATIONS} value={prefs.up} aria-label="Generations up" disabled={all} onChange={(e) => setGen("up", +e.target.value)} />
        </label>
        <label className="family-gen" title="Generations shown below the person">
          <span>Down</span>
          <input type="number" min={0} max={MAX_GENERATIONS} value={prefs.down} aria-label="Generations down" disabled={all} onChange={(e) => setGen("down", +e.target.value)} />
        </label>
        <label className="check family-switch" title="Show the parents of people who married into the family">
          <input type="checkbox" disabled={all} checked={prefs.partnersParents} onChange={(e) => setPrefs({ partnersParents: e.target.checked })} />
          <span>Partners' parents</span>
        </label>
        <button title="Create a page for a person and show their tree" disabled={nothingSet} onClick={newPerson}>
          New person…
        </button>
        <button title="Save the whole tree as a PNG picture or SVG drawing" disabled={!layout} onClick={() => void saveImage()}>
          Save image…
        </button>
        <button className="plain nav" title="Family tree settings (Project settings)" aria-label="Family tree settings" onClick={onOpenSettings}>
          <GearIcon />
        </button>
      </header>
      <div className="family-body">
        {nothingSet ? (
          <div className="empty center family-empty">
            <p>No family fields are chosen yet.</p>
            <p className="muted small">
              Choose which Page link fields point to parents (e.g. Father, Mother) and partners (e.g. Spouse) under Project settings → Family tree.
            </p>
            <button className="primary" onClick={onOpenSettings}>
              Family tree settings…
            </button>
          </div>
        ) : layout && fam ? (
          <TreeCanvas
            handle={handle}
            layout={layout}
            fam={fam}
            project={project}
            centreKey={all ? "" : `n${centreIndex}`}
            spoilers={revealAll}
            fonts={fonts}
            label={houseName !== null ? `Family tree of a house` : all ? "All families" : `Family tree of ${fam.people[centreIndex!].title}`}
            onOpen={(i) => fam.people[i].id && onOpenPage(fam.people[i].id!)}
            onReveal={(keys) => setRevealed((r) => new Set([...r, ...keys]))}
            onCreate={createPage}
            selection={{ selected, onSelect: setSelected }}
          />
        ) : data && houseName !== null ? (
          <p className="empty center">Nobody in a family has this house any more.</p>
        ) : data ? (
          <p className="empty center">Choose a person above to see their family.</p>
        ) : null}
        {layout && (
          <div className="family-zoom">
            <ZoomButtons handle={handle} />
          </div>
        )}
        {selected && layout && fam && data && (
          <SelectionBar
            selection={selected}
            layout={layout}
            fam={fam}
            data={data}
            isCentre={(i) => !all && i === centreIndex}
            onClear={() => setSelected(null)}
            onOpen={onOpenPage}
            onCentre={(id) => onCentre(id, true)}
            onCreate={createPage}
          />
        )}
      </div>
    </div>
  );
}

/** A page linking to placeholder `i` (its template is suggested for the new page). */
export function relatedPage(fam: Family, i: number): string | undefined {
  const near = [...fam.parentsOf[i].map((l) => l.parent), ...fam.childrenOf[i].map((l) => l.child), ...fam.couplesOf[i].map((c) => c.other)];
  return near.map((n) => fam.people[n].id).find((id) => id);
}

const ALL_TITLE = "All families";

/** Choose the person in the middle: type to find anyone in a family (titles and aliases), or All families. */
function PersonPicker({ fam, current, onPick }: { fam: Family; current: string | null; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Closes on a press outside the picker (not on losing focus, which can come before the press on an option).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  const people = useMemo(
    () =>
      fam.people
        .filter((p, i) => p.id && fam.inFamily(i))
        .map((p) => ({ id: p.id!, title: p.title, names: [p.title, ...(p.aliases ?? [])] }))
        .sort((a, b) => compareNames(a.title, b.title)),
    [fam],
  );
  // Houses from the house field (Family tree settings).
  const houses = useMemo(
    () =>
      [...fam.houses].sort(compareNames).map((h) => ({ id: houseKey(h), title: h, names: [h], house: true })),
    [fam],
  );
  // "All families" first, the houses, then the people.
  const matches = useMemo(() => {
    const terms = parseQuery(query);
    const list: { id: string; title: string; names: string[]; house?: boolean }[] = [{ id: ALL_FAMILIES, title: ALL_TITLE, names: [ALL_TITLE] }, ...houses, ...people];
    return (terms.length ? list.filter((p) => p.names.some((n) => matchesAll(n, terms))) : list).slice(0, 51);
  }, [people, houses, query]);
  const currentTitle =
    current === ALL_FAMILIES
      ? ALL_TITLE
      : current?.startsWith(HOUSE_PREFIX)
        ? houses.find((h) => h.id === current)?.title
        : current
          ? fam.people[fam.byPage.get(current) ?? -1]?.title
          : undefined;
  const pick = (id: string) => {
    setOpen(false);
    setQuery("");
    onPick(id);
  };
  return (
    <div className="family-picker" ref={root}>
      <input
        type="search"
        value={open ? query : (currentTitle ?? "")}
        placeholder="Choose a person…"
        aria-label="Person in the middle"
        spellCheck={false}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && matches[active]) pick(matches[active].id);
          else if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Tab") return setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && (
        <ul className="family-picker-list" role="listbox">
          {matches.map((p, n) => (
            <li
              key={p.id}
              role="option"
              aria-selected={n === active}
              className={`${n === active ? "active" : ""} ${p.id === ALL_FAMILIES ? "family-all" : ""} ${p.house ? "family-house" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p.id)}
            >
              {p.title}
              {p.house && <span className="family-house-tag">house</span>}
            </li>
          ))}
          {!matches.length && <li className="muted">Nobody found</li>}
        </ul>
      )}
    </div>
  );
}
