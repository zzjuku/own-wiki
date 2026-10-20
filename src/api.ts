// Thin typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, ThemeFont } from "./themes/engine";

export interface Settings {
  libraryPath: string | null;
}

export interface ProjectInfo {
  /** Folder name inside the library. */
  id: string;
  name: string;
}

export interface PageInfo {
  /** Path inside the project's pages/ folder, "/"-separated: "Group A/Page A.md". */
  id: string;
  title: string;
  /** Id of the group the page is in; "" = top level. */
  group: string;
  /** Other names that link to the page. */
  aliases: string[];
}

export interface GroupInfo {
  /** Folder path inside pages/: "Group A/Sub". */
  id: string;
  name: string;
}

export interface Tree {
  groups: GroupInfo[];
  pages: PageInfo[];
  /** Title of the project's main page, if set. */
  mainPage?: string | null;
}

export interface Heading {
  /** Section anchor ("early-life"). */
  anchor: string;
  text: string;
  level: number;
}

export interface Preview {
  title: string;
  group: string;
  /** Opening paragraph (or start of the section) as Markdown. */
  text: string;
  /** Heading text of the section shown, if one was asked for and exists. */
  section: string | null;
  /** The page's first infobox image (file inside assets/). */
  image: string | null;
}

export interface Backlink {
  id: string;
  title: string;
  group: string;
  /** Aliases the page links through. */
  via: string[];
  /** Lines containing the links (when asked for). */
  lines: string[];
  /** Infobox fields that link here (not spoiler fields). */
  fields: string[];
  /** How many spoiler fields link here (their names stay hidden). */
  spoilerFields: number;
}

/** A page or category page whose text embeds a page. */
export interface EmbedHost {
  /** Page id, or the category's name. */
  id: string;
  title: string;
  group: string;
  category: boolean;
}

export interface RenameResult {
  page: PageInfo;
  links: number;
  pages: number;
  /** Titles of pages whose links couldn't be updated. */
  failed: string[];
}

export interface LinkCount {
  links: number;
  pages: number;
}

export type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "yesno"
  | "choice"
  | "list"
  | "link"
  | "links"
  | "linkedfrom"
  | "date"
  | "image"
  | "heading"
  | "divider";

/** A field definition, and on pages its value. See src-tauri/src/infobox.rs. */
export interface Field {
  /** Template fields: stable id. Page fields: the template field they came from (absent: the page's own). */
  key?: string;
  label: string;
  type: FieldKind;
  hint?: string;
  /** choices (choice), twoWay (link, links), from/templates/sortBy (linkedfrom), ranges (date). */
  options?: FieldOptions;
  value?: unknown;
  /** Pages only: the value is hidden as a spoiler until clicked. */
  spoiler?: boolean;
  [extra: string]: unknown;
}

export interface FieldOptions {
  choices?: string[];
  twoWay?: boolean;
  /** Linked from: names of the fields (on other pages) that point here. */
  from?: string[];
  /** Linked from: only pages using these templates (ids); none = any page. */
  templates?: string[];
  /** Linked from: sort by this number or date field of the listed pages; none = by title. */
  sortBy?: string;
  ranges?: boolean;
  [extra: string]: unknown;
}

/** Project-wide options stored in project.json (they sync with the project). */
export interface ProjectSettings {
  /** Pages don't show the categories box at the bottom. */
  hideCategoryBox: boolean;
  /** The project's own theme ("builtin:<id>" or "project:<folder>"); null = the app theme. */
  theme?: string | null;
}

export interface ThemeInfo {
  /** Folder name. */
  id: string;
  name: string;
}

/** Width and height of the frame infobox images sit in (CSS pixels). */
export interface Frame {
  width: number;
  height: number;
}

export interface Template {
  id: string;
  name: string;
  color?: string | null;
  starterText?: string;
  /** Own infobox image frame (else the project's). */
  imageFrame?: Frame | null;
  /** Default categories for new pages. */
  categories?: string[];
  fields: Field[];
  [extra: string]: unknown;
}

export interface Infobox {
  /** Id of the template the page came from. */
  template?: string | null;
  color?: string | null;
  /** The page chose its own colour. */
  ownColor?: boolean;
  fields: Field[];
  hidden?: Field[];
  [extra: string]: unknown;
}

export interface IncomingField {
  /** The field's label on the linking page. */
  field: string;
  id: string;
  title: string;
  twoWay: boolean;
  /** Every link from that field to here is hidden as a spoiler. */
  spoiler: boolean;
  /** Template of the linking page's infobox. */
  template?: string;
}

/** What other pages' fields add to a page (Linked from, two-way fields, page lists). */
export interface Relations {
  incoming: IncomingField[];
  /** Page id -> field label (as compared, see norm) -> sort key (number, or year/month/day). */
  values: Record<string, Record<string, number[]>>;
}

/** How setRelation changes the other page's field. */
export type RelationEdit = "add" | "replace" | "remove";

export interface ApplySummary {
  added: number;
  updated: number;
  hidden: number;
  removed: number;
  reordered: boolean;
  color: boolean;
  /** Default categories added. */
  categories: number;
}

export interface ApplyResult {
  changes: { page: PageInfo; summary: ApplySummary }[];
  failed: string[];
}

export interface Page extends PageInfo {
  body: string;
  infobox: Infobox | null;
  /** The file has an infobox this version can't read. */
  infoboxError: string | null;
  categories: string[];
  /** "Sort as" on category pages. */
  sort: string | null;
}

export interface CategoryInfo {
  name: string;
  /** Pages directly in it. */
  pages: number;
  subcategories: number;
  parents: string[];
  /** It has its own file (text or parents). */
  hasFile: boolean;
}

export interface CategoryPage {
  name: string;
  /** False: nothing uses it yet. */
  exists: boolean;
  /** Its own text (Markdown). */
  text: string;
  parents: string[];
  subcategories: CategoryInfo[];
  pages: { id: string; title: string; group: string; sort: string | null }[];
}

export interface CategoryChange {
  pages: number;
  subcategories: number;
  links: number;
  linkingPages: number;
  templates: number;
  failed: string[];
}

export interface CategoryPreview {
  name: string;
  exists: boolean;
  text: string;
  pages: number;
  subcategories: number;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setLibraryPath: (path: string) => invoke<Settings>("set_library_path", { path }),

  listProjects: () => invoke<ProjectInfo[]>("list_projects"),
  createProject: (name: string) => invoke<ProjectInfo>("create_project", { name }),
  renameProject: (id: string, name: string) =>
    invoke<ProjectInfo>("rename_project", { id, name }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  getTree: (project: string) => invoke<Tree>("get_tree", { project }),

  // allowLong: the user agreed to a file path that may be too long for Windows.
  createPage: (project: string, group: string, title: string, allowLong: boolean, template: string | null = null) =>
    invoke<PageInfo>("create_page", { project, group, title, allowLong, template }),
  readPage: (project: string, id: string) => invoke<Page>("read_page", { project, id }),
  savePage: (project: string, id: string, body: string) =>
    invoke<void>("save_page", { project, id, body }),
  renamePage: (project: string, id: string, title: string, allowLong: boolean, keepAlias: boolean) =>
    invoke<RenameResult>("rename_page", { project, id, title, allowLong, keepAlias }),
  movePage: (project: string, id: string, target: string, allowLong: boolean) =>
    invoke<PageInfo>("move_page", { project, id, target, allowLong }),
  deletePage: (project: string, id: string) => invoke<void>("delete_page", { project, id }),
  setAliases: (project: string, id: string, aliases: string[]) =>
    invoke<PageInfo>("set_aliases", { project, id, aliases }),
  setMainPage: (project: string, title: string | null) => invoke<void>("set_main_page", { project, title }),
  saveInfobox: (project: string, id: string, infobox: Infobox | null) =>
    invoke<void>("save_infobox", { project, id, infobox }),
  /** Copies an image file into assets/; `svg`: SVG allowed (page text, galleries). Returns its file name there. */
  importImage: (project: string, path: string, svg: boolean) => invoke<string>("import_image", { project, path, svg }),
  /** Stores a pasted image (bytes) in assets/. */
  importImageData: (project: string, name: string, data: Uint8Array) =>
    invoke<string>("import_image_data", data, {
      headers: { project: encodeURIComponent(project), name: encodeURIComponent(name) },
    }),
  getProjectSettings: (project: string) => invoke<ProjectSettings>("get_project_settings", { project }),
  setProjectSettings: (project: string, settings: ProjectSettings) =>
    invoke<void>("set_project_settings", { project, settings }),
  getImageFrame: (project: string) => invoke<Frame>("get_image_frame", { project }),
  setImageFrame: (project: string, frame: Frame) => invoke<void>("set_image_frame", { project, frame }),

  // Templates
  getTemplates: (project: string) => invoke<Template[]>("get_templates", { project }),
  setTemplates: (project: string, templates: Template[]) => invoke<void>("set_templates", { project, templates }),
  templatePages: (project: string, id: string) => invoke<PageInfo[]>("template_pages", { project, id }),
  applyTemplate: (project: string, id: string, pages: string[] | null, dryRun: boolean) =>
    invoke<ApplyResult>("apply_template", { project, id, pages, dryRun }),
  /** `typed`: names typed into the page's Linked from fields (their sort values come along). */
  relations: (project: string, id: string, typed: string[]) => invoke<Relations>("relations", { project, id, typed }),
  /** Writes page `source` into (or out of) the field named `field` on page `target`. */
  setRelation: (project: string, target: string, field: string, source: string, edit: RelationEdit) =>
    invoke<void>("set_relation", { project, target, field, source, edit }),

  // Categories
  listCategories: (project: string) => invoke<CategoryInfo[]>("list_categories", { project }),
  categoryPage: (project: string, name: string, includeSub: boolean) =>
    invoke<CategoryPage>("category_page", { project, name, includeSub }),
  setPageCategories: (project: string, id: string, categories: string[]) =>
    invoke<string[]>("set_page_categories", { project, id, categories }),
  setPageSort: (project: string, id: string, sort: string | null) => invoke<void>("set_page_sort", { project, id, sort }),
  createCategory: (project: string, name: string) => invoke<string>("create_category", { project, name }),
  saveCategoryText: (project: string, name: string, text: string) =>
    invoke<void>("save_category_text", { project, name, text }),
  setCategoryParents: (project: string, name: string, parents: string[]) =>
    invoke<string[]>("set_category_parents", { project, name, parents }),
  /** Renames (newName) or deletes (null) a category; dryRun only counts. */
  changeCategory: (project: string, name: string, newName: string | null, dryRun: boolean) =>
    invoke<CategoryChange>("change_category", { project, name, newName, dryRun }),
  categoryBacklinks: (project: string, name: string, context: boolean) =>
    invoke<Backlink[]>("category_backlinks", { project, name, context }),
  categoryPreview: (project: string, name: string) => invoke<CategoryPreview>("category_preview", { project, name }),

  // Link index
  pageSections: (project: string, id: string) => invoke<Heading[]>("page_sections", { project, id }),
  linkPreview: (project: string, id: string, section: string | null) =>
    invoke<Preview>("link_preview", { project, id, section }),
  backlinks: (project: string, id: string, context: boolean) =>
    invoke<Backlink[]>("backlinks", { project, id, context }),
  linkCount: (project: string, name: string) => invoke<LinkCount>("link_count", { project, name }),
  embeddedIn: (project: string, id: string) => invoke<EmbedHost[]>("embedded_in", { project, id }),
  /** The pages `ids` embed, and what those embed (up to 5 levels). */
  embedSources: (project: string, ids: string[]) =>
    invoke<{ id: string; title: string; body: string; infobox: Infobox | null; relations: Relations }[]>("embed_sources", { project, ids }),

  // Themes (M8). `project` null = the app-wide themes in the library folder.
  listThemes: (project: string | null) => invoke<ThemeInfo[]>("list_themes", { project }),
  readTheme: (project: string | null, id: string) => invoke<ThemeData>("read_theme", { project, id }),
  /** `from`: the stored theme being copied (its font files come along). */
  createTheme: (project: string | null, name: string, data: ThemeData, from: { project: string | null; id: string } | null) =>
    invoke<ThemeInfo>("create_theme", { project, name, data, from }),
  saveTheme: (project: string | null, id: string, data: ThemeData) => invoke<void>("save_theme", { project, id, data }),
  renameTheme: (project: string | null, id: string, name: string) => invoke<ThemeInfo>("rename_theme", { project, id, name }),
  deleteTheme: (project: string | null, id: string) => invoke<void>("delete_theme", { project, id }),
  /** The app-wide theme in use ("builtin:default", "app:<folder>"). */
  getAppTheme: () => invoke<string | null>("get_app_theme"),
  setAppTheme: (choice: string | null) => invoke<void>("set_app_theme", { choice }),
  importFont: (project: string | null, id: string, path: string) => invoke<ThemeFont>("import_font", { project, id, path }),
  /** Stores font bytes (e.g. a built-in theme's font) in a theme. */
  importFontData: (project: string | null, id: string, name: string, data: Uint8Array) =>
    invoke<ThemeFont>("import_font_data", data, {
      headers: { project: encodeURIComponent(project ?? ""), id: encodeURIComponent(id), name: encodeURIComponent(name) },
    }),
  /** Family names of the fonts installed on this computer. */
  installedFonts: () => invoke<string[]>("installed_fonts"),
  copyInstalledFont: (project: string | null, id: string, family: string) =>
    invoke<ThemeFont[]>("copy_installed_font", { project, id, family }),
  fontData: (project: string | null, id: string, file: string) => invoke<ArrayBuffer>("font_data", { project, id, file }),

  createGroup: (project: string, parent: string, name: string, allowLong: boolean) =>
    invoke<GroupInfo>("create_group", { project, parent, name, allowLong }),
  renameGroup: (project: string, id: string, name: string, allowLong: boolean) =>
    invoke<GroupInfo>("rename_group", { project, id, name, allowLong }),
  moveGroup: (project: string, id: string, target: string, allowLong: boolean) =>
    invoke<GroupInfo>("move_group", { project, id, target, allowLong }),
  deleteGroup: (project: string, id: string) => invoke<void>("delete_group", { project, id }),
};

interface CommandError {
  kind: string;
  message: string;
}

function isCommandError(e: unknown): e is CommandError {
  return typeof e === "object" && e !== null && typeof (e as CommandError).message === "string";
}

/** Rust errors arrive as `{ kind, message }`; anything else gets a generic message. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (isCommandError(e)) return e.message;
  return "Something went wrong.";
}

/** The action was refused because a file path may be too long for Windows; retry with allowLong. */
export function isLongPath(e: unknown): boolean {
  return isCommandError(e) && e.kind === "longPath";
}
