// Thin typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";

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
  /** Infobox fields that link here. */
  fields: string[];
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
  /** choices (choice), twoWay (link, links), from (linkedfrom), ranges (date). */
  options?: FieldOptions;
  value?: unknown;
  /** Pages only: the value is hidden as a spoiler until clicked. */
  spoiler?: boolean;
  [extra: string]: unknown;
}

export interface FieldOptions {
  choices?: string[];
  twoWay?: boolean;
  from?: string[];
  ranges?: boolean;
  [extra: string]: unknown;
}

/** Project-wide options stored in project.json (they sync with the project). */
export interface ProjectSettings {
  /** Pages don't show the categories box at the bottom. */
  hideCategoryBox: boolean;
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
}

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
  incomingFields: (project: string, id: string) => invoke<IncomingField[]>("incoming_fields", { project, id }),

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
