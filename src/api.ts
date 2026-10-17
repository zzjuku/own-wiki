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
  /** File name inside the project's pages/ folder. */
  id: string;
  title: string;
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

  listPages: (project: string) => invoke<PageInfo[]>("list_pages", { project }),
  createPage: (project: string, title: string) =>
    invoke<PageInfo>("create_page", { project, title }),
  readPage: (project: string, id: string) => invoke<Page>("read_page", { project, id }),
  savePage: (project: string, id: string, body: string) =>
    invoke<void>("save_page", { project, id, body }),
  renamePage: (project: string, id: string, title: string) =>
    invoke<PageInfo>("rename_page", { project, id, title }),
  deletePage: (project: string, id: string) => invoke<void>("delete_page", { project, id }),
};

/** Rust errors arrive as plain strings; anything else gets a generic message. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
