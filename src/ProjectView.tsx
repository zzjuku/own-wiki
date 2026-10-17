import { useCallback, useEffect, useState } from "react";
import { api, type PageInfo, type ProjectInfo } from "./api";
import { flushAll } from "./autosave";
import { useDialogs } from "./dialogs";
import { useReportError } from "./notify";
import { PageView } from "./PageView";

interface Props {
  project: ProjectInfo;
  onBack: () => void;
}

export function ProjectView({ project, onBack }: Props) {
  const dialogs = useDialogs();
  const report = useReportError();
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPages(await api.listPages(project.id));
    } catch (e) {
      report(e);
    }
  }, [project.id, report]);

  useEffect(() => void reload(), [reload]);

  async function select(id: string) {
    if (id === selected) return;
    await flushAll();
    setSelected(id);
    setEditing(false);
  }

  async function back() {
    await flushAll();
    onBack();
  }

  function newPage() {
    dialogs.prompt({
      title: "New page",
      label: "Page title",
      confirmLabel: "Create",
      submit: async (title) => {
        const page = await api.createPage(project.id, title);
        await flushAll();
        await reload();
        setSelected(page.id);
        setEditing(true);
      },
    });
  }

  return (
    <div className="project">
      <aside className="sidebar">
        <button className="plain back" onClick={back}>
          ← Projects
        </button>
        <h1 className="project-name" title={project.name}>
          {project.name}
        </h1>
        <button className="primary new-page" onClick={newPage}>
          New page
        </button>
        <nav aria-label="Pages">
          {pages.length === 0 && <p className="empty small">No pages yet.</p>}
          <ul className="page-list">
            {pages.map((p) => (
              <li key={p.id}>
                <button
                  className={p.id === selected ? "selected" : ""}
                  aria-current={p.id === selected ? "page" : undefined}
                  onClick={() => select(p.id)}
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="content">
        {selected ? (
          <PageView
            key={selected}
            project={project.id}
            pageId={selected}
            editing={editing}
            setEditing={setEditing}
            onRenamed={async (page) => {
              await reload();
              setSelected(page.id);
            }}
            onDeleted={async () => {
              setSelected(null);
              setEditing(false);
              await reload();
            }}
          />
        ) : (
          <p className="empty center">
            {pages.length ? "Select a page on the left." : "Create a page to get started."}
          </p>
        )}
      </main>
    </div>
  );
}
