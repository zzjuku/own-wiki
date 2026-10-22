import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isChanged, type CategoryInfo, type Conflict, type FilesChanged, type Frame, type ProjectInfo, type ProjectSettings, type Tree } from "./api";
import { CategoryIndex } from "./categories";
import { CategoriesList, CategoryView } from "./CategoryView";
import { flushAll } from "./autosave";
import { useDialogs } from "./dialogs";
import { HoverCards } from "./HoverCard";
import { ImageViewer } from "./ImageViewer";
import { NameIndex } from "./names";
import { useReportError } from "./notify";
import { PageView, type Arrival } from "./PageView";
import { catKey, FAMILY_KEY, GRAPH_KEY, HISTORY_LIMIT, keyCategory, keyFamily, keySearch, SEARCH_KEY, type History } from "./history";
import { FamilyTreeView } from "./family/FamilyTreeView";
import { renameFieldInFamily } from "./family/settings";
import { GraphView } from "./graph/GraphView";
import { useProjectKeys } from "./projectKeys";
import { LocalGraph } from "./graph/LocalGraph";
import { useLocalPrefs } from "./graph/prefs";
import { usePageActions } from "./pageActions";
import { ConflictsView } from "./ConflictsView";
import { useProjectSync } from "./projectSync";
import { useExpanded } from "./expanded";
import { norm } from "./wikilinks";
import { NO_SEARCH, SearchView, type SearchState } from "./SearchView";
import { IS_MAC, QuickOpen } from "./QuickOpen";
import { DEFAULT_FRAME, WikiContext, type CreateOptions, type FollowTarget, type Wiki } from "./wiki";
import { useGlobalReveal } from "./spoilers";
import { loadPageEdge, useSidebarHidden } from "./layoutPrefs";
import { Sidebar, type MenuItem } from "./Sidebar";
import { SidebarHeader, SidebarIcon } from "./SidebarHeader";
import { SidebarScreens, type Panel } from "./SidebarScreens";
import { TemplatesView, useTemplates } from "./TemplatesView";
import { ProjectSettingsDialog } from "./ProjectSettings";
import { RelationsView } from "./RelationsView";
import { useThemes } from "./themes/runtime";
import { ThemesView } from "./themes/ThemesView";
import {
  allGroupsInOrder,
  buildIndex,
  displayGroup,
  groupChain,
  parentOf,
  remapId,
  ROOT,
  visibleRows,
  type Row,
} from "./tree";

interface Props {
  project: ProjectInfo;
  onBack: () => void;
}


function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function ProjectView({ project, onBack }: Props) {
  const dialogs = useDialogs();
  const report = useReportError();
  const [tree, setTree] = useState<Tree | null>(null);
  const { expanded, setExpanded, toggle } = useExpanded(project.id);
  const [selected, setSelected] = useState<string | null>(null);
  // A clicked group (or ROOT after clicking the project name). null = follow
  // the open page: new pages then go into that page's group.
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const templates = useTemplates(project.id);
  const [categoryList, setCategoryList] = useState<CategoryInfo[]>([]);
  const categories = useMemo(() => new CategoryIndex(categoryList), [categoryList]);
  // A category page, or the list of all categories, shown instead of a page.
  const [category, setCategory] = useState<string | null>(null);
  const [categoryFind, setCategoryFind] = useState<{ query: string; key: number } | null>(null);
  // A screen shown instead of a page: the categories list, Templates, Themes, Relations or Search.
  const [panel, setPanel] = useState<Panel | null>(null);
  // The Search screen's query and filters (kept while other things are open).
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  // Bumped to put the focus into the Search screen's box.
  const [searchFocus, setSearchFocus] = useState(0);
  // "Open in Graph" from the local graph: the page the Graph screen opens centred on.
  const [graphFocus, setGraphFocus] = useState<{ id: string; key: number } | null>(null);
  const [localGraph] = useLocalPrefs();
  const [imageFrame, setImageFrameState] = useState<Frame>(DEFAULT_FRAME);
  const [settings, setSettings] = useState<ProjectSettings>({ hideCategoryBox: false });
  // Project settings open (`family`: scrolled to Family tree).
  const [settingsOpen, setSettingsOpen] = useState<false | "top" | "family">(false);
  // The Family tree screen's person in the middle (page id).
  const [familyCentre, setFamilyCentre] = useState<string | null>(null);
  // Show every spoiler everywhere (this computer only).
  const [revealAll, setRevealAll] = useGlobalReveal();
  // The sidebar can be hidden for more room (this computer only).
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  useEffect(() => {
    api.getImageFrame(project.id).then(setImageFrameState, () => {});
    api.getProjectSettings(project.id).then(setSettings, () => {});
  }, [project.id]);

  function changeSettings(next: ProjectSettings) {
    setSettings(next);
    api.setProjectSettings(project.id, next).catch((e) => {
      if (!isChanged(e)) return report(e);
      api.getProjectSettings(project.id).then(setSettings, () => {});
      report("The project settings were changed on another computer, so your change couldn't be saved. They show the newer settings now.");
    });
  }
  // The project's own theme (if any) shows while the project is open.
  const { setProject: setThemeProject, reload: reloadTheme } = useThemes();
  useEffect(() => {
    setThemeProject(project.id, settings.theme ?? null);
  }, [project.id, settings.theme, setThemeProject]);
  useEffect(() => () => setThemeProject(null, null), [setThemeProject]);
  const [templateSelected, setTemplateSelected] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [revealRow, setRevealRow] = useState<{ id: string } | null>(null);
  const [history, setHistory] = useState<History>({ back: [], forward: [] });
  // Bumped when the open page's file changed behind its back (rename rewrote its links).
  const [pageVersion, setPageVersion] = useState(0);
  // Bumped when the file watcher saw the open page's file change (M10).
  const [diskTick, setDiskTick] = useState(0);
  // The open page was deleted on disk: it stays open (with a bar) until Keep it or Close.
  const [deletedOpen, setDeletedOpen] = useState<string | null>(null);
  // Pages picked in the sidebar with ⌘/Ctrl-click or Shift-click, to move,
  // categorise or delete together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Where to scroll and what to say when a page was opened through a link (or a search result).
  const [arrival, setArrival] = useState<Arrival>({ section: null, via: null, key: 0 });

  const index = useMemo(() => buildIndex(tree ?? { groups: [], pages: [] }), [tree]);
  const rows = useMemo(() => visibleRows(index, expanded), [index, expanded]);
  const names = useMemo(() => new NameIndex(index.pages.values()), [index]);
  const mainPage = tree?.mainPage ? names.resolve(tree.mainPage)?.page : undefined;

  /** Re-reads the tree. `after` runs in the same render, so a changed
   * selection never points at a page the tree doesn't have yet. */
  const reload = useCallback(
    async (after?: () => void) => {
      try {
        const [t, cats] = await Promise.all([api.getTree(project.id), api.listCategories(project.id)]);
        setTree(t);
        setCategoryList(cats);
        after?.();
      } catch (e) {
        report(e);
      }
    },
    [project.id, report],
  );

  const reloadCategories = useCallback(() => {
    api.listCategories(project.id).then(setCategoryList, report);
  }, [project.id, report]);

  useEffect(() => void reload(), [reload]);

  // Files changed outside the app (M10: Drive, another program): read everything affected again.
  useProjectSync(project.id, (c) => void applyChanges(c));
  async function applyChanges(c: FilesChanged) {
    let t: Tree;
    try {
      [t] = await Promise.all([api.getTree(project.id), api.listCategories(project.id).then(setCategoryList)]);
    } catch (e) {
      return report(e);
    }
    setTree(t);
    if (c.projectFile) {
      templates.reload();
      api.getProjectSettings(project.id).then(setSettings, () => {});
      api.getImageFrame(project.id).then(setImageFrameState, () => {});
    }
    if (c.projectFile || c.projectThemes || c.appThemes) reloadTheme();
    if (c.appThemes) void loadPageEdge();
    if (!selected) return;
    if (c.removed.includes(selected)) {
      // Moved or renamed on disk (the same title in a new file): follow it.
      const title = index.pages.get(selected)?.title;
      const moved = title !== undefined && t.pages.find((p) => c.pages.includes(p.id) && norm(p.title) === norm(title));
      if (moved) {
        remapHistory(selected, moved.id);
        setSelected(moved.id);
      } else if (!t.pages.some((p) => p.id === selected)) {
        setDeletedOpen(selected);
        setDiskTick((n) => n + 1);
      }
    } else if (c.pages.includes(selected)) setDiskTick((n) => n + 1);
  }

  /** A conflict was resolved: what it replaced is read again like a change from outside. */
  function conflictResolved(c: Conflict) {
    const pagesDir = `${project.id}/pages/`;
    void applyChanges({
      project: project.id,
      pages: c.kind === "page" && c.original.startsWith(pagesDir) ? [c.original.slice(pagesDir.length)] : [],
      removed: [],
      groups: false,
      categories: c.kind === "category",
      projectFile: c.kind === "project",
      projectThemes: c.kind === "theme",
      appThemes: c.kind === "theme",
      assets: false,
    });
  }
  // Read every page into the search index in the background, so the first search is quick.
  useEffect(() => void api.searchPrepare(project.id).catch(() => {}), [project.id]);

  /** Opens every group down to `group` so its contents are visible. */
  const reveal = useCallback(
    (group: string) => {
      const chain = groupChain(group);
      setExpanded((prev) => (chain.every((g) => prev.has(g)) ? prev : new Set([...prev, ...chain])));
    },
    [setExpanded],
  );

  /**
   * Opens a page. `record: false` leaves the back/forward history alone
   * (used by Back and Forward themselves). `section` scrolls to a section,
   * `via` shows "Redirected from …".
   */
  async function openPage(
    id: string,
    edit = false,
    {
      section = null,
      via = null,
      find = null,
      record = true,
    }: { section?: string | null; via?: string | null; find?: string | null; record?: boolean } = {},
  ) {
    if (id !== selected || panel || category) await flushAll();
    setPanel(null);
    setCategory(null);
    record && remember(id);
    reveal(parentOf(id));
    setSelected(id);
    setSelectedGroup(null);
    setEditing(edit);
    setRevealRow({ id });
    setArrival({ section, via, find, key: Date.now() });
  }

  /** Where the user is now, as a history entry. */
  function place(): string | null {
    if (category) return catKey(category);
    if (panel === "search") return SEARCH_KEY + search.query;
    if (panel === "graph") return GRAPH_KEY;
    if (panel === "family") return FAMILY_KEY + (familyCentre ?? "");
    return selected && !panel ? selected : null;
  }

  /** Records the current place before going to `next`. */
  function remember(next: string) {
    const from = place();
    if (from && from !== next) setHistory((h) => ({ back: [...h.back, from].slice(-HISTORY_LIMIT), forward: [] }));
  }

  /** Opens a category page (`find`: from a search result, the find bar's query). */
  async function openCategory(name: string, { record = true, find = null }: { record?: boolean; find?: string | null } = {}) {
    await flushAll();
    if (record) remember(catKey(name));
    setPanel(null);
    setEditing(false);
    setCategory(name);
    setCategoryFind(find === null ? null : { query: find, key: Date.now() });
  }

  async function createCategory(name: string) {
    try {
      const made = await api.createCategory(project.id, name);
      reloadCategories();
      await openCategory(made);
    } catch (e) {
      report(e);
    }
  }

  /** Shows the categories list, Templates, Themes, Relations or Search instead of a page. */
  async function openPanel(which: Panel) {
    await flushAll();
    if (which === "categories") remember("");
    setCategory(null);
    setEditing(false);
    setPanel(which);
  }

  /** The Search screen (Cmd+Shift+F, the sidebar's search box), with `query` if given. */
  async function openSearch(query?: string, { record = true }: { record?: boolean } = {}) {
    const q = query ?? search.query;
    if (query !== undefined) setSearch((s) => ({ ...s, query }));
    if (panel !== "search") {
      if (record) remember(SEARCH_KEY + q);
      await openPanel("search");
    }
    setSearchFocus((n) => n + 1);
  }

  /** The Graph screen (Cmd+Alt+G, the sidebar's graph button); `focus`: centred on that page. */
  async function openGraph({ record = true, focus = null }: { record?: boolean; focus?: string | null } = {}) {
    setGraphFocus(focus ? { id: focus, key: Date.now() } : null);
    if (panel === "graph") return;
    if (record) remember(GRAPH_KEY);
    await openPanel("graph");
  }

  /** The Family tree screen (Cmd+Alt+T, the sidebar's tree button), centred on `centre` if given. */
  async function openFamily({ record = true, centre }: { record?: boolean; centre?: string | null } = {}) {
    const next = centre === undefined ? familyCentre : centre;
    if (panel === "family" && next === familyCentre) return;
    if (record) remember(FAMILY_KEY + (next ?? ""));
    setFamilyCentre(next);
    if (panel !== "family") await openPanel("family");
  }
  const openFamilyRef = useRef(openFamily);
  openFamilyRef.current = openFamily;

  /** Back (-1) or forward (1) through visited pages, skipping deleted ones. */
  async function go(step: -1 | 1) {
    const from = step < 0 ? [...history.back] : [...history.forward];
    const skipped: string[] = [];
    let target: string | undefined;
    const gone = (t: string) => keyCategory(t) === null && keySearch(t) === null && keyFamily(t) === null && t !== GRAPH_KEY && !index.pages.has(t);
    while ((target = step < 0 ? from.pop() : from.shift()) !== undefined && gone(target)) skipped.push(target);
    if (target === undefined) return;
    const now = place();
    const here = now && !gone(now) ? [now] : [];
    setHistory((h) =>
      step < 0
        ? { back: from, forward: [...here, ...h.forward] }
        : { back: [...h.back, ...here], forward: from },
    );
    const cat = keyCategory(target);
    const query = keySearch(target);
    const person = keyFamily(target);
    if (cat !== null) await openCategory(cat, { record: false });
    else if (person !== null) await openFamily({ record: false, centre: person || null });
    else if (query !== null) await openSearch(query, { record: false });
    else if (target === GRAPH_KEY) await openGraph({ record: false });
    else await openPage(target, false, { record: false });
  }

  function goHome() {
    if (mainPage) return void openPage(mainPage.id);
    dialogs.alert({
      title: "No main page",
      message: (
        <>
          This project has no main page yet. Open the page you want and choose <strong>Set as main page</strong>{" "}
          from the page's <strong>⋯</strong> menu.
        </>
      ),
    });
  }

  /** After a page id changed (rename or move), keep it in the history. */
  function remapHistory(from: string, to: string) {
    if (from === to) return;
    const map = (ids: string[]) => ids.map((x) => remapId(x, from, to));
    setHistory((h) => ({ back: map(h.back), forward: map(h.forward) }));
  }

  useProjectKeys({
    toggleSidebar: () => setSidebarHidden(!sidebarHidden),
    search: () => void openSearch(),
    graph: () => void openGraph(),
    family: () => void openFamily(),
    quickOpen: () => setQuickOpen(true),
    go: (step) => void go(step),
  });

  // A project opens on its main page.
  const openedMain = useRef(false);
  useEffect(() => {
    if (!tree || openedMain.current) return;
    openedMain.current = true;
    if (mainPage && selected === null) void openPage(mainPage.id);
    // Only once, when the tree first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  /** After a group was renamed or moved, keep its open state and the selection. */
  function remapGroup(from: string, to: string) {
    if (from === to) return;
    remapHistory(from, to);
    setExpanded((prev) => new Set([...prev].map((id) => remapId(id, from, to))));
    setSelected((s) => (s === null ? s : remapId(s, from, to)));
    setSelectedGroup((g) => (g === null ? g : remapId(g, from, to)));
  }

  async function back() {
    await flushAll();
    onBack();
  }

  // ---- actions ----

  /** The template drop-down of the New page and Create page dialogs (none
   * without templates), starting on `initial` if that template exists. */
  function templateSelect(initial: string | null = null) {
    if (!templates.templates.length) return [];
    const sorted = [...templates.templates].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return [
      {
        key: "template",
        label: "Template",
        options: [{ id: "", label: "No template" }, ...sorted.map((t) => ({ id: t.id, label: t.name }))],
        initial: initial && sorted.some((t) => t.id === initial) ? initial : "",
      },
    ];
  }

  // The template of each open page's infobox (pages report it), so pages
  // created from there start with the same template.
  const pageTemplates = useRef(new Map<string, string | null>());

  function newPage(group: string) {
    dialogs.prompt({
      title: group ? `New page in ${displayGroup(group)}` : "New page",
      label: "Page title",
      selects: templateSelect(),
      confirmLabel: "Create",
      submit: async (title, allowLong, { selected: sel }) => {
        await flushAll();
        const page = await api.createPage(project.id, group, title, allowLong, sel.template || null);
        await reload();
        await openPage(page.id, true);
      },
    });
  }

  // Group drop-downs: every group, indented by depth.
  const groupOptions = useMemo(
    () => [
      { id: ROOT, label: "Top level" },
      ...allGroupsInOrder(index).map((g) => ({ id: g.id, label: `${"\u2003".repeat(g.depth + 1)}${g.name}` })),
    ],
    [index],
  );

  /** A red link was clicked: create the page it points to, in a group of the
   * user's choice, with the template of the page the link is on suggested.
   * With `stay`, the new page isn't opened (e.g. created from an infobox field). */
  function createFromLink(title: string, fromPage?: string, opts: CreateOptions = {}) {
    dialogs.prompt({
      title: "Create page",
      label: "Page title",
      initial: title,
      note: <>This page doesn't exist yet.{opts.stay && " You stay on this page."}</>,
      selects: [
        { key: "group", label: "Group", options: groupOptions, initial: fromPage ? parentOf(fromPage) : ROOT },
        ...templateSelect(opts.template ?? (fromPage ? (pageTemplates.current.get(fromPage) ?? null) : null)),
      ],
      confirmLabel: "Create",
      submit: async (t, allowLong, { selected: sel }) => {
        await flushAll();
        const page = await api.createPage(project.id, sel.group ?? ROOT, t, allowLong, sel.template || null);
        await reload();
        if (opts.stay) opts.onCreated?.(page);
        else await openPage(page.id, true);
      },
    });
  }

  function follow({ pageId, section, via }: FollowTarget) {
    if (!index.pages.has(pageId)) return;
    void openPage(pageId, false, { section, via });
  }

  const { newGroup, renamePage, setAsMainPage, renameGroup, deletePage, deleteGroup, canDrop, dropMove, dropPicked, movePicked, categorisePicked, deletePicked, moveTo } = usePageActions({
    project,
    index,
    rows,
    picked,
    setPicked,
    selected,
    setSelected,
    setEditing,
    mainPageId: mainPage?.id,
    reload,
    reveal,
    remapHistory,
    remapGroup,
    setHistory,
    pageChanged: () => setPageVersion((v) => v + 1),
    reloadCategories,
    setSelectedGroup,
    setExpanded,
    toggle,
    setRevealRow,
  });

  function menuFor(row: Row): MenuItem[] {
    if (row.kind === "page") {
      return [
        { label: "Open", action: () => void openPage(row.id) },
        { label: "Rename…", action: () => void renamePage(row.id) },
        { label: "Move to…", action: () => moveTo("page", row.id) },
        ...(mainPage?.id === row.id ? [] : [{ label: "Set as main page", action: () => setAsMainPage(row.id) }]),
        { label: "Delete…", action: () => void deletePage(row.id), danger: true },
      ];
    }
    return [
      { label: "New page here…", action: () => newPage(row.id) },
      { label: "New group here…", action: () => newGroup(row.id) },
      { label: "Rename…", action: () => renameGroup(row.id) },
      { label: "Move to…", action: () => moveTo("group", row.id) },
      { label: "Delete…", action: () => deleteGroup(row.id), danger: true },
    ];
  }

  const selectedExists = selected !== null && (tree === null || index.pages.has(selected));
  // Where "New page" / "New group" create things.
  const targetGroup =
    selectedGroup !== null && (selectedGroup === ROOT || index.groups.has(selectedGroup))
      ? selectedGroup
      : selected && selectedExists
        ? parentOf(selected)
        : ROOT;
  const targetHint = targetGroup ? `in ${displayGroup(targetGroup)}` : "at the top level";

  // The Family tree's person changed (Back returns to the one before when `record`).
  const onFamilyCentre = useCallback((id: string, record: boolean) => void openFamilyRef.current({ centre: id, record }), []);
  const openFamilySettings = useCallback(() => setSettingsOpen("family"), []);

  // Stable functions for the context, always calling the latest versions.
  const actions = useRef({ follow, createFromLink, openCategory, createCategory, openFamily });
  actions.current = { follow, createFromLink, openCategory, createCategory, openFamily };
  const wiki = useMemo<Wiki>(
    () => ({
      project: project.id,
      names,
      follow: (t) => actions.current.follow(t),
      createFromLink: (title, from, opts) => actions.current.createFromLink(title, from, opts),
      noteTemplate: (pageId, template) => void pageTemplates.current.set(pageId, template),
      groupOptions,
      templates: templates.templates,
      imageFrame,
      setImageFrame: (f) => {
        setImageFrameState(f);
        api.setImageFrame(project.id, f).catch(report);
      },
      categories,
      openCategory: (name) => void actions.current.openCategory(name),
      createCategory: (name) => void actions.current.createCategory(name),
      reloadCategories,
      settings,
      revealAll,
      openFamilyTree: (pageId) => void actions.current.openFamily({ centre: pageId }),
    }),
    [project.id, names, groupOptions, templates.templates, imageFrame, report, categories, reloadCategories, settings, revealAll],
  );

  return (
    <WikiContext.Provider value={wiki}>
    <div className={`project ${revealAll ? "reveal-spoilers" : ""} ${sidebarHidden ? "sidebar-hidden" : ""}`}>
      <aside className="sidebar" hidden={sidebarHidden}>
        <SidebarHeader
          projectName={project.name}
          mainPageTitle={mainPage?.title ?? null}
          canBack={history.back.length > 0}
          canForward={history.forward.length > 0}
          onProjects={() => void back()}
          onHome={goHome}
          onGo={(step) => void go(step)}
          topSelected={selectedGroup === ROOT}
          onSelectTop={() => setSelectedGroup(ROOT)}
          revealAll={revealAll}
          setRevealAll={setRevealAll}
          onSettings={() => setSettingsOpen("top")}
          graphOpen={panel === "graph"}
          onGraph={() => void openGraph()}
          familyOpen={panel === "family"}
          onFamily={() => void openFamily()}
          onHideSidebar={() => setSidebarHidden(true)}
        />
        <div className="row">
          <button
            className="primary grow"
            title={`New page ${targetHint}`}
            onClick={() => newPage(targetGroup)}
          >
            New page
          </button>
          <button
            className="grow"
            title={`New group ${targetHint}`}
            onClick={() => newGroup(targetGroup)}
          >
            New group
          </button>
        </div>
        <p className="target-hint" title="Click a group, or the project name for the top level">
          Adding to: <strong>{targetGroup ? displayGroup(targetGroup) : "top level"}</strong>
        </p>
        <SidebarScreens
          panel={panel}
          categoryOpen={category !== null}
          query={search.query}
          onQuery={(query) => {
            setSearch((s) => ({ ...s, query }));
            if (panel === "search") return;
            remember(SEARCH_KEY + query);
            void openPanel("search");
          }}
          onSearch={() => void openSearch()}
          onFind={() => setQuickOpen(true)}
          onPanel={(which) => void openPanel(which)}
          templates={templates.templates.length}
          categories={categories.list.length}
          conflicts={tree?.conflicts ?? 0}
        />
        <Sidebar
          rows={rows}
          selected={panel || category ? null : selected}
          picked={picked}
          onPick={setPicked}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          onSelectTop={() => setSelectedGroup(ROOT)}
          reveal={revealRow}
          onOpenPage={(id) => void openPage(id)}
          onToggle={toggle}
          menuFor={menuFor}
          canDrop={(row, target) => canDrop(row.kind, row.id, target)}
          onDrop={(row, target) => void (picked.has(row.id) && picked.size > 1 ? dropPicked(target) : dropMove(row.kind, row.id, target))}
          empty={tree && <p className="empty small">No pages yet.</p>}
        />
        {picked.size > 0 && (
          <div className="pick-bar" role="toolbar" aria-label="Picked pages">
            <span className="pick-count">{plural(picked.size, "page")}</span>
            <button onClick={movePicked}>Move to…</button>
            <button onClick={categorisePicked}>Category…</button>
            <button className="danger-text" onClick={deletePicked}>
              Delete…
            </button>
            <button className="plain pick-clear" title="Let go (Esc)" aria-label="Let go of the picked pages" onClick={() => setPicked(new Set())}>
              ×
            </button>
          </div>
        )}
      </aside>

      <main className="content">
        {sidebarHidden && (
          <button
            className="plain nav show-sidebar"
            title={`Show the sidebar (${IS_MAC ? "⌘" : "Ctrl+"}\\)`}
            aria-label="Show the sidebar"
            onClick={() => setSidebarHidden(false)}
          >
            <SidebarIcon />
          </button>
        )}
        {panel === "categories" ? (
          <CategoriesList onOpen={(name) => void openCategory(name)} onCreate={(name) => void createCategory(name)} />
        ) : category ? (
          <CategoryView
            key={category}
            name={category}
            find={categoryFind}
            editing={editing}
            setEditing={setEditing}
            onRenamed={(name) => {
              const map = (ids: string[]) => ids.map((x) => (x.toLowerCase() === catKey(category).toLowerCase() ? catKey(name) : x));
              setHistory((h) => ({ back: map(h.back), forward: map(h.forward) }));
              setCategory(name);
              void reload();
            }}
            onDeleted={() => {
              setCategory(null);
              setPanel("categories");
              void reload();
            }}
          />
        ) : panel === "search" ? (
          <SearchView
            state={search}
            setState={setSearch}
            spoilers={revealAll}
            focusKey={searchFocus}
            onOpen={(hit) =>
              void (hit.kind === "category"
                ? openCategory(hit.id, { find: search.query })
                : openPage(hit.id, false, { find: search.query }))
            }
          />
        ) : panel === "graph" ? (
          <GraphView
            key={graphFocus?.key ?? 0}
            revealAll={revealAll}
            focusPage={graphFocus}
            onOpenPage={(id) => void openPage(id)}
            changeSettings={changeSettings}
          />
        ) : panel === "family" ? (
          <FamilyTreeView
            centre={familyCentre}
            onCentre={onFamilyCentre}
            openPage={selected}
            revealAll={revealAll}
            onOpenPage={(id) => void openPage(id)}
            onOpenSettings={openFamilySettings}
          />
        ) : panel === "conflicts" ? (
          <ConflictsView onResolved={conflictResolved} />
        ) : panel === "relations" ? (
          <RelationsView openPage={(id) => void openPage(id)} />
        ) : panel === "themes" ? (
          <ThemesView
            project={project.id}
            projectTheme={settings.theme ?? null}
            onProjectTheme={(theme) => changeSettings({ ...settings, theme })}
          />
        ) : panel === "templates" ? (
          <TemplatesView
            project={project.id}
            state={templates}
            selected={templateSelected}
            setSelected={setTemplateSelected}
            openPage={(id) => void openPage(id)}
            onFieldRenamed={(old, next) => {
              const ft = renameFieldInFamily(settings.familyTree, templates.templates, old, next);
              if (ft) changeSettings({ ...settings, familyTree: ft });
            }}
          />
        ) : selected && (selectedExists || deletedOpen === selected) ? (
          <div className="page-with-graph">
          <PageView
            key={`${selected}\n${pageVersion}`}
            project={project.id}
            pageId={selected}
            title={index.pages.get(selected)?.title}
            aliases={index.pages.get(selected)?.aliases ?? []}
            isMain={mainPage?.id === selected}
            editing={editing}
            setEditing={setEditing}
            onRename={() => void renamePage(selected)}
            onMove={() => moveTo("page", selected)}
            onDelete={() => void deletePage(selected)}
            onSetMain={() => setAsMainPage(selected)}
            onNamesChanged={() => void reload()}
            onReveal={(group) => {
              reveal(parentOf(group));
              setRevealRow({ id: group });
            }}
            arrival={arrival}
            diskTick={diskTick}
            onFamilyTree={() => void openFamily({ centre: selected })}
            onClosed={() => {
              setDeletedOpen(null);
              setSelected(null);
              setEditing(false);
              void reload();
            }}
          />
          {localGraph.open && selectedExists && (
            <LocalGraph
              pageId={selected}
              revealAll={revealAll}
              onOpenPage={(id) => void openPage(id)}
              onOpenInGraph={(id) => void openGraph({ focus: id })}
            />
          )}
          </div>
        ) : (
          <p className="empty center">
            {index.pages.size ? "Select a page on the left." : "Create a page to get started."}
          </p>
        )}
      </main>

      <HoverCards />
      <ImageViewer />

      {settingsOpen && (
        <ProjectSettingsDialog
          project={project.id}
          settings={settings}
          change={changeSettings}
          focus={settingsOpen}
          close={() => setSettingsOpen(false)}
        />
      )}

      {quickOpen && (
        <QuickOpen
          names={names}
          categories={categories}
          onOpen={(e) => void openPage(e.page.id)}
          onOpenCategory={(name) => void openCategory(name)}
          close={() => setQuickOpen(false)}
        />
      )}
    </div>
    </WikiContext.Provider>
  );
}
