// In-memory stand-in for the Rust commands (src-tauri/src/lib.rs), so the UI
// runs in a plain browser under Playwright. It mirrors the real behaviour only
// as far as the smoke tests need; file rules themselves are tested in Rust.
import type {
  Backlink, CategoryInfo, Conflict, ConflictSide, Field, FilesChanged, IncomingField, Infobox, OpenMarker, PageInfo, ProjectSettings,
  Relations, Template,
} from "../../../src/api";
import type { GraphData, GraphLink } from "../../../src/graph/model";
import type { ThemeData } from "../../../src/themes/engine";
import { familyData, linkFieldNames } from "./family";
import { search } from "./search";

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
    /** Conflict pairs (M10) with both files' contents. */
    conflicts?: MockConflict[];
    /** Other computers that have the project open (M10). */
    openElsewhere?: OpenMarker[];
  }[];
  /** App-wide themes by folder name, and the chosen one ("app:<id>"). */
  themes?: Record<string, ThemeData>;
  appTheme?: string | null;
}

export interface MockConflict {
  conflict: Conflict;
  original: ConflictSide;
  copy: ConflictSide;
}

/** A page's version (M10): its revision; `own` = the app wrote that revision itself. */
interface Rev {
  rev: number;
  own: boolean;
}

interface Project {
  conflicts: MockConflict[];
  openElsewhere: OpenMarker[];
  /** Page revisions by page id, and project.json's. */
  revs: Map<string, Rev>;
  projectRev: Rev;
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

/** Data with its fingerprint, left out when the window already has it (like graph.rs / family.rs). */
function fingerprinted<T>(data: T, known: string | null) {
  const hash = String([...JSON.stringify(data)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  return hash === known ? { hash } : { hash, data };
}

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
      conflicts: f.conflicts ?? [], openElsewhere: f.openElsewhere ?? [], revs: new Map(), projectRev: { rev: 1, own: false },
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
  // ---- versions (M10): a save from an older version is refused unless the app wrote what's there now ----
  const revOf = (p: Project, id: string) => {
    if (!p.revs.has(id)) p.revs.set(id, { rev: 1, own: false });
    return p.revs.get(id)!;
  };
  const checkRev = (r: Rev, version: string | null | undefined, what = "This page") => {
    if (version && version !== String(r.rev) && !r.own)
      throw new CommandError("changed", `${what} was changed on another computer (or by another program) since it was opened.`);
  };
  const ownWrite = (r: Rev) => Object.assign(r, { rev: r.rev + 1, own: true });
  /** Versions the user chose not to keep, put in the Trash (for the tests to check). */
  const trashed: string[] = [];
  /** The dragged page edge (a share of the window width), as kept in the library. */
  let pageEdge: number | null = null;
  const marks: string[] = [];
  const info = (pg: Required<MockPage>): PageInfo => ({ id: pg.id, title: pg.title, group: parent(pg.id), aliases: pg.aliases });
  const findTitle = (p: Project, name: string) =>
    [...p.pages.values()].find((pg) => lc(pg.title) === lc(name) || pg.aliases.some((a) => lc(a) === lc(name)));
  const checkFree = (p: Project, name: string, except?: string) => {
    const other = findTitle(p, name);
    if (other && other.id !== except) throw new CommandError("exists", `"${other.title}" already exists.`);
  };
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string");
  /** Links in infobox fields, as the Rust link index has them (src-tauri/src/infobox.rs, field_links). */
  const fieldLinks = (ib: Infobox | null) =>
    (ib?.fields ?? []).flatMap((f) => {
      const spoiler = !!f.spoiler;
      if (["link", "links", "linkedfrom"].includes(f.type))
        return strings(f.value).map((v) => (/\[\[([^\]|#]*)/.exec(v)?.[1] ?? v.split("#")[0]).trim()).filter(Boolean)
          .map((target) => ({ field: f.label, target, twoWay: f.type !== "linkedfrom" && !!f.options?.twoWay, spoiler }));
      if (!["text", "longtext", "list"].includes(f.type)) return [];
      return strings(f.value).flatMap((text) => {
        const hidden = [...text.matchAll(/\|\|[^|\s][^\n]*?\|\|/g)].map((m) => [m.index!, m.index! + m[0].length]);
        return [...text.matchAll(LINK)].map((m) => ({
          field: f.label, target: m[1].trim(), twoWay: false,
          spoiler: spoiler || hidden.some(([a, b]) => a <= m.index! && m.index! + m[0].length <= b),
        }));
      });
    });
  /** Number and date values reverse fields can sort by (not spoilers). */
  const sortValues = (ib: Infobox | null) => {
    const out: Record<string, number[]> = {};
    for (const f of ib?.fields ?? []) {
      const v = f.value as any;
      if (f.spoiler || v === undefined || v === null) continue;
      const point = f.type === "date" ? (v.start ?? v) : null;
      const key = f.type === "number" && typeof v === "number" ? [v] : point && typeof point.year === "number" ? [point.year, point.month ?? 0, point.day ?? 0] : null;
      if (key && !(lc(f.label.trim()) in out)) out[lc(f.label.trim())] = key;
    }
    return out;
  };
  function relations(p: Project, id: string, typed: string[]): Relations {
    const target = page(p, id);
    const names = [target.title, ...target.aliases].map(lc);
    const incoming: IncomingField[] = [];
    for (const pg of p.pages.values()) {
      if (pg.id === id) continue;
      for (const l of fieldLinks(pg.infobox).filter((l) => names.includes(lc(l.target)))) {
        const same = incoming.find((i) => i.id === pg.id && lc(i.field) === lc(l.field));
        if (same) same.spoiler &&= l.spoiler;
        else incoming.push({ field: l.field, id: pg.id, title: pg.title, twoWay: l.twoWay, spoiler: l.spoiler, template: pg.infobox?.template ?? undefined });
      }
    }
    incoming.sort((a, b) => lc(a.title).localeCompare(lc(b.title)));
    const values: Relations["values"] = {};
    const add = (pg: Required<MockPage> | undefined) => {
      const v = pg && sortValues(pg.infobox);
      if (pg && v && Object.keys(v).length) values[pg.id] = v;
    };
    incoming.forEach((i) => add(p.pages.get(i.id)));
    typed.forEach((t) => add(findTitle(p, t.split("#")[0].trim())));
    return { incoming, values };
  }
  const typedOf = (ib: Infobox | null) => (ib?.fields ?? []).filter((f) => f.type === "linkedfrom").flatMap((f) => strings(f.value));

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
      const here = isCategory ? [] : fieldLinks(pg.infobox).filter((l) => names.includes(lc(l.target)));
      const fields = [...new Set(here.filter((l) => !l.spoiler).map((l) => l.field))];
      const spoilerFields = new Set(here.filter((l) => l.spoiler && !fields.includes(l.field)).map((l) => l.field)).size;
      if (lines.length || fields.length || spoilerFields) out.push({ id: pg.id, title: pg.title, group: parent(pg.id), via: [], lines, fields, spoilerFields });
    }
    return out;
  }

  /** The graph's lines, as src-tauri/src/graph.rs makes them. */
  function graphData(p: Project): GraphData {
    const pages = [...p.pages.values()];
    const byName = new Map<string, number>();
    pages.forEach((pg, i) => pg.aliases.forEach((a) => byName.has(lc(a)) || byName.set(lc(a), i)));
    pages.forEach((pg, i) => byName.set(lc(pg.title), i));
    const missing: string[] = [];
    const lines = new Map<string, GraphLink>();
    const nodeOf = (target: string) => {
      const t = target.trim();
      if (!t || /^(category|file):/i.test(t)) return null;
      if (byName.has(lc(t))) return byName.get(lc(t))!;
      let j = missing.findIndex((m) => lc(m) === lc(t));
      if (j < 0) j = missing.push(t) - 1;
      return pages.length + j;
    };
    pages.forEach((pg, from) => {
      const add = (to: number | null, field?: { name: string; spoiler: boolean }) => {
        if (to === null || to === from) return;
        const [a, b] = [Math.min(from, to), Math.max(from, to)];
        const l = lines.get(`${a}:${b}`) ?? { a, b, fields: [] };
        lines.set(`${a}:${b}`, l);
        if (from === a) l.ab = true;
        else l.ba = true;
        if (!field) return void (l.text = true);
        const same = l.fields!.find((f) => lc(f.name) === lc(field.name));
        if (same) same.spoiler = !!same.spoiler && field.spoiler;
        else l.fields!.push(field);
      };
      for (const m of pg.body.matchAll(LINK)) add(nodeOf(m[1]));
      for (const l of fieldLinks(pg.infobox)) add(nodeOf(l.target), { name: l.field, spoiler: l.spoiler });
    });
    return {
      pages: pages.map((pg) => ({ id: pg.id, title: pg.title, aliases: pg.aliases, template: pg.infobox?.template ?? undefined, categories: pg.categories })),
      missing,
      links: [...lines.values()],
    };
  }
  const graphLayouts = new Map<string, unknown>();

  const commands: Record<string, (a: any, options?: { headers?: Record<string, string> }) => unknown> = {
    get_settings: () => ({ libraryPath }),
    set_library_path: ({ path }) => ((libraryPath = path), { libraryPath }),
    move_library: ({ dest, dryRun }) => {
      const old = libraryPath ?? "";
      const target = `${dest}/Own WIKI`;
      if (!dryRun) libraryPath = target;
      return { settings: { libraryPath }, target, old, folders: [...projects.keys(), "_themes"], files: dryRun ? 0 : 3 };
    },
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
        conflicts: p.conflicts.length,
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
      const p = proj(project);
      const pg = page(p, id);
      const version = String(revOf(p, id).rev);
      return { ...info(pg), body: pg.body, infobox: pg.infobox, infoboxError: null, categories: pg.categories, sort: pg.sort, version };
    },
    save_page: ({ project, id, body, version }) => {
      const p = proj(project);
      if (!p.pages.has(id) && version) throw new CommandError("changed", "This was deleted on another computer.");
      checkRev(revOf(p, id), version);
      page(p, id).body = body;
      ownWrite(revOf(p, id));
    },
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
    save_infobox: ({ project, id, infobox, version }) => {
      const p = proj(project);
      if (!p.pages.has(id) && version) throw new CommandError("changed", "This was deleted on another computer.");
      checkRev(revOf(p, id), version);
      page(p, id).infobox = infobox;
      ownWrite(revOf(p, id));
    },
    page_disk_state: ({ project, id, version }) => {
      const p = proj(project);
      if (!p.pages.has(id)) return "deleted";
      const r = revOf(p, id);
      return version === String(r.rev) || r.own ? "same" : "changed";
    },
    keep_mine: ({ project, id, mine }) => {
      const p = proj(project);
      const pg = page(p, id);
      trashed.push(`theirs:${id}:${pg.body}`);
      pg.body = mine.body;
      if (mine.withInfobox) pg.infobox = mine.infobox;
      return String(ownWrite(revOf(p, id)).rev);
    },
    trash_mine: ({ id, mine }) => void trashed.push(`mine:${id}:${mine.body}`),
    trash_text: ({ name, text }) => void trashed.push(`text:${name}:${text}`),
    restore_page: ({ project, id, page: pg }) => {
      const p = proj(project);
      p.pages.set(id, fullPage({ id, title: pg.title, aliases: pg.aliases, body: pg.body, infobox: pg.infobox, categories: pg.categories, sort: pg.sort }));
      p.revs.set(id, { rev: 1, own: true });
      return "1";
    },
    watch_project: () => undefined,
    exit_app: () => undefined,
    get_page_edge: () => pageEdge,
    set_page_edge: ({ edge }) => void (pageEdge = edge),
    unwatch_project: () => undefined,
    open_elsewhere: ({ project }) => proj(project).openElsewhere,
    mark_open: ({ project }) => void marks.push(`open:${project}`),
    mark_closed: ({ project }) => void marks.push(`closed:${project}`),
    conflicts: ({ project }) => proj(project).conflicts.map((c) => c.conflict),
    conflict_side: ({ path }) => {
      for (const p of projects.values())
        for (const c of p.conflicts) {
          if (c.conflict.original === path) return c.original;
          if (c.conflict.copy === path) return c.copy;
        }
      throw new CommandError("notFound", `No file ${path}`);
    },
    resolve_conflict: ({ project, conflict, keep }) => {
      const p = proj(project);
      const c = p.conflicts.find((x) => x.conflict.copy === conflict.copy);
      if (!c) throw new CommandError("notFound", "This conflict is gone.");
      p.conflicts = p.conflicts.filter((x) => x !== c);
      trashed.push(keep === "original" ? `copy:${c.conflict.copy}` : keep === "copy" ? `original:${c.conflict.original}` : `kept both:${c.conflict.copy}`);
    },
    import_image: ({ path }) => path.split("/").pop(),
    import_image_data: () => "Pasted image.png",
    get_project_settings: ({ project }) => ({ ...proj(project).settings, version: String(proj(project).projectRev.rev) }),
    set_project_settings: ({ project, settings }) => {
      const p = proj(project);
      checkRev(p.projectRev, settings.version, "The project settings");
      const { version: _, ...rest } = settings;
      p.settings = rest;
      ownWrite(p.projectRev);
    },
    get_image_frame: ({ project }) => proj(project).frame,
    set_image_frame: ({ project, frame }) => void (proj(project).frame = frame),

    get_templates: ({ project }) => proj(project).templates,
    project_templates: ({ project }) => ({ templates: proj(project).templates, version: String(proj(project).projectRev.rev) }),
    set_templates: ({ project, templates, version }) => {
      const p = proj(project);
      checkRev(p.projectRev, version, "The templates");
      p.templates = templates;
      ownWrite(p.projectRev);
    },
    template_pages: ({ project, id }) =>
      [...proj(project).pages.values()].filter((pg) => pg.infobox?.template === id).map(info),
    apply_template: () => ({ changes: [], failed: [] }),
    relations: ({ project, id, typed }) => relations(proj(project), id, typed ?? []),
    // A simple copy of src-tauri/src/relations.rs (table): Page link and typed-in rows, problems.
    shown_on: ({ project, id }) => {
      // Simplified: two-way Page link fields, and Linked from fields reading this page's Page link fields.
      const p = proj(project);
      const me = page(p, id);
      const out: { id: string; title: string; group: string; shows: string[] }[] = [];
      for (const f of me.infobox?.fields ?? []) {
        if (f.type !== "links" || f.spoiler) continue;
        for (const name of strings(f.value)) {
          const t = findTitle(p, (/\[\[([^\]|#]*)/.exec(name)?.[1] ?? name).trim());
          if (!t || t.id === id) continue;
          const shows = [
            ...(t.infobox?.fields ?? []).filter((g) => g.type === "linkedfrom" && strings(g.options?.from).some((x) => lc(x) === lc(f.label))).map((g) => g.label),
            ...(f.options?.twoWay && (t.infobox?.fields ?? []).some((g) => g.type === "links" && lc(g.label) === lc(f.label)) ? [`${f.label} (two-way)`] : []),
          ];
          if (!shows.length) continue;
          const have = out.find((o) => o.id === t.id);
          if (have) have.shows.push(...shows.filter((x) => !have.shows.includes(x)));
          else out.push({ id: t.id, title: t.title, group: parent(t.id), shows });
        }
      }
      return out;
    },
    relations_table: ({ project }) => {
      const p = proj(project);
      const all = [...p.pages.values()];
      const labels = new Set(all.flatMap((pg) => (pg.infobox?.fields ?? []).filter((f) => f.type !== "heading" && f.type !== "divider").map((f) => lc(f.label))));
      const rows: any[] = [];
      const fieldProblems: any[] = [];
      for (const pg of all) {
        for (const l of fieldLinks(pg.infobox)) {
          const typed = (pg.infobox?.fields ?? []).some((f) => f.label === l.field && f.type === "linkedfrom");
          const inText = (pg.infobox?.fields ?? []).some((f) => f.label === l.field && ["text", "longtext", "list"].includes(f.type));
          const t = findTitle(p, l.target);
          const shows: string[] = [];
          if (t && t.id !== pg.id && !typed) {
            for (const f of t.infobox?.fields ?? []) {
              if (f.type !== "linkedfrom" || !(f.options?.from ?? []).some((x) => lc(x) === lc(l.field))) continue;
              const tpl = f.options?.templates ?? [];
              if (tpl.length && !tpl.includes(pg.infobox?.template ?? "")) continue;
              shows.push(f.options?.show === "list" ? `${f.label} (list)` : f.label);
            }
            if (l.twoWay && (t.infobox?.fields ?? []).some((f) => (f.type === "link" || f.type === "links") && lc(f.label) === lc(l.field))) shows.push(`${l.field} (two-way)`);
          }
          if (inText && !shows.length) continue;
          const problem = typed ? undefined : !t ? `No page “${l.target}” yet (red link).` : !shows.length ? `Doesn't show on ${t.title}: no field there reads “${l.field}”.` : undefined;
          rows.push({
            id: pg.id, title: pg.title, field: l.field, target: l.target, targetId: t?.id, targetTitle: t?.title,
            kind: typed ? "typed" : inText ? "text" : "link", twoWay: l.twoWay, spoiler: l.spoiler,
            shows: typed ? [`${l.field} (typed in here)`] : shows, problem,
          });
        }
        for (const f of pg.infobox?.fields ?? []) {
          const names = f.type === "linkedfrom" ? (f.options?.from ?? []).filter((n) => !labels.has(lc(n))) : [];
          if (names.length) fieldProblems.push({ id: pg.id, title: pg.title, field: f.label, names });
        }
      }
      rows.sort((a, b) => lc(a.title).localeCompare(lc(b.title)) || lc(a.field).localeCompare(lc(b.field)));
      return { rows, fieldProblems };
    },
    set_relation: ({ project, target, field, source, edit }) => {
      const p = proj(project);
      const src = page(p, source);
      const tgt = page(p, target);
      const names = [src.title, ...src.aliases].map(lc);
      const isSource = (v: string) => names.includes(lc((/\[\[([^\]|#]*)/.exec(v)?.[1] ?? v.split("#")[0]).trim()));
      const ib: Infobox = tgt.infobox ?? { fields: [] };
      const f = ib.fields.find((x) => x.type !== "heading" && x.type !== "divider" && lc(x.label.trim()) === lc(field.trim()));
      if (!f) {
        if (edit !== "remove") ib.fields.push({ label: field.trim(), type: "links", value: [src.title] });
      } else {
        if (f.type !== "link" && f.type !== "links")
          throw new CommandError("invalid", `${tgt.title}'s field “${f.label}” isn't a Page link field, so it can't be filled from here.`);
        const current = strings(f.value).filter((v) => v.trim());
        const has = current.some(isSource);
        let next = current;
        if (edit === "add" && !has) {
          if (f.type === "link" && current.length) throw new CommandError("invalid", `${tgt.title}'s ${f.label} holds one page only. Replace it instead.`);
          next = [...current, src.title];
        } else if (edit === "replace") next = [src.title];
        else if (edit === "remove") next = current.filter((v) => !isSource(v));
        f.value = !next.length ? undefined : f.type === "link" ? next[0] : next;
      }
      tgt.infobox = ib;
    },

    search: ({ project, request }) => {
      const p = proj(project);
      return search([...p.pages.values()], [...p.catTexts.values()], request, parent);
    },
    search_prepare: () => undefined,
    graph_data: ({ project, known }) => fingerprinted(graphData(proj(project)), known),
    family_data: ({ project, known }) => fingerprinted(familyData([...proj(project).pages.values()], proj(project).settings), known),
    link_field_names: ({ project }) => linkFieldNames([...proj(project).pages.values()]),
    graph_layout: ({ project }) => graphLayouts.get(project) ?? null,
    save_graph_layout: ({ project, layout }) => void graphLayouts.set(project, layout),
    list_categories: ({ project }) => [...categories(proj(project)).values()].map(catInfo),
    category_page: ({ project, name, includeSub }) => {
      const p = proj(project);
      const all = categories(p);
      const c = all.get(lc(name));
      if (!c) return { name, exists: false, text: "", parents: [], subcategories: [], pages: [], version: null };
      const subs = [...all.values()].filter((x) => x.parents.some((y) => lc(y) === lc(c.name)));
      const members = new Set(c.members);
      if (includeSub) subs.forEach((s) => s.members.forEach((m) => members.add(m)));
      return {
        name: c.name, exists: true, text: p.catTexts.get(lc(name))?.text ?? "", parents: c.parents,
        subcategories: subs.map(catInfo),
        pages: [...members].map((m) => ({ id: m.id, title: m.title, group: parent(m.id), sort: m.sort })),
        version: "1",
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
        return { id, title: pg.title, body: pg.body, infobox: pg.infobox, relations: relations(p, id, typedOf(pg.infobox)) };
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
    create_theme: ({ project, name, data, bundled }) => {
      const store = themeStore(project);
      themeFree(store, name);
      const id = name.trim();
      const fonts = [...(data.fonts ?? []), ...((bundled ?? []) as { family: string; file: string }[]).map((f) => ({ ...f, weight: "400", style: "normal" }))];
      store.set(id, { ...data, fonts, name: id });
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

  /**
   * A change from outside the app (the other computer via Drive): `change`
   * edits the page (null deletes it; `moveTo` moves it). Returns what the file
   * watcher would report.
   */
  function outside(project: string, id: string, change: Partial<MockPage> | null, moveTo?: string): FilesChanged {
    const p = proj(project);
    const report: FilesChanged = {
      project, pages: [], removed: [], groups: false, categories: false, projectFile: false, projectThemes: false, appThemes: false, assets: false,
    };
    if (change === null) {
      p.pages.delete(id);
      report.removed.push(id);
    } else if (moveTo) {
      const pg = page(p, id);
      p.pages.delete(id);
      pg.id = moveTo;
      p.pages.set(moveTo, pg);
      report.removed.push(id);
      report.pages.push(moveTo);
    } else {
      if (p.pages.has(id)) Object.assign(page(p, id), change);
      else p.pages.set(id, fullPage({ id, title: id.replace(/\.md$/, ""), ...change }));
      const r = revOf(p, id);
      Object.assign(r, { rev: r.rev + 1, own: false });
      report.pages.push(id);
    }
    return report;
  }

  return {
    projects,
    graphLayouts,
    appThemes,
    trashed,
    marks,
    outside,
    get appTheme() {
      return appTheme;
    },
    setNextOpen: (path: string | null) => void (nextOpen = path),
    handle(cmd: string, args: any, options?: { headers?: Record<string, string> }): unknown {
      const fn = commands[cmd];
      if (!fn) throw new CommandError("invalid", `mock: no command ${cmd}`);
      return fn(args ?? {}, options);
    },
  };
}
