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
import { Family, type FamilyData } from "./data";
import { layoutTree, type Metrics } from "./layout";
import { buildTree } from "./model";
import { MAX_GENERATIONS, useTreePrefs } from "./prefs";
import { measureText, TreeCanvas, type TreeFonts, type TreeHandle, type View } from "./TreeCanvas";

export const useFamilyData = makeIndexStore<FamilyData>((p, known) => api.familyData(p, known));

export const FAMILY_KEYS = IS_MAC ? "⌘⌥T" : "Ctrl+Alt+T";

/** Cmd+Alt+T (Ctrl+Alt+T on Windows); Alt changes the letter on the Mac, so the key's place is checked. */
export function isFamilyKey(e: KeyboardEvent): boolean {
  return (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyT";
}

/** Where the view was, per project and person (kept while the app runs; Back returns there). */
const views = new Map<string, View>();

const BOX = { boxW: 180, boxH: 62, unknownW: 40, stubH: 26, gap: 22, coupleGap: 30, rowGap: 72 };

/** The tree's fonts, read from the theme. */
function treeFonts(): TreeFonts & { label: string; stub: string } {
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-tree").trim() || "sans-serif";
  return { name: `600 14px ${family}`, years: `12px ${family}`, label: `italic 11px ${family}`, stub: `12px ${family}` };
}

/** The family data, with a page that has no relations yet added (so it can be shown alone). */
function withPerson(data: FamilyData, id: string | null, title: string | undefined): FamilyData {
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
  const project = wiki.project;
  const raw = useFamilyData(project);
  const [prefs, setPrefs] = useTreePrefs(project);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const handle = useRef<TreeHandle>(null);

  const title = useMemo(() => (centre ? wiki.names.entries.find((e) => e.page.id === centre)?.page.title : undefined), [wiki.names, centre]);
  const data = useMemo(() => (raw ? withPerson(raw, centre, title) : null), [raw, centre, title]);
  const fam = useMemo(() => (data ? new Family(data) : null), [data]);
  const nothingSet = !!raw && !raw.settings.parents.length && !raw.settings.partners.length;

  // Nothing chosen yet: the open page if it's in a family, else the last person.
  useEffect(() => {
    if (centre || !fam) return;
    const inFamily = (id: string | null) => id !== null && fam.byPage.has(id) && fam.inFamily(fam.byPage.get(id)!);
    const pick = inFamily(openPage) ? openPage : inFamily(prefs.last) ? prefs.last : null;
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

  const fonts = useMemo(treeFonts, [wiki.settings.theme]);
  const metrics = useMemo<Metrics>(
    () => ({
      ...BOX,
      measure: (text, kind) => measureText(text, kind === "label" ? fonts.label : fonts.stub),
      stubText: (b) => `↪ ${fam?.people[b.person!]?.title ?? ""}`,
    }),
    [fonts, fam],
  );
  const centreIndex = centre && fam ? fam.byPage.get(centre) : undefined;
  const layout = useMemo(() => {
    if (!fam || centreIndex === undefined) return null;
    const spec = buildTree(fam, centreIndex, { ...prefs, revealAll, revealed });
    return layoutTree(spec, metrics);
  }, [fam, centreIndex, prefs, revealAll, revealed, metrics]);

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
    if (h.getView().k < 0.45) h.centreOn(`n${centreIndex}`, false);
  }, [layout, centre, centreIndex, project]);
  useEffect(() => {
    const key = `${project}\n${centre}`;
    return () => {
      const v = handle.current?.getView();
      if (v && centre) views.set(key, v);
    };
  }, [project, centre]);

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
          <input type="number" min={0} max={MAX_GENERATIONS} value={prefs.up} aria-label="Generations up" onChange={(e) => setGen("up", +e.target.value)} />
        </label>
        <label className="family-gen" title="Generations shown below the person">
          <span>Down</span>
          <input type="number" min={0} max={MAX_GENERATIONS} value={prefs.down} aria-label="Generations down" onChange={(e) => setGen("down", +e.target.value)} />
        </label>
        <label className="check family-switch" title="Show the parents of people who married into the family">
          <input type="checkbox" checked={prefs.partnersParents} onChange={(e) => setPrefs({ partnersParents: e.target.checked })} />
          <span>Partners' parents</span>
        </label>
        <div className="family-zoom">
          <button className="plain" title="Zoom out" aria-label="Zoom out" disabled={!layout} onClick={() => handle.current?.zoom(1 / 1.25)}>
            −
          </button>
          <button className="plain" title="Zoom in" aria-label="Zoom in" disabled={!layout} onClick={() => handle.current?.zoom(1.25)}>
            +
          </button>
        </div>
        <button title="Show the whole tree" disabled={!layout} onClick={() => handle.current?.fit(true)}>
          Fit
        </button>
        <button title="Which fields make a family (Project settings)" onClick={onOpenSettings}>
          Settings…
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
            centreKey={`n${centreIndex}`}
            spoilers={revealAll}
            fonts={fonts}
            label={`Family tree of ${fam.people[centreIndex!].title}`}
            onOpen={(i) => fam.people[i].id && onOpenPage(fam.people[i].id!)}
            onReveal={(keys) => setRevealed((r) => new Set([...r, ...keys]))}
            onCreate={(i) => wiki.createFromLink(fam.people[i].title, relatedPage(fam, i), { stay: true })}
          />
        ) : data ? (
          <p className="empty center">Choose a person above to see their family.</p>
        ) : null}
      </div>
    </div>
  );
}

/** A page linking to placeholder `i` (its template is suggested for the new page). */
function relatedPage(fam: Family, i: number): string | undefined {
  const near = [...fam.parentsOf[i].map((l) => l.parent), ...fam.childrenOf[i].map((l) => l.child), ...fam.couplesOf[i].map((c) => c.other)];
  return near.map((n) => fam.people[n].id).find((id) => id);
}

/** Choose the person in the middle: type to find anyone in a family (titles and aliases). */
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
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => p.id && fam.inFamily(i))
        .sort((a, b) => compareNames(a.p.title, b.p.title)),
    [fam],
  );
  const matches = useMemo(() => {
    const terms = parseQuery(query);
    const list = terms.length ? people.filter(({ p }) => [p.title, ...(p.aliases ?? [])].some((n) => matchesAll(n, terms))) : people;
    return list.slice(0, 50);
  }, [people, query]);
  const currentTitle = current ? fam.people[fam.byPage.get(current) ?? -1]?.title : undefined;
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
          else if (e.key === "Enter" && matches[active]) pick(matches[active].p.id!);
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
          {matches.map(({ p }, n) => (
            <li
              key={p.id}
              role="option"
              aria-selected={n === active}
              className={n === active ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p.id!)}
            >
              {p.title}
            </li>
          ))}
          {!matches.length && <li className="muted">Nobody found</li>}
        </ul>
      )}
    </div>
  );
}
