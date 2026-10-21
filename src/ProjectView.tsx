import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, isLongPath, type CategoryInfo, type Frame, type ProjectInfo, type ProjectSettings, type Tree } from "./api";
import { CategoryIndex } from "./categories";
import { CategoriesList, CategoryView } from "./CategoryView";
import { flushAll } from "./autosave";
import { useDialogs, type PickOption } from "./dialogs";
import { HoverCards } from "./HoverCard";
import { ImageViewer } from "./ImageViewer";
import { NameIndex } from "./names";
import { useReportError } from "./notify";
import { PageView } from "./PageView";
import { IS_MAC, isQuickOpenKey, QuickOpen, QUICK_OPEN_KEYS } from "./QuickOpen";
import { DEFAULT_FRAME, WikiContext, type CreateOptions, type FollowTarget, type Wiki } from "./wiki";
import { useGlobalReveal } from "./spoilers";
import { useSidebarHidden } from "./layoutPrefs";
import { Sidebar, type MenuItem } from "./Sidebar";
import { SidebarHeader, SidebarIcon } from "./SidebarHeader";
import { TemplatesView, useTemplates } from "./TemplatesView";
import { ProjectSettingsDialog } from "./ProjectSettings";
import { RelationsView } from "./RelationsView";
import { useThemes } from "./themes/runtime";
import { ThemesView } from "./themes/ThemesView";
import {
  allGroupsInOrder,
  buildIndex,
  canMoveGroupInto,
  countInside,
  displayGroup,
  groupChain,
  isWithin,
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

type Kind = Row["kind"];

// Which groups are open is remembered on this computer only (not synced).
const expandedKey = (project: string) => `ownwiki.expanded.${project}`;

function loadExpanded(project: string): Set<string> {
  try {
    const raw = localStorage.getItem(expandedKey(project));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(project: string, ids: Set<string>) {
  try {
    localStorage.setItem(expandedKey(project), JSON.stringify([...ids]));
  } catch {
    // Not being able to remember open groups is harmless.
  }
}

const where = (group: string) => (group ? `in ${displayGroup(group)}` : "at the top level");

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** History entries for category pages ("category:Name"; page ids end in ".md"). */
const CAT_KEY = "category:";
const catKey = (name: string) => CAT_KEY + name;
const keyCategory = (key: string) => (key.startsWith(CAT_KEY) ? key.slice(CAT_KEY.length) : null);

/** Pages visited in this project since it was opened (back/forward). */
interface History {
  back: string[];
  forward: string[];
}

const HISTORY_LIMIT = 200;

/** Cmd+[ / Cmd+] on the Mac, Alt+Left / Alt+Right on Windows: -1 back, 1 forward, 0 neither. */
function historyKey(e: KeyboardEvent): number {
  if (IS_MAC) {
    if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return 0;
    if (e.key === "[" || e.code === "BracketLeft") return -1;
    if (e.key === "]" || e.code === "BracketRight") return 1;
    return 0;
  }
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  return e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
}

export function ProjectView({ project, onBack }: Props) {
  const dialogs = useDialogs();
  const report = useReportError();
  const [tree, setTree] = useState<Tree | null>(null);
  const [expanded, setExpandedState] = useState(() => loadExpanded(project.id));
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
  // A screen shown instead of a page: the categories list, Templates or Themes.
  const [panel, setPanel] = useState<"categories" | "templates" | "themes" | "relations" | null>(null);
  const [imageFrame, setImageFrameState] = useState<Frame>(DEFAULT_FRAME);
  const [settings, setSettings] = useState<ProjectSettings>({ hideCategoryBox: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Show every spoiler everywhere (this computer only).
  const [revealAll, setRevealAll] = useGlobalReveal();
  // The sidebar can be hidden for more room (this computer only).
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  const sidebarRef = useRef({ hidden: sidebarHidden, set: setSidebarHidden });
  sidebarRef.current = { hidden: sidebarHidden, set: setSidebarHidden };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(IS_MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || (e.key !== "\\" && e.code !== "Backslash")) return;
      e.preventDefault();
      sidebarRef.current.set(!sidebarRef.current.hidden);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    api.getImageFrame(project.id).then(setImageFrameState, () => {});
    api.getProjectSettings(project.id).then(setSettings, () => {});
  }, [project.id]);

  function changeSettings(next: ProjectSettings) {
    setSettings(next);
    api.setProjectSettings(project.id, next).catch(report);
  }
  // The project's own theme (if any) shows while the project is open.
  const { setProject: setThemeProject } = useThemes();
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
  // Pages picked in the sidebar with ⌘/Ctrl-click or Shift-click, to move,
  // categorise or delete together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Where to scroll and what to say when a page was opened through a link.
  const [arrival, setArrival] = useState<{ section: string | null; via: string | null; key: number }>({
    section: null,
    via: null,
    key: 0,
  });

  const index = useMemo(() => buildIndex(tree ?? { groups: [], pages: [] }), [tree]);
  const rows = useMemo(() => visibleRows(index, expanded), [index, expanded]);
  const names = useMemo(() => new NameIndex(index.pages.values()), [index]);
  const mainPage = tree?.mainPage ? names.resolve(tree.mainPage)?.page : undefined;

  const setExpanded = useCallback(
    (update: (prev: Set<string>) => Set<string>) =>
      setExpandedState((prev) => {
        const next = update(prev);
        saveExpanded(project.id, next);
        return next;
      }),
    [project.id],
  );

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

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!isQuickOpenKey(e)) return;
      e.preventDefault();
      setQuickOpen(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

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
    { section = null, via = null, record = true }: { section?: string | null; via?: string | null; record?: boolean } = {},
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
    setArrival({ section, via, key: Date.now() });
  }

  /** Where the user is now, as a history entry. */
  function place(): string | null {
    if (category) return catKey(category);
    return selected && !panel ? selected : null;
  }

  /** Records the current place before going to `next`. */
  function remember(next: string) {
    const from = place();
    if (from && from !== next) setHistory((h) => ({ back: [...h.back, from].slice(-HISTORY_LIMIT), forward: [] }));
  }

  /** Opens a category page. */
  async function openCategory(name: string, { record = true }: { record?: boolean } = {}) {
    await flushAll();
    if (record) remember(catKey(name));
    setPanel(null);
    setEditing(false);
    setCategory(name);
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

  /** Shows the categories list, Templates or Themes instead of a page. */
  async function openPanel(which: "categories" | "templates" | "themes" | "relations") {
    await flushAll();
    if (which === "categories") remember("");
    setCategory(null);
    setEditing(false);
    setPanel(which);
  }

  /** Back (-1) or forward (1) through visited pages, skipping deleted ones. */
  async function go(step: -1 | 1) {
    const from = step < 0 ? [...history.back] : [...history.forward];
    const skipped: string[] = [];
    let target: string | undefined;
    const gone = (t: string) => keyCategory(t) === null && !index.pages.has(t);
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
    if (cat !== null) await openCategory(cat, { record: false });
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

  // Back/forward keys (and the mouse's back/forward buttons).
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const step = historyKey(e);
      if (!step || document.querySelector(".backdrop")) return;
      e.preventDefault();
      void goRef.current(step as -1 | 1);
    };
    const mouse = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) void goRef.current(e.button === 3 ? -1 : 1);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mouseup", mouse);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mouseup", mouse);
    };
  }, []);

  // A project opens on its main page.
  const openedMain = useRef(false);
  useEffect(() => {
    if (!tree || openedMain.current) return;
    openedMain.current = true;
    if (mainPage && selected === null) void openPage(mainPage.id);
    // Only once, when the tree first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  function toggle(group: string, open: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(group);
      else next.delete(group);
      return next;
    });
  }

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
        ...templateSelect(fromPage ? (pageTemplates.current.get(fromPage) ?? null) : null),
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

  function newGroup(parent: string) {
    dialogs.prompt({
      title: parent ? `New group in ${displayGroup(parent)}` : "New group",
      label: "Group name",
      confirmLabel: "Create",
      submit: async (name, allowLong) => {
        const g = await api.createGroup(project.id, parent, name, allowLong);
        await reload();
        reveal(parent);
        // Open and select the new group, so it's visible and new pages go into it.
        toggle(g.id, true);
        setSelectedGroup(g.id);
        setRevealRow({ id: g.id });
      },
    });
  }

  async function renamePage(id: string) {
    const page = index.pages.get(id);
    if (!page) return;
    let count = { links: 0, pages: 0 };
    try {
      await flushAll();
      count = await api.linkCount(project.id, page.title);
    } catch (e) {
      return report(e);
    }
    dialogs.prompt({
      title: "Rename page",
      label: "Page title",
      initial: page.title,
      note: count.links ? (
        <>
          {plural(count.links, "link")} in {plural(count.pages, "page")} will be updated to the new title.
        </>
      ) : (
        <>No links point to this page yet.</>
      ),
      checkbox: { label: "Keep old title as alias", initial: false },
      confirmLabel: "Rename",
      submit: async (title, allowLong, { checked }) => {
        await flushAll();
        const result = await api.renamePage(project.id, id, title, allowLong, checked);
        await reload(() => {
          if (selected === id) setSelected(result.page.id);
          remapHistory(id, result.page.id);
          setPageVersion((v) => v + 1);
        });
        if (result.failed.length)
          report(`The page was renamed, but links in these pages couldn't be updated: ${result.failed.join(", ")}.`);
      },
    });
  }

  function setAsMainPage(id: string) {
    const page = index.pages.get(id);
    if (!page) return;
    api.setMainPage(project.id, page.title).then(() => reload(), report);
  }

  function renameGroup(id: string) {
    const g = index.groups.get(id);
    if (!g) return;
    dialogs.prompt({
      title: "Rename group",
      label: "Group name",
      initial: g.name,
      confirmLabel: "Rename",
      submit: async (name, allowLong) => {
        await flushAll();
        const info = await api.renameGroup(project.id, id, name, allowLong);
        await reload(() => remapGroup(id, info.id));
      },
    });
  }

  async function deletePage(id: string) {
    const page = index.pages.get(id);
    if (!page) return;
    let linking = 0;
    try {
      await flushAll();
      linking = (await api.backlinks(project.id, id, false)).length;
    } catch (e) {
      return report(e);
    }
    const isMain = mainPage?.id === id;
    dialogs.confirm({
      title: "Delete page",
      message: (
        <>
          Move <strong>{page.title}</strong> to the Trash?
          {isMain && <> It is the project's main page.</>}
          {linking > 0 && (
            <>
              {" "}
              {plural(linking, "page")} {linking === 1 ? "links" : "link"} to it; those links will turn red.
            </>
          )}
        </>
      ),
      confirmLabel: "Move to Trash",
      danger: true,
      submit: async () => {
        await flushAll();
        await api.deletePage(project.id, id);
        if (selected === id) {
          setSelected(null);
          setEditing(false);
        }
        setHistory((h) => ({ back: h.back.filter((x) => x !== id), forward: h.forward.filter((x) => x !== id) }));
        await reload();
      },
    });
  }

  function deleteGroup(id: string) {
    const g = index.groups.get(id);
    if (!g) return;
    const { pages, groups } = countInside(index, id);
    const contents = [pages && plural(pages, "page"), groups && plural(groups, "subgroup")]
      .filter(Boolean)
      .join(" and ");
    dialogs.confirm({
      title: "Delete group",
      message: contents ? (
        <>
          Move <strong>{g.name}</strong> and everything in it (<strong>{contents}</strong>) to the
          Trash?
        </>
      ) : (
        <>
          Move the empty group <strong>{g.name}</strong> to the Trash?
        </>
      ),
      confirmLabel: "Move to Trash",
      danger: true,
      submit: async () => {
        await flushAll();
        await api.deleteGroup(project.id, id);
        if (selected && isWithin(selected, id)) {
          setSelected(null);
          setEditing(false);
        }
        setSelectedGroup((g) => (g !== null && isWithin(g, id) ? null : g));
        setExpanded((prev) => new Set([...prev].filter((x) => !isWithin(x, id))));
        await reload();
      },
    });
  }

  function canDrop(kind: Kind, id: string, target: string): boolean {
    if (parentOf(id) === target) return false; // already there
    return kind === "page" || canMoveGroupInto(id, target);
  }

  async function doMove(kind: Kind, id: string, target: string, allowLong: boolean) {
    await flushAll();
    if (kind === "page") {
      const info = await api.movePage(project.id, id, target, allowLong);
      await reload(() => {
        if (selected === id) setSelected(info.id);
        remapHistory(id, info.id);
        reveal(target);
      });
    } else {
      const info = await api.moveGroup(project.id, id, target, allowLong);
      await reload(() => {
        remapGroup(id, info.id);
        reveal(target);
      });
    }
  }

  /** Drag and drop: move straight away; ask only if the path gets too long. */
  async function dropMove(kind: Kind, id: string, target: string) {
    try {
      await doMove(kind, id, target, false);
    } catch (e) {
      if (!isLongPath(e)) return report(e);
      dialogs.confirm({
        title: "Long file path",
        message: errorText(e),
        confirmLabel: "Move anyway",
        submit: () => doMove(kind, id, target, true),
      });
    }
  }

  // ---- several pages picked in the sidebar ----

  /** The picked pages that still exist, in sidebar order. */
  function pickedIds(): string[] {
    return rows.filter((r) => r.kind === "page" && picked.has(r.id)).map((r) => r.id).concat(
      [...picked].filter((id) => index.pages.has(id) && !rows.some((r) => r.id === id)),
    );
  }

  /** Moves pages into `target`; `done` remembers the ones already moved (a retry after the long-path warning skips them). */
  async function movePages(ids: string[], target: string, allowLong: boolean, done: Set<string>) {
    await flushAll();
    const moved: [string, string][] = [];
    try {
      for (const id of ids) {
        if (done.has(id) || parentOf(id) === target) continue;
        const info = await api.movePage(project.id, id, target, allowLong);
        done.add(id);
        moved.push([id, info.id]);
      }
    } finally {
      await reload(() => {
        for (const [from, to] of moved) {
          if (selected === from) setSelected(to);
          remapHistory(from, to);
        }
        setPicked(new Set(moved.map(([, to]) => to)));
        reveal(target);
      });
    }
  }

  function movePicked() {
    const ids = pickedIds();
    const done = new Set<string>();
    dialogs.pick({
      title: `Move ${plural(ids.length, "page")} to…`,
      options: [
        { id: ROOT, label: "Top level", fullLabel: "Top level", depth: 0 },
        ...allGroupsInOrder(index).map((g) => ({ id: g.id, label: g.name, fullLabel: displayGroup(g.id), depth: g.depth + 1 })),
      ],
      confirmLabel: "Move",
      submit: (target, allowLong) => movePages(ids, target, allowLong, done),
    });
  }

  /** Several pages dragged onto a group: move them all (asks only about long paths). */
  async function dropPicked(target: string) {
    const ids = pickedIds();
    const done = new Set<string>();
    try {
      await movePages(ids, target, false, done);
    } catch (e) {
      if (!isLongPath(e)) return report(e);
      dialogs.confirm({ title: "Long file path", message: errorText(e), confirmLabel: "Move anyway", submit: () => movePages(ids, target, true, done) });
    }
  }

  function categorisePicked() {
    const ids = pickedIds();
    dialogs.prompt({
      title: `Add a category to ${plural(ids.length, "page")}`,
      label: "Category",
      confirmLabel: "Add",
      submit: async (name) => {
        const clean = name.trim().replace(/^category\s*:\s*/i, "");
        if (!clean) throw "Type a category name.";
        await flushAll();
        for (const id of ids) {
          const page = await api.readPage(project.id, id);
          if (!page.categories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
            await api.setPageCategories(project.id, id, [...page.categories, clean]);
          }
        }
        reloadCategories();
        if (selected && ids.includes(selected)) setPageVersion((v) => v + 1);
      },
    });
  }

  function deletePicked() {
    const ids = pickedIds();
    dialogs.confirm({
      title: "Delete pages",
      message: (
        <>
          Move <strong>{plural(ids.length, "page")}</strong> to the Trash? Links to them will turn red.
          {ids.some((id) => id === mainPage?.id) && <> One of them is the project's main page.</>}
        </>
      ),
      confirmLabel: "Move to Trash",
      danger: true,
      submit: async () => {
        await flushAll();
        try {
          for (const id of ids) await api.deletePage(project.id, id);
        } finally {
          if (selected && ids.includes(selected)) {
            setSelected(null);
            setEditing(false);
          }
          setHistory((h) => ({ back: h.back.filter((x) => !ids.includes(x)), forward: h.forward.filter((x) => !ids.includes(x)) }));
          setPicked(new Set());
          await reload();
        }
      },
    });
  }

  // Escape lets go of the picked pages.
  useEffect(() => {
    if (!picked.size) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".backdrop")) setPicked(new Set());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picked]);

  function moveTo(kind: Kind, id: string) {
    const label = kind === "page" ? index.pages.get(id)?.title : index.groups.get(id)?.name;
    const current = parentOf(id);
    const note = (g: string) =>
      g === current
        ? "current"
        : kind === "group" && !canMoveGroupInto(id, g)
          ? g === id
            ? "this group"
            : "inside it"
          : undefined;
    const options: PickOption[] = [
      { id: ROOT, label: "Top level", fullLabel: "Top level", depth: 0, note: note(ROOT) },
      ...allGroupsInOrder(index).map((g) => ({
        id: g.id,
        label: g.name,
        fullLabel: displayGroup(g.id),
        depth: g.depth + 1,
        note: note(g.id),
      })),
    ];
    dialogs.pick({
      title: `Move “${label}” to…`,
      message: <span className="muted">Now {where(current)}.</span>,
      options,
      confirmLabel: "Move",
      submit: (target, allowLong) => doMove(kind, id, target, allowLong),
    });
  }

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

  // Stable functions for the context, always calling the latest versions.
  const actions = useRef({ follow, createFromLink, openCategory, createCategory });
  actions.current = { follow, createFromLink, openCategory, createCategory };
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
    }),
    [project.id, names, groupOptions, templates.templates, imageFrame, report, categories, reloadCategories, settings],
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
          onSettings={() => setSettingsOpen(true)}
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
        <button className="find" onClick={() => setQuickOpen(true)}>
          <span>Find page…</span>
          <kbd>{QUICK_OPEN_KEYS}</kbd>
        </button>
        <button className={`plain templates-button ${panel === "templates" ? "selected" : ""}`} onClick={() => void openPanel("templates")}>
          Templates
          {templates.templates.length > 0 && <span className="count">{templates.templates.length}</span>}
        </button>
        <button
          className={`plain templates-button ${panel === "categories" || category ? "selected" : ""}`}
          onClick={() => void openPanel("categories")}
        >
          Categories
          {categories.list.length > 0 && <span className="count">{categories.list.length}</span>}
        </button>
        <button className={`plain templates-button ${panel === "relations" ? "selected" : ""}`} onClick={() => void openPanel("relations")}>
          Relations
        </button>
        <button className={`plain templates-button ${panel === "themes" ? "selected" : ""}`} onClick={() => void openPanel("themes")}>
          Themes
        </button>
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
          />
        ) : selected && selectedExists ? (
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
          />
        ) : (
          <p className="empty center">
            {index.pages.size ? "Select a page on the left." : "Create a page to get started."}
          </p>
        )}
      </main>

      <HoverCards />
      <ImageViewer />

      {settingsOpen && (
        <ProjectSettingsDialog project={project.id} settings={settings} change={changeSettings} close={() => setSettingsOpen(false)} />
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
