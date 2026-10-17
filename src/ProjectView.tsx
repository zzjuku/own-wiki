import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText, isLongPath, type ProjectInfo, type Tree } from "./api";
import { flushAll } from "./autosave";
import { useDialogs, type PickOption } from "./dialogs";
import { useReportError } from "./notify";
import { PageView } from "./PageView";
import { isQuickOpenKey, QuickOpen, QUICK_OPEN_KEYS } from "./QuickOpen";
import { Sidebar, type MenuItem } from "./Sidebar";
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
  const [quickOpen, setQuickOpen] = useState(false);
  const [revealRow, setRevealRow] = useState<{ id: string } | null>(null);

  const index = useMemo(() => buildIndex(tree ?? { groups: [], pages: [] }), [tree]);
  const rows = useMemo(() => visibleRows(index, expanded), [index, expanded]);
  const pageList = useMemo(() => [...index.pages.values()], [index]);

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
        const t = await api.getTree(project.id);
        setTree(t);
        after?.();
      } catch (e) {
        report(e);
      }
    },
    [project.id, report],
  );

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

  async function openPage(id: string, edit = false) {
    if (id !== selected) await flushAll();
    reveal(parentOf(id));
    setSelected(id);
    setSelectedGroup(null);
    setEditing(edit);
    setRevealRow({ id });
  }

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
    setExpanded((prev) => new Set([...prev].map((id) => remapId(id, from, to))));
    setSelected((s) => (s === null ? s : remapId(s, from, to)));
    setSelectedGroup((g) => (g === null ? g : remapId(g, from, to)));
  }

  async function back() {
    await flushAll();
    onBack();
  }

  // ---- actions ----

  function newPage(group: string) {
    dialogs.prompt({
      title: group ? `New page in ${displayGroup(group)}` : "New page",
      label: "Page title",
      confirmLabel: "Create",
      submit: async (title, allowLong) => {
        await flushAll();
        const page = await api.createPage(project.id, group, title, allowLong);
        await reload();
        await openPage(page.id, true);
      },
    });
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

  function renamePage(id: string) {
    const page = index.pages.get(id);
    if (!page) return;
    dialogs.prompt({
      title: "Rename page",
      label: "Page title",
      initial: page.title,
      confirmLabel: "Rename",
      submit: async (title, allowLong) => {
        await flushAll();
        const info = await api.renamePage(project.id, id, title, allowLong);
        await reload(() => selected === id && setSelected(info.id));
      },
    });
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

  function deletePage(id: string) {
    const page = index.pages.get(id);
    if (!page) return;
    dialogs.confirm({
      title: "Delete page",
      message: (
        <>
          Move <strong>{page.title}</strong> to the Trash?
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
        { label: "Rename…", action: () => renamePage(row.id) },
        { label: "Move to…", action: () => moveTo("page", row.id) },
        { label: "Delete…", action: () => deletePage(row.id), danger: true },
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

  return (
    <div className="project">
      <aside className="sidebar">
        <button className="plain back" onClick={back}>
          ← Projects
        </button>
        <h1
          className={`project-name ${selectedGroup === ROOT ? "selected" : ""}`}
          title={`${project.name} — click to add new pages at the top level`}
          data-drop={ROOT}
          onClick={() => setSelectedGroup(ROOT)}
        >
          {project.name}
        </h1>
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
        <Sidebar
          rows={rows}
          selected={selected}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          onSelectTop={() => setSelectedGroup(ROOT)}
          reveal={revealRow}
          onOpenPage={(id) => void openPage(id)}
          onToggle={toggle}
          menuFor={menuFor}
          canDrop={(row, target) => canDrop(row.kind, row.id, target)}
          onDrop={(row, target) => void dropMove(row.kind, row.id, target)}
          empty={tree && <p className="empty small">No pages yet.</p>}
        />
      </aside>

      <main className="content">
        {selected && selectedExists ? (
          <PageView
            key={selected}
            project={project.id}
            pageId={selected}
            title={index.pages.get(selected)?.title}
            editing={editing}
            setEditing={setEditing}
            onRename={() => renamePage(selected)}
            onMove={() => moveTo("page", selected)}
            onDelete={() => deletePage(selected)}
            onReveal={(group) => {
              reveal(parentOf(group));
              setRevealRow({ id: group });
            }}
          />
        ) : (
          <p className="empty center">
            {index.pages.size ? "Select a page on the left." : "Create a page to get started."}
          </p>
        )}
      </main>

      {quickOpen && (
        <QuickOpen
          pages={pageList}
          onOpen={(id) => void openPage(id)}
          close={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
}
