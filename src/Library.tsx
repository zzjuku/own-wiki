import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type ProjectInfo, type Settings } from "./api";
import { useDialogs } from "./dialogs";
import { useReportError } from "./notify";
import { IS_MAC } from "./QuickOpen";
import { ThemesView } from "./themes/ThemesView";

interface Props {
  libraryPath: string;
  onOpen: (p: ProjectInfo) => void;
  onChooseLibrary: () => void;
  /** The library was copied to a new place and is used from there now. */
  onLibraryMoved: (s: Settings) => void;
}

export function Library({ libraryPath, onOpen, onChooseLibrary, onLibraryMoved }: Props) {
  const dialogs = useDialogs();
  const report = useReportError();
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showThemes, setShowThemes] = useState(false);

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

  /** Opens a project; if another computer has it open right now, asks first (M10). */
  async function openProject(p: ProjectInfo) {
    let others: Awaited<ReturnType<typeof api.openElsewhere>> = [];
    try {
      others = await api.openElsewhere(p.id);
    } catch {
      // Not knowing doesn't stop opening.
    }
    if (!others.length) return onOpen(p);
    const time = (ms: number) => {
      const d = new Date(ms);
      const today = d.toDateString() === new Date().toDateString();
      return d.toLocaleString(undefined, today ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
    };
    dialogs.confirm({
      title: "Open on another computer",
      message: (
        <>
          <strong>{p.name}</strong> is open on {others.map((o, i) => (
            <span key={i}>
              {i > 0 && " and "}
              <strong>{o.computer}</strong> since {time(o.since)}
            </span>
          ))}
          . Editing the same pages on both computers at once can lead to conflicts. Close it there first, or open it here anyway.
        </>
      ),
      confirmLabel: "Open anyway",
      submit: async () => onOpen(p),
    });
  }

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

  /** Settings → Move library…: copy everything to a chosen folder and use it from there. */
  async function moveLibrary() {
    setShowSettings(false);
    let dest: string | null;
    let plan: Awaited<ReturnType<typeof api.moveLibrary>>;
    try {
      const picked = await open({ directory: true, multiple: false, title: "Move the library to…" });
      dest = typeof picked === "string" ? picked : null;
      if (!dest) return;
      plan = await api.moveLibrary(dest, true);
    } catch (e) {
      return report(e);
    }
    const files = IS_MAC ? "Finder" : "File Explorer";
    const names = plan.folders.map((f) => `“${f}”`).join(", ");
    dialogs.confirm({
      title: "Move library",
      message: (
        <>
          Copy the library's folders ({names || "none yet"}) to
          <code className="path">{plan.target}</code>
          and use them from there? Nothing else in the current library folder is touched. The originals stay there as a backup:
          once you've checked the copy, you can delete those folders (only those) in {files}.
        </>
      ),
      confirmLabel: "Move library",
      submit: async () => {
        const r = await api.moveLibrary(dest!, false);
        onLibraryMoved(r.settings);
        // After this dialog has closed (one dialog shows at a time).
        setTimeout(() =>
          dialogs.alert({
            title: "Library moved",
            message: (
              <>
                {r.files === 1 ? "1 file was" : `${r.files.toLocaleString("en")} files were`} copied. The library is now at
                <code className="path">{r.target}</code>
                The originals are still in
                <code className="path">{r.old}</code>
                as a backup. Don't edit them any more.
              </>
            ),
          }),
        );
      },
    });
  }

  if (showThemes) {
    return (
      <div className="library library-themes">
        <ThemesView project={null} onClose={() => setShowThemes(false)} />
      </div>
    );
  }

  return (
    <div className="library">
      <header className="topbar">
        <h1>Own WIKI</h1>
        <div className="spacer" />
        <button onClick={() => setShowThemes(true)} disabled={!!loadError}>
          Themes
        </button>
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
                <button className="project-open" onClick={() => void openProject(p)}>
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
              <p className="hint">
                <strong>Move library…</strong> copies all projects and themes to a new place (for example into Google Drive) and
                uses them from there; the old folder stays as a backup. <strong>Change folder…</strong> only switches to another
                library folder.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => void moveLibrary()}>Move library…</button>
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
