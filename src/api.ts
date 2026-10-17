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
}

export interface Backlink {
  id: string;
  title: string;
  group: string;
  /** Aliases the page links through. */
  via: string[];
  /** Lines containing the links (when asked for). */
  lines: string[];
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

export interface Page extends PageInfo {
  body: string;
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
  createPage: (project: string, group: string, title: string, allowLong: boolean) =>
    invoke<PageInfo>("create_page", { project, group, title, allowLong }),
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
