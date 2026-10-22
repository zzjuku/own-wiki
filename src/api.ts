// Thin typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke as invokeRaw, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import type { SavedLayout } from "./graph/controller";
import type { FamilyData, FamilySettings } from "./family/data";
import type { GraphColorRule, GraphData } from "./graph/model";
import type { ThemeData, ThemeFont } from "./themes/engine";

/** Commands after which pages, links, groups or the project settings may have changed (the graph and family trees read them again). */
const CHANGES = new Set([
  "create_page", "save_page", "rename_page", "move_page", "delete_page", "set_aliases", "save_infobox", "apply_template",
  "set_relation", "set_page_categories", "create_category", "set_category_parents", "change_category", "create_group",
  "rename_group", "move_group", "delete_group", "keep_mine", "restore_page", "resolve_conflict", "set_project_settings",
]);

/** Fired after a command that may have changed pages (and on changes from outside, see projectSync). */
export const indexEvents = new EventTarget();
export const notifyIndexChanged = () => indexEvents.dispatchEvent(new Event("changed"));

function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const p = invokeRaw<T>(cmd, args, options);
  return CHANGES.has(cmd) ? p.then((r) => (notifyIndexChanged(), r)) : p;
}

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
  /** Conflict copies waiting to be resolved. */
  conflicts?: number;
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
  | "dateplace"
  | "datetext"
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
  /** Shown in the title area instead of the box: "above"/"below" (text, choice, list), "beside" (image). */
  place?: string;
  /** With place above/below: also keep the field's row in the box. */
  inBox?: boolean;
  /** Date, place / Date, text: several entries (a list). */
  multiple?: boolean;
  /** Date / Date, place: "birth" or "death", for ages ("age 9", "aged 69"). */
  age?: string;
  /** Linked from: "list" = shown as a list at the bottom of the page instead of in the infobox. */
  show?: string;
  /** Linked from shown as a list: its heading (default: the field's label). */
  listHeading?: string;
  ranges?: boolean;
  [extra: string]: unknown;
}

/** Project-wide options stored in project.json (they sync with the project). */
export interface ProjectSettings {
  /** Pages don't show the categories box at the bottom. */
  hideCategoryBox: boolean;
  /** The project's own theme ("builtin:<id>" or "project:<folder>"); null = the app theme. */
  theme?: string | null;
  /** The story's "today", which ages are counted to ({year, month, day, era}). */
  presentDay?: Record<string, unknown> | null;
  /** The graph's colour rules, first match wins (M11). */
  graphColors?: GraphColorRule[];
  /** Which Page link fields make families (M12). */
  familyTree?: FamilySettings | null;
  /** project.json's version when read (sent back when saving). */
  version?: string | null;
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

/** One stored relation in the Relations table (src-tauri/src/relations.rs). */
export interface RelationRow {
  id: string;
  title: string;
  field: string;
  target: string;
  targetId?: string;
  targetTitle?: string;
  /** link: a Page link field; text: a [[link]] in a text field a Linked from field reads; typed: a name typed into a Linked from field. */
  kind: "link" | "text" | "typed";
  twoWay: boolean;
  spoiler: boolean;
  /** Where it shows up on the linked page ("Children", "Spouse (two-way)", "Chapters (list)"). */
  shows: string[];
  problem?: string;
}

export interface RelationsTable {
  rows: RelationRow[];
  /** Linked from fields reading names no field on any page has. */
  fieldProblems: { id: string; title: string; field: string; names: string[] }[];
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
  /** The file's version when read; saves send it back so a file changed on disk isn't overwritten. */
  version: string;
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
  /** Its file's version when read (null without a file). */
  version: string | null;
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
  /** Copies the library's projects and themes into `dest` (or a new "Own WIKI" folder in it) and
   * uses the copy; the originals stay.
   * `dryRun`: only says where it would go (or why it can't). */
  moveLibrary: (dest: string, dryRun: boolean) =>
    invoke<{ settings: Settings; target: string; old: string; folders: string[]; files: number }>("move_library", { dest, dryRun }),

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
  /** `version`: the page's version when loaded (refused with kind "changed" if the file changed since). */
  savePage: (project: string, id: string, body: string, version: string | null) =>
    invoke<void>("save_page", { project, id, body, version }),
  renamePage: (project: string, id: string, title: string, allowLong: boolean, keepAlias: boolean) =>
    invoke<RenameResult>("rename_page", { project, id, title, allowLong, keepAlias }),
  movePage: (project: string, id: string, target: string, allowLong: boolean) =>
    invoke<PageInfo>("move_page", { project, id, target, allowLong }),
  deletePage: (project: string, id: string) => invoke<void>("delete_page", { project, id }),
  setAliases: (project: string, id: string, aliases: string[]) =>
    invoke<PageInfo>("set_aliases", { project, id, aliases }),
  setMainPage: (project: string, title: string | null) => invoke<void>("set_main_page", { project, title }),
  saveInfobox: (project: string, id: string, infobox: Infobox | null, version: string | null) =>
    invoke<void>("save_infobox", { project, id, infobox, version }),
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
  /** The open project's templates with project.json's version (sent back by setTemplates). */
  projectTemplates: (project: string) => invoke<{ templates: Template[]; version: string | null }>("project_templates", { project }),
  setTemplates: (project: string, templates: Template[], version: string | null) =>
    invoke<void>("set_templates", { project, templates, version }),
  templatePages: (project: string, id: string) => invoke<PageInfo[]>("template_pages", { project, id }),
  applyTemplate: (project: string, id: string, pages: string[] | null, dryRun: boolean) =>
    invoke<ApplyResult>("apply_template", { project, id, pages, dryRun }),
  /** `typed`: names typed into the page's Linked from fields (their sort values come along). */
  relations: (project: string, id: string, typed: string[]) => invoke<Relations>("relations", { project, id, typed }),
  /** Pages that show page `id` through relations stored on it (its two-way fields, Linked from fields reading its fields). */
  shownOn: (project: string, id: string) => invoke<ShownOn[]>("shown_on", { project, id }),
  relationsTable: (project: string) => invoke<RelationsTable>("relations_table", { project }),
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
  saveCategoryText: (project: string, name: string, text: string, version: string | null) =>
    invoke<void>("save_category_text", { project, name, text, version }),
  setCategoryParents: (project: string, name: string, parents: string[]) =>
    invoke<string[]>("set_category_parents", { project, name, parents }),
  /** Renames (newName) or deletes (null) a category; dryRun only counts. */
  changeCategory: (project: string, name: string, newName: string | null, dryRun: boolean) =>
    invoke<CategoryChange>("change_category", { project, name, newName, dryRun }),
  categoryBacklinks: (project: string, name: string, context: boolean) =>
    invoke<Backlink[]>("category_backlinks", { project, name, context }),
  categoryPreview: (project: string, name: string) => invoke<CategoryPreview>("category_preview", { project, name }),

  // Sync safety (M10)
  /** Starts watching the project for changes from outside (event "files-changed"). */
  watchProject: (project: string) => invoke<void>("watch_project", { project }),
  unwatchProject: () => invoke<void>("unwatch_project"),
  /** Other computers that have the project open now. */
  openElsewhere: (project: string) => invoke<OpenMarker[]>("open_elsewhere", { project }),
  markOpen: (project: string) => invoke<void>("mark_open", { project }),
  markClosed: (project: string) => invoke<void>("mark_closed", { project }),
  /** Quits the app (after unsaved edits were saved). */
  exitApp: () => invoke<void>("exit_app"),
  /** Has the page's file changed (or gone) since `version` was loaded? */
  pageDiskState: (project: string, id: string, version: string) => invoke<"same" | "changed" | "deleted">("page_disk_state", { project, id, version }),
  /** "Keep mine": the version on disk to the Trash, mine written. Returns the new version. */
  keepMine: (project: string, id: string, mine: MyVersion) => invoke<string>("keep_mine", { project, id, mine }),
  /** "Use the other version": mine to the Trash as a file. */
  trashMine: (project: string, id: string, title: string, mine: MyVersion) => invoke<void>("trash_mine", { project, id, title, mine }),
  /** Puts text the user chose not to keep in the Trash, as a file "<name> (version not kept).md". */
  trashText: (project: string, name: string, text: string) => invoke<void>("trash_text", { project, name, text }),
  /** "Keep it": a page deleted on disk while open, written again. Returns the new version. */
  restorePage: (
    project: string,
    id: string,
    page: { title: string; aliases: string[]; categories: string[]; sort: string | null; infobox: Infobox | null; body: string },
  ) => invoke<string>("restore_page", { project, id, page }),
  conflicts: (project: string) => invoke<Conflict[]>("conflicts", { project }),
  conflictSide: (kind: Conflict["kind"], path: string) => invoke<ConflictSide>("conflict_side", { kind, path }),
  resolveConflict: (project: string, conflict: Conflict, keep: "original" | "copy" | "both") =>
    invoke<void>("resolve_conflict", { project, conflict, keep }),

  // Search (M10)
  search: (project: string, request: SearchRequest) => invoke<SearchResults>("search", { project, request }),
  /** Reads every file into the search index ahead of the first search. */
  searchPrepare: (project: string) => invoke<void>("search_prepare", { project }),

  // Link index
  /** Every page and line for the graph view (M11). */
  graphData: (project: string, known: string | null) => invoke<{ hash: string; data?: GraphData }>("graph_data", { project, known }),
  /** Every family relation (M12). */
  familyData: (project: string, known: string | null) => invoke<{ hash: string; data?: FamilyData }>("family_data", { project, known }),
  /** Names of the fields of these types that pages have. */
  fieldNames: (project: string, kinds: string[]) => invoke<string[]>("field_names", { project, kinds }),
  /** Where the graph's nodes were left on this computer. */
  graphLayout: (project: string) => invoke<SavedLayout | null>("graph_layout", { project }),
  saveGraphLayout: (project: string, layout: SavedLayout) => invoke<void>("save_graph_layout", { project, layout }),

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
  /** `from`: the stored theme being copied (its font files come along); `bundled`: fonts that come with the app (a built-in theme's). */
  createTheme: (
    project: string | null,
    name: string,
    data: ThemeData,
    from: { project: string | null; id: string } | null,
    bundled: { family: string; file: string }[] = [],
  ) => invoke<ThemeInfo>("create_theme", { project, name, data, from, bundled }),
  saveTheme: (project: string | null, id: string, data: ThemeData) => invoke<void>("save_theme", { project, id, data }),
  renameTheme: (project: string | null, id: string, name: string) => invoke<ThemeInfo>("rename_theme", { project, id, name }),
  deleteTheme: (project: string | null, id: string) => invoke<void>("delete_theme", { project, id }),
  /** The app-wide theme in use ("builtin:default", "app:<folder>"). */
  getAppTheme: () => invoke<string | null>("get_app_theme"),
  setAppTheme: (choice: string | null) => invoke<void>("set_app_theme", { choice }),
  /** Where the page's right edge was dragged to, as a share of the window width (0–1; null = the theme's width). Synced. */
  getPageEdge: () => invoke<number | null>("get_page_edge"),
  setPageEdge: (edge: number | null) => invoke<void>("set_page_edge", { edge }),
  importFont: (project: string | null, id: string, path: string) => invoke<ThemeFont>("import_font", { project, id, path }),
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

/** A page that shows another through a relation stored on that other page ("What links here"). */
export interface ShownOn {
  id: string;
  title: string;
  group: string;
  /** Where it shows there: "Children", "Lover (two-way)". */
  shows: string[];
}

/** The open page's unsaved version (M10 edit clash). */
export interface MyVersion {
  body: string;
  infobox: Infobox | null;
  /** False when the infobox couldn't be edited (the file's stays). */
  withInfobox: boolean;
}

/** Another computer that has the project open. */
export interface OpenMarker {
  computer: string;
  /** Open since (ms since 1970). */
  since: number;
  refreshed: number;
}

/** A conflict pair: two files for one page, category, project.json or theme.json. Paths relative to the library. */
export interface Conflict {
  kind: "page" | "category" | "project" | "theme";
  title: string;
  original: string;
  copy: string;
}

export interface ConflictSide {
  text: string;
  infobox: Infobox | null;
  /** Last changed (ms since 1970). */
  modified: number;
}

/** What the file watcher saw change (event "files-changed"). */
export interface FilesChanged {
  project: string;
  /** Page ids changed or added. */
  pages: string[];
  /** Page ids gone (deleted, moved or renamed). */
  removed: string[];
  groups: boolean;
  categories: boolean;
  projectFile: boolean;
  projectThemes: boolean;
  appThemes: boolean;
  assets: boolean;
}

export interface SearchRequest {
  query: string;
  /** The global eye switch: spoiler text is searched (and shown) only when on. */
  spoilers: boolean;
  /** Only pages in this group or its subgroups. */
  group?: string | null;
  category?: string | null;
  /** Template id. */
  template?: string | null;
  /** Results returned in full (the rest are only counted). */
  limit?: number;
}

/** A piece of a result snippet; a hidden spoiler comes without its text. */
export interface SearchPart {
  text: string;
  hit?: boolean;
  spoiler?: boolean;
}

export interface SearchHit {
  kind: "page" | "category";
  /** Page id, or the category's name. */
  id: string;
  title: string;
  group: string;
  count: number;
  /** "Infobox: Born", "Section: Early life", "Text", "Alias"… (not the title). */
  places: { place: string; parts: SearchPart[]; count: number }[];
  morePlaces: number;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  /** The query's words as matched. */
  terms: string[];
}

interface CommandError {
  kind: string;
  message: string;
}

function isCommandError(e: unknown): e is CommandError {
  return typeof e === "object" && e !== null && typeof (e as CommandError).message === "string";
}

/** A save was refused because the file changed (or was deleted) on disk since it was loaded. */
export function isChanged(e: unknown): boolean {
  return isCommandError(e) && e.kind === "changed";
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
