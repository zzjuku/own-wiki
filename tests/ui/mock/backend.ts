// In-memory stand-in for the Rust commands (src-tauri/src/lib.rs), so the UI
// runs in a plain browser under Playwright. It mirrors the real behaviour only
// as far as the smoke tests need; file rules themselves are tested in Rust.
import type {
  Backlink, CategoryInfo, Field, Infobox, PageInfo, ProjectSettings, Template,
} from "../../../src/api";
import type { ThemeData } from "../../../src/themes/engine";

export interface MockPage {
  id: string;
  title: string;
  aliases?: string[];
  body?: string;
  infobox?: Infobox | null;
  categories?: string[];
  sort?: string | null;
}

export interface Fixture {
  /** null = no library folder chosen yet (welcome screen). */
  libraryPath?: string | null;
  projects?: {
    id: string;
    name: string;
    mainPage?: string | null;
    pages?: MockPage[];
    templates?: Template[];
    groups?: string[];
    settings?: ProjectSettings;
    themes?: Record<string, ThemeData>;
  }[];
  /** App-wide themes by folder name, and the chosen one ("app:<id>"). */
  themes?: Record<string, ThemeData>;
  appTheme?: string | null;
}

interface Project {
  id: string;
  name: string;
  mainPage: string | null;
  pages: Map<string, Required<MockPage>>;
  groups: Set<string>;
  templates: Template[];
  catTexts: Map<string, { name: string; text: string; parents: string[] }>;
  settings: ProjectSettings;
  frame: { width: number; height: number };
  themes: Map<string, ThemeData>;
}

class CommandError {
  constructor(public kind: string, public message: string) {}
}

const lc = (s: string) => s.toLowerCase();
const parent = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");
const LINK = /\[\[([^\]|#]*)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
/** `{{Page…}}` lines: indent, page, the rest (`#Section`, `|infobox`). */
const EMBED = /^( {0,3})\{\{([^{}|#\n]+)([^{}\n]*)\}\}[ \t]*$/gm;

function fullPage(p: MockPage): Required<MockPage> {
  return { aliases: [], body: "", infobox: null, categories: [], sort: null, ...p };
}

export function createBackend(fixture: Fixture) {
  let libraryPath = fixture.libraryPath === undefined ? "/Library" : fixture.libraryPath;
  const projects = new Map<string, Project>();
  const addProject = (f: NonNullable<Fixture["projects"]>[number]) => {
    const p: Project = {
      id: f.id, name: f.name, mainPage: f.mainPage ?? null,
      pages: new Map((f.pages ?? []).map((pg) => [pg.id, fullPage(pg)])),
      groups: new Set(f.groups ?? []), templates: f.templates ?? [],
      catTexts: new Map(), settings: f.settings ?? { hideCategoryBox: false }, frame: { width: 250, height: 300 },
      themes: new Map(Object.entries(f.themes ?? {})),
    };
    projects.set(p.id, p);
    return p;
  };
  (fixture.projects ?? []).forEach(addProject);
  /** Last file path the open-file dialog returns. */
  let nextOpen: string | null = null;
  const appThemes = new Map<string, ThemeData>(Object.entries(fixture.themes ?? {}));
  let appTheme: string | null = fixture.appTheme ?? null;
  const themeStore = (project: string | null) => (project ? proj(project).themes : appThemes);
  const theme = (store: Map<string, ThemeData>, id: string) => {
    const t = store.get(id);
    if (!t) throw new CommandError("notFound", `Theme not found: ${id}`);
    return t;
  };
  const themeFree = (store: Map<string, ThemeData>, name: string, except?: string) => {
    if ([...store].some(([id, t]) => id !== except && lc(t.name) === lc(name.trim())))
      throw new CommandError("exists", `A theme named "${name.trim()}" already exists here.`);
  };

  const proj = (id: string) => {
    const p = projects.get(id);
    if (!p) throw new CommandError("notFound", `Project ${id} not found.`);
    return p;
  };
  const page = (p: Project, id: string) => {
    const pg = p.pages.get(id);
    if (!pg) throw new CommandError("notFound", `Page ${id} not found.`);
    return pg;
  };
  const info = (pg: Required<MockPage>): PageInfo => ({ id: pg.id, title: pg.title, group: parent(pg.id), aliases: pg.aliases });
  const findTitle = (p: Project, name: string) =>
    [...p.pages.values()].find((pg) => lc(pg.title) === lc(name) || pg.aliases.some((a) => lc(a) === lc(name)));
  const checkFree = (p: Project, name: string, except?: string) => {
    const other = findTitle(p, name);
    if (other && other.id !== except) throw new CommandError("exists", `"${other.title}" already exists.`);
  };
  const fieldTargets = (ib: Infobox | null) =>
    (ib?.fields ?? []).filter((f) => f.type === "link" || f.type === "links")
      .flatMap((f) => (Array.isArray(f.value) ? f.value : f.value ? [f.value] : []) as string[]);

  // Categories: a category exists while a page, template, subcategory or its own text uses it.
  function categories(p: Project): Map<string, CategoryInfo & { members: Required<MockPage>[] }> {
    const m = new Map<string, CategoryInfo & { members: Required<MockPage>[] }>();
    const note = (name: string) => {
      if (!m.has(lc(name))) m.set(lc(name), { name, pages: 0, subcategories: 0, parents: [], hasFile: false, members: [] });
      return m.get(lc(name))!;
    };
    for (const c of p.catTexts.values()) Object.assign(note(c.name), { hasFile: true, parents: c.parents });
    for (const c of p.catTexts.values()) c.parents.forEach((x) => note(x).subcategories++);
    for (const pg of p.pages.values()) for (const c of pg.categories) note(c).members.push(pg);
    for (const t of p.templates) (t.categories ?? []).forEach(note);
    for (const c of m.values()) c.pages = c.members.length;
    return m;
  }
  const catInfo = ({ members: _, ...c }: CategoryInfo & { members: unknown }) => c;
  const spell = (p: Project, name: string) => categories(p).get(lc(name))?.name ?? name;

  function backlinks(p: Project, name: string, isCategory: boolean): Backlink[] {
    const out: Backlink[] = [];
    const target = findTitle(p, name);
    const names = isCategory ? [`category:${lc(name)}`] : target ? [lc(target.title), ...target.aliases.map(lc)] : [lc(name)];
    for (const pg of p.pages.values()) {
      const lines = pg.body.split("\n").filter((line) =>
        [...line.matchAll(LINK)].some((l) => names.includes(lc(l[1].trim()).replace(/^category:\s*/, "category:"))));
      const fields = (pg.infobox?.fields ?? []).filter((f) => fieldTargets({ fields: [f] }).some((t) => names.includes(lc(t)))).map((f) => f.label);
      if (lines.length || fields.length) out.push({ id: pg.id, title: pg.title, group: parent(pg.id), via: [], lines, fields });
    }
    return out;
  }

  const commands: Record<string, (a: any) => unknown> = {
    get_settings: () => ({ libraryPath }),
    set_library_path: ({ path }) => ((libraryPath = path), { libraryPath }),
    list_projects: () => [...projects.values()].map((p) => ({ id: p.id, name: p.name })),
    create_project: ({ name }) => {
      if (projects.has(name)) throw new CommandError("exists", `A project named "${name}" already exists.`);
      addProject({ id: name, name, mainPage: "Main Page", pages: [{ id: "Main Page.md", title: "Main Page" }] });
      return { id: name, name };
    },
    rename_project: ({ id, name }) => {
      const p = proj(id);
      projects.delete(id);
      Object.assign(p, { id: name, name });
      projects.set(name, p);
      return { id: name, name };
    },
    delete_project: ({ id }) => void projects.delete(id),

    get_tree: ({ project }) => {
      const p = proj(project);
      return {
        groups: [...p.groups].map((id) => ({ id, name: id.split("/").pop() })),
        pages: [...p.pages.values()].map(info),
        mainPage: p.mainPage,
      };
    },
    create_page: ({ project, group, title, template }) => {
      const p = proj(project);
      title = title.trim();
      if (!title) throw new CommandError("invalid", "Titles can't be empty.");
      if (/[[\]|#]/.test(title)) throw new CommandError("invalid", "Titles can't contain [ ] | or #.");
      checkFree(p, title);
      const id = (group ? `${group}/` : "") + `${title}.md`;
      const t = template ? p.templates.find((x) => x.id === template) : undefined;
      p.pages.set(id, fullPage({
        id, title,
        body: t?.starterText ?? "",
        categories: [...(t?.categories ?? [])],
        infobox: t
          ? { template: t.id, color: t.color ?? null, ownColor: false, fields: t.fields.map(({ value: _, ...f }) => f as Field), hidden: [] }
          : null,
      }));
      return info(page(p, id));
    },
    read_page: ({ project, id }) => {
      const pg = page(proj(project), id);
      return { ...info(pg), body: pg.body, infobox: pg.infobox, infoboxError: null, categories: pg.categories, sort: pg.sort };
    },
    save_page: ({ project, id, body }) => void (page(proj(project), id).body = body),
    rename_page: ({ project, id, title, keepAlias }) => {
      const p = proj(project);
      const pg = page(p, id);
      checkFree(p, title, id);
      const old = pg.title;
      let links = 0;
      const pagesChanged = new Set<string>();
      for (const other of p.pages.values()) {
        other.body = other.body.replace(LINK, (all, target: string, section = "", text = "") => {
          if (lc(target.trim()) !== lc(old)) return all;
          links++;
          pagesChanged.add(other.id);
          return `[[${title}${section}${text}]]`;
        });
        other.body = other.body.replace(EMBED, (all, indent: string, target: string, rest: string) => {
          if (lc(target.trim()) !== lc(old)) return all;
          links++;
          pagesChanged.add(other.id);
          return `${indent}{{${title}${rest}}}`;
        });
      }
      p.pages.delete(id);
      const newId = (parent(id) ? `${parent(id)}/` : "") + `${title}.md`;
      Object.assign(pg, { id: newId, title, aliases: keepAlias ? [...pg.aliases, old] : pg.aliases });
      p.pages.set(newId, pg);
      if (p.mainPage && lc(p.mainPage) === lc(old)) p.mainPage = title;
      return { page: info(pg), links, pages: pagesChanged.size, failed: [] };
    },
    move_page: ({ project, id, target }) => {
      const p = proj(project);
      const pg = page(p, id);
      p.pages.delete(id);
      pg.id = (target ? `${target}/` : "") + id.split("/").pop();
      p.pages.set(pg.id, pg);
      return info(pg);
    },
    delete_page: ({ project, id }) => void proj(project).pages.delete(id),
    set_aliases: ({ project, id, aliases }) => {
      const p = proj(project);
      aliases.forEach((a: string) => checkFree(p, a, id));
      const pg = page(p, id);
      pg.aliases = aliases;
      return info(pg);
    },
    set_main_page: ({ project, title }) => void (proj(project).mainPage = title),
    save_infobox: ({ project, id, infobox }) => void (page(proj(project), id).infobox = infobox),
    import_image: ({ path }) => path.split("/").pop(),
    import_image_data: () => "Pasted image.png",
    get_project_settings: ({ project }) => proj(project).settings,
    set_project_settings: ({ project, settings }) => void (proj(project).settings = settings),
    get_image_frame: ({ project }) => proj(project).frame,
    set_image_frame: ({ project, frame }) => void (proj(project).frame = frame),

    get_templates: ({ project }) => proj(project).templates,
    set_templates: ({ project, templates }) => void (proj(project).templates = templates),
    template_pages: ({ project, id }) =>
      [...proj(project).pages.values()].filter((pg) => pg.infobox?.template === id).map(info),
    apply_template: () => ({ changes: [], failed: [] }),
    incoming_fields: () => [],

    list_categories: ({ project }) => [...categories(proj(project)).values()].map(catInfo),
    category_page: ({ project, name, includeSub }) => {
      const p = proj(project);
      const all = categories(p);
      const c = all.get(lc(name));
      if (!c) return { name, exists: false, text: "", parents: [], subcategories: [], pages: [] };
      const subs = [...all.values()].filter((x) => x.parents.some((y) => lc(y) === lc(c.name)));
      const members = new Set(c.members);
      if (includeSub) subs.forEach((s) => s.members.forEach((m) => members.add(m)));
      return {
        name: c.name, exists: true, text: p.catTexts.get(lc(name))?.text ?? "", parents: c.parents,
        subcategories: subs.map(catInfo),
        pages: [...members].map((m) => ({ id: m.id, title: m.title, group: parent(m.id), sort: m.sort })),
      };
    },
    set_page_categories: ({ project, id, categories: cats }) => {
      const p = proj(project);
      const seen = new Set<string>();
      const list = (cats as string[]).map((c) => c.trim().replace(/^category\s*:\s*/i, ""))
        .filter((c) => c && !seen.has(lc(c)) && seen.add(lc(c))).map((c) => spell(p, c));
      page(p, id).categories = list;
      return list;
    },
    set_page_sort: ({ project, id, sort }) => void (page(proj(project), id).sort = sort),
    create_category: ({ project, name }) => {
      const p = proj(project);
      name = name.trim().replace(/^category\s*:\s*/i, "");
      if (!p.catTexts.has(lc(name))) p.catTexts.set(lc(name), { name: spell(p, name), text: "", parents: [] });
      return spell(p, name);
    },
    save_category_text: ({ project, name, text }) => {
      const p = proj(project);
      const c = p.catTexts.get(lc(name)) ?? { name: spell(p, name), text: "", parents: [] };
      p.catTexts.set(lc(name), { ...c, text });
    },
    set_category_parents: ({ project, name, parents }) => {
      const p = proj(project);
      if ((parents as string[]).some((x) => lc(x) === lc(name))) throw new CommandError("invalid", "A category can't be inside itself.");
      const c = p.catTexts.get(lc(name)) ?? { name: spell(p, name), text: "", parents: [] };
      p.catTexts.set(lc(name), { ...c, parents: parents.map((x: string) => spell(p, x)) });
      return p.catTexts.get(lc(name))!.parents;
    },
    change_category: ({ project, name, newName, dryRun }) => {
      const p = proj(project);
      const members = [...p.pages.values()].filter((pg) => pg.categories.some((c) => lc(c) === lc(name)));
      if (!dryRun) {
        for (const pg of members) {
          pg.categories = pg.categories.flatMap((c) => (lc(c) === lc(name) ? (newName ? [newName] : []) : [c]));
        }
        const own = p.catTexts.get(lc(name));
        p.catTexts.delete(lc(name));
        if (own && newName) p.catTexts.set(lc(newName), { ...own, name: newName });
      }
      return { pages: members.length, subcategories: 0, links: 0, linkingPages: 0, templates: 0, failed: [] };
    },
    category_backlinks: ({ project, name }) => backlinks(proj(project), name, true),
    category_preview: ({ project, name }) => {
      const p = proj(project);
      const c = categories(p).get(lc(name));
      return c
        ? { name: c.name, exists: true, text: p.catTexts.get(lc(name))?.text ?? "", pages: c.pages, subcategories: c.subcategories }
        : { name, exists: false, text: "", pages: 0, subcategories: 0 };
    },

    page_sections: ({ project, id }) =>
      page(proj(project), id).body.split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => {
        const text = l.replace(/^#+ /, "");
        return { anchor: lc(text).replace(/ /g, "-"), text, level: l.indexOf(" ") };
      }),
    link_preview: ({ project, id }) => {
      const pg = page(proj(project), id);
      const text = pg.body.split("\n\n").find((b) => b.trim() && !b.startsWith("#")) ?? "";
      return { title: pg.title, group: parent(pg.id), text, section: null, image: null };
    },
    backlinks: ({ project, id }) => backlinks(proj(project), page(proj(project), id).title, false),
    embedded_in: ({ project, id }) => {
      const p = proj(project);
      const names = [page(p, id).title, ...page(p, id).aliases].map(lc);
      return [...p.pages.values()]
        .filter((pg) => pg.id !== id && [...pg.body.matchAll(EMBED)].some((m) => names.includes(lc(m[2].trim()))))
        .map((pg) => ({ id: pg.id, title: pg.title, group: parent(pg.id), category: false }));
    },
    embed_sources: ({ project, ids }) => {
      const p = proj(project);
      const seen = new Set<string>();
      let level: string[] = ids;
      for (let d = 0; d < 5; d++) {
        const next: string[] = [];
        for (const id of level) {
          const pg = p.pages.get(id);
          if (!pg || seen.has(id)) continue;
          seen.add(id);
          for (const m of pg.body.matchAll(EMBED)) {
            const t = [...p.pages.values()].find((x) => [x.title, ...x.aliases].map(lc).includes(lc(m[2].trim())));
            if (t) next.push(t.id);
          }
        }
        level = next;
      }
      return [...seen].map((id) => {
        const pg = page(p, id);
        return { id, title: pg.title, body: pg.body, infobox: pg.infobox };
      });
    },
    link_count: ({ project, name }) => {
      const b = backlinks(proj(project), name, false);
      return { links: b.reduce((n, x) => n + x.lines.length + x.fields.length, 0), pages: b.length };
    },

    create_group: ({ project, parent: par, name }) => {
      const id = (par ? `${par}/` : "") + name.trim();
      proj(project).groups.add(id);
      return { id, name: name.trim() };
    },
    rename_group: ({ project, id, name }) => {
      const p = proj(project);
      p.groups.delete(id);
      const newId = (parent(id) ? `${parent(id)}/` : "") + name;
      p.groups.add(newId);
      return { id: newId, name };
    },
    move_group: ({ project, id, target }) => {
      const p = proj(project);
      p.groups.delete(id);
      const newId = (target ? `${target}/` : "") + id.split("/").pop();
      p.groups.add(newId);
      return { id: newId, name: id.split("/").pop() };
    },
    delete_group: ({ project, id }) => void proj(project).groups.delete(id),

    // Themes
    list_themes: ({ project }) =>
      [...themeStore(project)].map(([id, t]) => ({ id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)),
    read_theme: ({ project, id }) => JSON.parse(JSON.stringify(theme(themeStore(project), id))),
    create_theme: ({ project, name, data }) => {
      const store = themeStore(project);
      themeFree(store, name);
      const id = name.trim();
      store.set(id, { ...data, name: id });
      return { id, name: id };
    },
    save_theme: ({ project, id, data }) => {
      const store = themeStore(project);
      store.set(id, { ...data, name: theme(store, id).name });
    },
    rename_theme: ({ project, id, name }) => {
      const store = themeStore(project);
      const t = theme(store, id);
      themeFree(store, name, id);
      store.delete(id);
      store.set(name.trim(), { ...t, name: name.trim() });
      return { id: name.trim(), name: name.trim() };
    },
    delete_theme: ({ project, id }) => void themeStore(project).delete(id),
    get_app_theme: () => appTheme,
    set_app_theme: ({ choice }) => void (appTheme = choice),
    import_font: ({ path }) => {
      const file = path.split("/").pop();
      return { family: file.replace(/\.[^.]+$/, "").split("-")[0], file, weight: "400", style: "normal" };
    },
    installed_fonts: () => ["Font A", "Font B"],
    copy_installed_font: ({ family }) => [
      { family, file: `${family} Regular.ttf`, weight: "400", style: "normal" },
      { family, file: `${family} Bold.ttf`, weight: "700", style: "normal" },
    ],
    font_data: () => new ArrayBuffer(0),

    // Plugins
    "plugin:dialog|open": () => nextOpen,
    "plugin:clipboard-manager|read_text": () => "",
    "plugin:opener|open_url": () => undefined,
  };

  return {
    projects,
    appThemes,
    get appTheme() {
      return appTheme;
    },
    setNextOpen: (path: string | null) => void (nextOpen = path),
    handle(cmd: string, args: any): unknown {
      const fn = commands[cmd];
      if (!fn) throw new CommandError("invalid", `mock: no command ${cmd}`);
      return fn(args ?? {});
    },
  };
}
