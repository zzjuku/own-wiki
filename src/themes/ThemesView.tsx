// The Themes screen (M8), reached from the library and from inside a
// project: the built-in themes, the app themes (library folder) and the open
// project's own themes; choose, create, copy, rename, delete; edit one with
// a live sample. Changes save a moment after each edit.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ThemeInfo } from "../api";
import { Autosaver, registerFlusher, STATUS_TEXT, type SaveStatus } from "../autosave";
import { useDialogs } from "../dialogs";
import { useReportError } from "../notify";
import { BUILTIN_PREFIX, BUILTIN_THEMES, DEFAULT_REF, builtinTheme } from "./builtin";
import { effectiveValue, resolveVars, type ThemeData } from "./engine";
import { loadTheme, parseRef, refOf, storeOf, useThemes, type ThemeRef } from "./runtime";
import { ThemeEditor } from "./ThemeEditor";

interface Props {
  /** The open project (its own themes are listed too), or null on the library screen. */
  project: string | null;
  /** The project's theme choice and how to change it (inside a project). */
  projectTheme?: ThemeRef | null;
  onProjectTheme?: (ref: ThemeRef | null) => void;
  /** Library screen: back to the projects. */
  onClose?: () => void;
}

export function ThemesView({ project, projectTheme = null, onProjectTheme, onClose }: Props) {
  const report = useReportError();
  const dialogs = useDialogs();
  const themes = useThemes();
  const [appList, setAppList] = useState<ThemeInfo[]>([]);
  const [projectList, setProjectList] = useState<ThemeInfo[]>([]);
  const [selected, setSelected] = useState<ThemeRef>(themes.activeRef);
  const [data, setData] = useState<ThemeData | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  /** Each listed theme's settings, for the colour strips in the list. */
  const [strips, setStrips] = useState<Record<ThemeRef, ThemeData>>({});

  const reloadLists = useCallback(async () => {
    const app = await api.listThemes(null).catch(() => []);
    const own = project ? await api.listThemes(project).catch(() => []) : [];
    setAppList(app);
    setProjectList(own);
    const refs = [...app.map((t) => `app:${t.id}`), ...own.map((t) => `project:${t.id}`)];
    const loaded = await Promise.all(refs.map((r) => loadTheme(r, project)));
    setStrips(Object.fromEntries(refs.flatMap((r, i) => (loaded[i] ? [[r, loaded[i]]] : []))));
  }, [project]);
  useEffect(() => void reloadLists(), [reloadLists]);

  const place = parseRef(selected);
  const readOnly = place.kind === "builtin";
  const saver = useMemo(
    () =>
      new Autosaver(
        (text) => api.saveTheme(storeOf(place, project), place.id, JSON.parse(text) as ThemeData),
        (s, e) => {
          setStatus(s);
          if (e) report(e);
        },
        400,
      ),
    // One saver per theme: switching themes flushes the previous one.
    [selected, project, report], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    const unregister = registerFlusher(() => saver.flush());
    return () => {
      unregister();
      void saver.flush();
    };
  }, [saver]);

  useEffect(() => {
    let stale = false;
    setData(null);
    void loadTheme(selected, project).then((d) => {
      if (stale) return;
      if (d) setData(d);
      else setSelected(DEFAULT_REF);
    });
    return () => void (stale = true);
  }, [selected, project]);

  function change(next: ThemeData) {
    if (readOnly) return;
    setData(next);
    themes.live(selected, next);
    saver.change(JSON.stringify(next));
  }

  const inUseApp = themes.appRef === selected;
  const inUseProject = project !== null && projectTheme === selected;
  const canUseApp = place.kind !== "project";
  const canUseProject = project !== null && place.kind !== "app";

  async function useAsApp() {
    try {
      await themes.setAppRef(selected);
    } catch (e) {
      report(e);
    }
  }

  function create(from: ThemeRef | null) {
    const source = from ? (data ?? builtinTheme(DEFAULT_REF)!) : builtinTheme(DEFAULT_REF)!;
    const where = project
      ? [{ key: "where", label: "Store in", initial: from && parseRef(from).kind === "project" ? "project" : "app", options: [
          { id: "app", label: "App themes (all projects, library folder)" },
          { id: "project", label: "This project only (travels with it)" },
        ] }]
      : undefined;
    dialogs.prompt({
      title: from ? "Copy theme" : "New theme",
      label: "Theme name",
      initial: from ? `${source.name} copy` : "",
      note: from ? <>Starts as a copy of <strong>{source.name}</strong>.</> : <>Starts like the Default theme.</>,
      selects: where,
      confirmLabel: from ? "Copy" : "Create",
      submit: async (name, _long, extra) => {
        await saver.flush();
        const kind = extra.selected.where === "project" ? "project" : "app";
        const store = kind === "project" ? project : null;
        const fromPlace = from ? parseRef(from) : null;
        const stored = fromPlace && fromPlace.kind !== "builtin" ? { project: storeOf(fromPlace, project), id: fromPlace.id } : null;
        const { name: _n, ...rest } = source;
        const info = await api.createTheme(store, name, { ...rest, name, vars: { ...source.vars } }, stored);
        await reloadLists();
        setSelected(refOf({ kind, id: info.id }));
      },
    });
  }

  function rename() {
    if (!data || readOnly) return;
    dialogs.prompt({
      title: "Rename theme",
      label: "Theme name",
      initial: data.name,
      confirmLabel: "Rename",
      submit: async (name) => {
        await saver.flush();
        const info = await api.renameTheme(storeOf(place, project), place.id, name);
        const next = refOf({ kind: place.kind, id: info.id });
        if (inUseApp) await themes.setAppRef(next);
        if (inUseProject) onProjectTheme?.(next);
        await reloadLists();
        setSelected(next);
        themes.reload();
      },
    });
  }

  function remove() {
    if (!data || readOnly) return;
    dialogs.confirm({
      title: "Delete theme",
      message: (
        <>
          Move the theme <strong>{data.name}</strong> and its fonts to the Trash?
          {inUseApp && <> The app goes back to the Default theme.</>}
          {inUseProject && <> This project goes back to the app theme.</>}
        </>
      ),
      confirmLabel: "Move to Trash",
      danger: true,
      submit: async () => {
        await saver.flush();
        await api.deleteTheme(storeOf(place, project), place.id);
        if (inUseApp) await themes.setAppRef(DEFAULT_REF);
        if (inUseProject) onProjectTheme?.(null);
        await reloadLists();
        setSelected(DEFAULT_REF);
        themes.reload();
      },
    });
  }

  const item = (ref: ThemeRef, name: string, swatchData?: ThemeData | null) => (
    <ThemeItem
      key={ref}
      name={name}
      data={ref === selected && data ? data : (swatchData ?? strips[ref] ?? null)}
      selected={ref === selected}
      badges={[themes.appRef === ref ? "App" : "", project && projectTheme === ref ? "Project" : ""].filter(Boolean)}
      onClick={() => setSelected(ref)}
    />
  );

  return (
    <div className="themes-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Themes</h1>
        </div>
        <div className="spacer" />
        {!readOnly && (
          <span className={`save-status ${status}`} aria-live="polite">
            {STATUS_TEXT[status]}
          </span>
        )}
        <button className="primary" onClick={() => create(null)}>
          New theme
        </button>
        {onClose && <button onClick={onClose}>Done</button>}
      </header>
      {project && projectTheme && (
        <p className="notice theme-notice">
          This project uses its own theme. The app theme shows on the library screen and in other projects.
        </p>
      )}
      <div className="themes-body">
        <nav className="theme-list" aria-label="Themes">
          <h3>Built-in</h3>
          {BUILTIN_THEMES.map((t) => item(BUILTIN_PREFIX + t.id, t.data.name, t.data))}
          <h3>App themes</h3>
          {appList.map((t) => item(`app:${t.id}`, t.name))}
          {appList.length === 0 && <p className="empty small">None yet. Copy a theme or make a new one.</p>}
          {project && (
            <>
              <h3>This project</h3>
              {projectList.map((t) => item(`project:${t.id}`, t.name))}
              {projectList.length === 0 && <p className="empty small">None yet.</p>}
            </>
          )}
        </nav>
        {data ? (
          <div className="theme-detail">
            <div className="theme-head">
              <h2>{data.name}</h2>
              {inUseApp && <span className="theme-badge">App theme</span>}
              {inUseProject && <span className="theme-badge">This project's theme</span>}
              <div className="spacer" />
              {canUseApp && !inUseApp && <button onClick={() => void useAsApp()}>Use as app theme</button>}
              {canUseProject && !inUseProject && <button onClick={() => onProjectTheme?.(selected)}>Use for this project</button>}
              {inUseProject && <button onClick={() => onProjectTheme?.(null)}>Use the app theme here</button>}
              <button onClick={() => create(selected)}>Copy…</button>
              {!readOnly && <button onClick={rename}>Rename…</button>}
              {!readOnly && (
                <button className="danger-text" onClick={remove}>
                  Delete
                </button>
              )}
            </div>
            <p className="hint theme-where">
              {place.kind === "builtin" && "Built-in themes can't be changed. Copy one to make your own."}
              {place.kind === "app" && "App theme: stored in the library folder, so every computer and project can use it."}
              {place.kind === "project" && "Stored in this project, so it travels with the project."}
            </p>
            <ThemeEditor key={selected} themeRef={selected} project={project} data={data} readOnly={readOnly} onChange={change} />
          </div>
        ) : (
          <div className="theme-detail" />
        )}
      </div>
    </div>
  );
}

const SWATCH_VARS = ["--bg", "--sidebar-bg", "--page-bg", "--accent", "--link", "--infobox-header-bg"];

function ThemeItem({
  name,
  data,
  selected,
  badges,
  onClick,
}: {
  name: string;
  data: ThemeData | null;
  selected: boolean;
  badges: string[];
  onClick: () => void;
}) {
  const resolved = useMemo(() => (data ? resolveVars(data.vars) : null), [data]);
  return (
    <button className={`plain theme-item ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onClick}>
      <span className="theme-item-name">{name}</span>
      {badges.map((b) => (
        <span key={b} className="theme-item-badge" title={b === "App" ? "The app theme" : "This project's theme"}>
          {b}
        </span>
      ))}
      {resolved && (
        <span className="theme-strip" aria-hidden="true">
          {SWATCH_VARS.map((v) => (
            <span key={v} style={{ background: effectiveValue(resolved, v) }} />
          ))}
        </span>
      )}
    </button>
  );
}
