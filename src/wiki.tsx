// What page views and the editor need from the open project to work with
// links: resolving names, following links, and creating pages from red links.
import { createContext, useCallback, useContext, useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Frame, PageInfo, ProjectSettings, Template } from "./api";
import type { CategoryIndex } from "./categories";
import { imageUrl } from "./infobox";
import type { LinkContext } from "./markdown";
import { slugify } from "./markdown";
import type { NameIndex } from "./names";

export interface FollowTarget {
  pageId: string;
  /** Section text as written in the link. */
  section?: string | null;
  /** The alias the link went through ("Redirected from …"). */
  via?: string | null;
}

export interface CreateOptions {
  /** Don't open the new page: stay where you are. */
  stay?: boolean;
  /** Called with the created page (its title may differ from the one suggested). */
  onCreated?: (page: PageInfo) => void;
  /** Template suggested for the new page (else the one of the page the link is on). */
  template?: string | null;
}

export interface Wiki {
  project: string;
  names: NameIndex;
  /** Opens another page (recorded for back/forward). */
  follow: (target: FollowTarget) => void;
  /** A red link was clicked: offer to create the page. `fromPage` decides the suggested group and template. */
  createFromLink: (title: string, fromPage?: string, opts?: CreateOptions) => void;
  /** An open page tells which template its infobox uses (suggested for pages created from it). */
  noteTemplate: (pageId: string, template: string | null) => void;
  /** Every group, in sidebar order, for group drop-downs ("" = top level). */
  groupOptions: { id: string; label: string }[];
  /** The project's templates. */
  templates: Template[];
  /** The project's infobox image frame. */
  imageFrame: Frame;
  setImageFrame: (f: Frame) => void;
  /** The project's categories. */
  categories: CategoryIndex;
  /** Opens a category page (recorded for back/forward). */
  openCategory: (name: string) => void;
  /** A red category link was clicked: make the category and open it. */
  createCategory: (name: string) => void;
  /** Re-reads the category list (after adding or removing categories). */
  reloadCategories: () => void;
  /** Project-wide options (Project settings). */
  settings: ProjectSettings;
}

export const DEFAULT_FRAME: Frame = { width: 250, height: 300 };

/** The frame infobox images sit in on a page from template `templateId`:
 * the template's own size, else the project's. */
export function frameFor(wiki: Wiki, templateId: string | null | undefined): Frame {
  const t = templateId ? wiki.templates.find((x) => x.id === templateId) : undefined;
  return t?.imageFrame ?? wiki.imageFrame;
}

export const WikiContext = createContext<Wiki | null>(null);

export function useWiki(): Wiki {
  const w = useContext(WikiContext);
  if (!w) throw new Error("useWiki outside WikiContext");
  return w;
}

/** Link resolving for rendering the page `currentId` (or the category page `currentCategory`). */
export function useLinkContext(currentId?: string, currentCategory?: string): LinkContext {
  const { names, project, categories } = useWiki();
  return useMemo(
    () => ({
      resolve: (n: string) => names.resolve(n),
      currentId,
      currentCategory,
      image: (file: string, width?: number) => imageUrl(project, file, width),
      category: (name: string) => categories.resolve(name) !== null,
    }),
    [names, currentId, currentCategory, project, categories],
  );
}

/** Scrolls the page (read view or preview) holding `from` to a section; to the top if it has none. */
export function scrollToSection(from: Element, section: string | null | undefined) {
  const root = from.closest(".read-view, .split-preview") ?? from;
  const target = section ? root.querySelector(`[id="${CSS.escape(slugify(section))}"]`) : null;
  if (target) target.scrollIntoView({ block: "start" });
  else root.scrollTop = 0;
}

/** Click handler for rendered page HTML: page links, section links, footnotes
 * and web addresses (which open in the default browser). */
export function useContentClick(currentId?: string) {
  const wiki = useWiki();
  return useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains("catlink")) {
        const name = a.dataset.category ?? "";
        return a.classList.contains("new") ? wiki.createCategory(name) : wiki.openCategory(name);
      }
      if (a.classList.contains("wikilink")) {
        const section = a.dataset.section ?? null;
        if (a.classList.contains("new")) return wiki.createFromLink(a.dataset.target ?? "", currentId);
        const pageId = a.dataset.page;
        if (!pageId || pageId === currentId) return scrollToSection(a, section);
        return wiki.follow({ pageId, section, via: a.dataset.via ?? null });
      }
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        void openUrl(href).catch(() => {});
      } else if (href.startsWith("#")) {
        const target = e.currentTarget.ownerDocument.getElementById(decodeURIComponent(href.slice(1)));
        if (!target) return;
        const heading = target.matches("h1, h2, h3, h4, h5, h6");
        target.scrollIntoView({ block: heading ? "start" : "center" });
        // Briefly highlight where a footnote link landed.
        if (!heading) {
          target.classList.add("flash");
          setTimeout(() => target.classList.remove("flash"), 1500);
        }
      }
    },
    [wiki, currentId],
  );
}
