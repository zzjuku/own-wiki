// The theme in use: the project's own theme while a project that has one is
// open, else the app theme (chosen in the library folder, so it's the same on
// every computer). Applied as CSS variables on the page root; theme fonts are
// loaded from the theme folder through the FontFace API.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { BUILTIN_PREFIX, builtinTheme, DEFAULT_REF } from "./builtin";
import { cssFor, resolveVars, scopedFamily, type ThemeData, type ThemeFont } from "./engine";

/** "builtin:<id>", "app:<folder>" or "project:<folder>" (in the open project). */
export type ThemeRef = string;

export interface ThemePlace {
  kind: "builtin" | "app" | "project";
  id: string;
}

export function parseRef(ref: ThemeRef): ThemePlace {
  const i = ref.indexOf(":");
  const kind = ref.slice(0, i);
  return { kind: kind === "app" || kind === "project" ? kind : "builtin", id: ref.slice(i + 1) };
}

export const refOf = (p: ThemePlace): ThemeRef => `${p.kind}:${p.id}`;

/** The `project` argument of the theme commands: null = app themes. */
export const storeOf = (p: ThemePlace, project: string | null): string | null => (p.kind === "project" ? project : null);

/** Where font families of a theme are registered: unique across projects. */
export const fontScope = (ref: ThemeRef, project: string | null) =>
  parseRef(ref).kind === "project" ? `${project}/${ref}` : ref;

export async function loadTheme(ref: ThemeRef, project: string | null): Promise<ThemeData | null> {
  const place = parseRef(ref);
  if (place.kind === "builtin") return builtinTheme(ref);
  if (place.kind === "project" && !project) return null;
  return api.readTheme(storeOf(place, project), place.id).then(
    (d) => ({ ...d, vars: d.vars ?? {} }),
    () => null,
  );
}

const loadedFonts = new Map<string, Promise<void>>();

/** Loads a theme's font files (once each) under their scoped family names. */
export function loadFonts(ref: ThemeRef, project: string | null, fonts: ThemeFont[] | undefined): Promise<void> {
  const place = parseRef(ref);
  if (!fonts?.length || typeof FontFace === "undefined") return Promise.resolve();
  const scope = fontScope(ref, project);
  return Promise.all(
    fonts.map((f) => {
      const key = `${scope}/${f.file}`;
      let p = loadedFonts.get(key);
      if (!p) {
        // Built-in themes' fonts come with the app; others from the theme folder.
        const source: Promise<ArrayBuffer | string> = f.url
          ? Promise.resolve(`url(${JSON.stringify(f.url)})`)
          : api.fontData(storeOf(place, project), place.id, f.file);
        p = source
          // The bytes may arrive as a plain list of numbers instead of an ArrayBuffer.
          .then((data) => {
            const bytes = typeof data === "string" || data instanceof ArrayBuffer ? data : new Uint8Array(data as unknown as number[]).buffer;
            return new FontFace(scopedFamily(f.family, scope), bytes, { weight: f.weight, style: f.style }).load();
          })
          .then((face) => void document.fonts.add(face))
          .catch(() => void loadedFonts.delete(key));
        loadedFonts.set(key, p);
      }
      return p;
    }),
  ).then(() => undefined);
}

interface ThemeRuntime {
  /** The app-wide theme. */
  appRef: ThemeRef;
  /** The open project's own theme (null: it uses the app theme, or no project is open). */
  projectRef: ThemeRef | null;
  /** The theme showing now. */
  activeRef: ThemeRef;
  setAppRef: (ref: ThemeRef) => Promise<void>;
  /** ProjectView tells which project is open and its theme choice. */
  setProject: (project: string | null, ref: ThemeRef | null) => void;
  /** The theme editor changed `ref`: show it at once if it's in use. */
  live: (ref: ThemeRef, data: ThemeData) => void;
  /** Read the theme in use again (after a rename, delete or copy). */
  reload: () => void;
}

const Ctx = createContext<ThemeRuntime | null>(null);

export function useThemes(): ThemeRuntime {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemes outside ThemeProvider");
  return ctx;
}

function styleElement(): HTMLStyleElement {
  let el = document.getElementById("theme-vars") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "theme-vars";
    document.head.appendChild(el);
  }
  return el;
}

function apply(ref: ThemeRef, project: string | null, data: ThemeData | null) {
  const vars = data ? resolveVars(data.vars).changed : {};
  const scope = fontScope(ref, project);
  styleElement().textContent = cssFor(":root", vars, data?.fonts ?? [], scope);
  document.documentElement.dataset.theme = ref;
  void loadFonts(ref, project, data?.fonts);
}

/** `libraryPath`: the app theme is read again when the library folder changes. */
export function ThemeProvider({ libraryPath, children }: { libraryPath: string | null; children: ReactNode }) {
  const [appRef, setAppRefState] = useState<ThemeRef>(DEFAULT_REF);
  const [project, setProjectState] = useState<{ id: string | null; ref: ThemeRef | null }>({ id: null, ref: null });
  const [version, setVersion] = useState(0);
  const activeRef = project.ref ?? appRef;
  const activeProject = project.ref ? project.id : null;
  const current = useRef({ activeRef, activeProject });
  current.current = { activeRef, activeProject };

  useEffect(() => {
    if (!libraryPath) return setAppRefState(DEFAULT_REF);
    api.getAppTheme().then((r) => setAppRefState(r || DEFAULT_REF), () => setAppRefState(DEFAULT_REF));
  }, [libraryPath]);

  useEffect(() => {
    let stale = false;
    void loadTheme(activeRef, activeProject).then((data) => {
      if (!stale) apply(data ? activeRef : DEFAULT_REF, activeProject, data);
    });
    return () => void (stale = true);
  }, [activeRef, activeProject, version]);

  const setAppRef = useCallback(async (ref: ThemeRef) => {
    await api.setAppTheme(ref === DEFAULT_REF ? null : ref);
    setAppRefState(ref);
  }, []);
  const setProject = useCallback((id: string | null, ref: ThemeRef | null) => {
    setProjectState((p) => (p.id === id && p.ref === ref ? p : { id, ref: id ? ref : null }));
  }, []);
  const live = useCallback((ref: ThemeRef, data: ThemeData) => {
    if (ref === current.current.activeRef) apply(ref, current.current.activeProject, data);
  }, []);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({ appRef, projectRef: project.ref, activeRef, setAppRef, setProject, live, reload }),
    [appRef, project.ref, activeRef, setAppRef, setProject, live, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const isBuiltin = (ref: ThemeRef) => ref.startsWith(BUILTIN_PREFIX);
