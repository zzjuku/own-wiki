// What the project screen (ProjectView) does to pages and groups: new group,
// rename, delete, set as main page, moving (Move to…, drag and drop in the
// sidebar) and acting on several pages picked in the sidebar (move, add a
// category, delete).
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { api, errorText, isLongPath, type ProjectInfo } from "./api";
import { flushAll } from "./autosave";
import { useDialogs, type PickOption } from "./dialogs";
import type { History } from "./history";
import { useReportError } from "./notify";
import { allGroupsInOrder, canMoveGroupInto, countInside, displayGroup, isWithin, parentOf, ROOT, type buildIndex, type Row } from "./tree";

type Kind = Row["kind"];

const where = (group: string) => (group ? `in ${displayGroup(group)}` : "at the top level");

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface ActionContext {
  project: ProjectInfo;
  index: ReturnType<typeof buildIndex>;
  /** The sidebar's visible rows, in order. */
  rows: Row[];
  picked: Set<string>;
  setPicked: (p: Set<string>) => void;
  selected: string | null;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setEditing: (v: boolean) => void;
  mainPageId: string | undefined;
  /** Re-reads the tree; `after` runs in the same render. */
  reload: (after?: () => void) => Promise<void>;
  /** Opens every group down to `group`. */
  reveal: (group: string) => void;
  remapHistory: (from: string, to: string) => void;
  remapGroup: (from: string, to: string) => void;
  setHistory: Dispatch<SetStateAction<History>>;
  /** The open page's file changed behind its back. */
  pageChanged: () => void;
  reloadCategories: () => void;
  setSelectedGroup: Dispatch<SetStateAction<string | null>>;
  setExpanded: (update: (prev: Set<string>) => Set<string>) => void;
  /** Opens (or closes) a group in the sidebar. */
  toggle: (group: string, open: boolean) => void;
  /** Scrolls the sidebar to a row. */
  setRevealRow: (row: { id: string }) => void;
}

export function usePageActions(ctx: ActionContext) {
  const dialogs = useDialogs();
  const report = useReportError();
  const { project, index, rows, picked, setPicked, selected, setSelected, setEditing, reload, reveal, remapHistory, remapGroup, setHistory, reloadCategories } = ctx;
  const { setSelectedGroup, setExpanded, toggle, setRevealRow } = ctx;

  // Escape lets go of the picked pages.
  useEffect(() => {
    if (!picked.size) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".backdrop")) setPicked(new Set());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picked, setPicked]);

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
          ctx.pageChanged();
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
    const isMain = ctx.mainPageId === id;
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
        if (selected && ids.includes(selected)) ctx.pageChanged();
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
          {ids.some((id) => id === ctx.mainPageId) && <> One of them is the project's main page.</>}
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

  return { newGroup, renamePage, setAsMainPage, renameGroup, deletePage, deleteGroup, canDrop, dropMove, dropPicked, movePicked, categorisePicked, deletePicked, moveTo };
}
