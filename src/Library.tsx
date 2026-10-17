import { useCallback, useEffect, useState } from "react";
import { api, errorText, type ProjectInfo } from "./api";
import { useDialogs } from "./dialogs";

interface Props {
  libraryPath: string;
  onOpen: (p: ProjectInfo) => void;
  onChooseLibrary: () => void;
}

export function Library({ libraryPath, onOpen, onChooseLibrary }: Props) {
  const dialogs = useDialogs();
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const reload = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
      setLoadError(null);
    } catch (e) {
      setProjects(null);
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => void reload(), [reload, libraryPath]);

  function newProject() {
    dialogs.prompt({
      title: "New project",
      label: "Project name",
      confirmLabel: "Create",
      submit: async (name) => {
        const p = await api.createProject(name);
        onOpen(p);
      },
    });
  }

  function rename(p: ProjectInfo) {
    dialogs.prompt({
      title: "Rename project",
      label: "Project name",
      initial: p.name,
      confirmLabel: "Rename",
      submit: async (name) => {
        await api.renameProject(p.id, name);
        await reload();
      },
    });
  }

  function remove(p: ProjectInfo) {
    dialogs.confirm({
      title: "Delete project",
      message: (
        <>
          Move <strong>{p.name}</strong> and all its pages to the Trash?
        </>
      ),
      confirmLabel: "Move to Trash",
      danger: true,
      submit: async () => {
        await api.deleteProject(p.id);
        await reload();
      },
    });
  }

  return (
    <div className="library">
      <header className="topbar">
        <h1>Own WIKI</h1>
        <div className="spacer" />
        <button onClick={() => setShowSettings(true)}>Settings</button>
      </header>

      <main className="library-main">
        <div className="section-head">
          <h2>Projects</h2>
          <button className="primary" onClick={newProject} disabled={!!loadError}>
            New project
          </button>
        </div>

        {loadError && (
          <div className="notice">
            <p>{loadError}</p>
            <p className="muted">
              If the folder is on Google Drive, check that Drive is running. Or choose another
              folder.
            </p>
            <div className="row">
              <button onClick={reload}>Try again</button>
              <button onClick={onChooseLibrary}>Choose folder…</button>
            </div>
          </div>
        )}

        {projects && projects.length === 0 && (
          <p className="empty">No projects yet. Create one to start a wiki.</p>
        )}

        {projects && projects.length > 0 && (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="project-open" onClick={() => onOpen(p)}>
                  {p.name}
                </button>
                <div className="row-actions">
                  <button onClick={() => rename(p)}>Rename</button>
                  <button className="danger-text" onClick={() => remove(p)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {showSettings && (
        <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="dialog" role="dialog" aria-label="Settings">
            <h2>Settings</h2>
            <div className="field">
              <span>Library folder (this computer only)</span>
              <code className="path">{libraryPath}</code>
            </div>
            <div className="dialog-actions">
              <button
                onClick={() => {
                  setShowSettings(false);
                  onChooseLibrary();
                }}
              >
                Change folder…
              </button>
              <button className="primary" onClick={() => setShowSettings(false)} autoFocus>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
