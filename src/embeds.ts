// Embeds: the content of another page shown inside this one (navboxes, item
// cards, stat blocks), always its current content, never a copy. Looks
// seamless (a small "open page" link shows on hover), or as a collapsible box
// with the page's title as a bar (AWOIAF navbox style). Links inside an embed
// don't count as the host's links (the host's file only holds `{{Page}}`).
// Embeds inside embeds work up to EMBED_DEPTH levels; loops and self-embeds
// show a warning box. Syntax: src/embedSyntax.ts.
import { useEffect, useMemo, useState } from "react";
import { api, type Frame, type Infobox, type Relations } from "./api";
import type { EmbedCall } from "./embedSyntax";
import { embedTargets } from "./embedSyntax";
import { infoboxHtml } from "./infobox";
import { renderPage, sectionSource, type LinkContext, type Rendered } from "./markdown";
import { bottomListsSource, pageListHtml, type ListEnv } from "./pageLists";
import { frameFor, useWiki } from "./wiki";

/** Embeds go this many levels deep (as EMBED_DEPTH in src-tauri/src/relink.rs). */
export const EMBED_DEPTH = 5;

export interface EmbedSource {
  id: string;
  title: string;
  body: string;
  infobox: Infobox | null;
  /** What other pages' fields add to it (its Linked from fields, page lists). */
  relations?: Relations;
}

/** What rendering embeds needs: the embedded pages' content and the host. */
export interface EmbedEnv {
  project: string;
  /** Embedded pages by id (loaded by useEmbedEnv); a missing one is still loading. */
  sources: Map<string, EmbedSource>;
  /** The page (or "category:Name") the embeds are shown in. */
  hostId: string;
  frame: (templateId: string | null | undefined) => Frame;
  /** The project's present day (ages in embedded infoboxes). */
  presentDay?: unknown;
  /** The project's templates (page lists in embedded pages). */
  templates?: import("./api").Template[];
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const SLOT = /<div class="embed-slot" data-slot="(\d+)"><\/div>/g;

/** renderPage, with each embed's content and each page list put in its
 * place. `lists`: the page's infobox and relations, for its page lists (the
 * lists at the bottom are added to the text, so their headings are in Contents). */
export function renderWithEmbeds(
  source: string,
  opts: { lineAnchors?: boolean; tocBox?: boolean; links: LinkContext },
  env: EmbedEnv | null,
  lists: ListEnv | null = null,
): Rendered {
  const counter = { n: 0 };
  return render(source + bottomListsSource(lists, opts.links), opts, env, env ? [env.hostId] : [], counter, lists);
}

const LIST_SLOT = /<div class="pagelist-slot" data-slot="(\d+)"><\/div>/g;

function render(
  source: string,
  opts: { lineAnchors?: boolean; tocBox?: boolean; links: LinkContext },
  env: EmbedEnv | null,
  stack: string[],
  counter: { n: number },
  lists: ListEnv | null,
): Rendered {
  const r = renderPage(source, opts);
  let html = r.html;
  if (r.pageLists.length) html = html.replace(LIST_SLOT, (_, n: string) => pageListHtml(r.pageLists[Number(n)], lists, opts.links));
  if (r.embeds.length) html = html.replace(SLOT, (_, n: string) => embedHtml(r.embeds[Number(n)], opts.links, env, stack, counter));
  return { ...r, html };
}

const warning = (text: string) => `<div class="embed-warning" role="note">⚠ ${escapeHtml(text)}</div>`;

/** One embed as HTML. */
function embedHtml(call: EmbedCall, links: LinkContext, env: EmbedEnv | null, stack: string[], counter: { n: number }): string {
  const target = links.resolve(call.page);
  if (!target) {
    return (
      `<a class="wikilink new embed-missing" href="#" data-target="${escapeHtml(call.page)}">` +
      `<strong>${escapeHtml(call.page)}</strong> doesn't exist yet. Click to create it.</a>`
    );
  }
  const id = target.page.id;
  const title = target.page.title;
  if (stack.includes(id)) {
    return warning(id === stack[0] ? `This page can't embed itself (${title}).` : `${title} isn't shown here: it would embed itself in a loop.`);
  }
  if (stack.length > EMBED_DEPTH) return warning(`${title} isn't shown here: embeds go only ${EMBED_DEPTH} levels deep.`);
  const src = env?.sources.get(id);
  if (!src) return `<div class="embed embed-loading" aria-busy="true"></div>`;

  const inner = [...stack, id];
  // Page lists in an embedded page list what points to that page.
  const lists: ListEnv = { infobox: src.infobox, relations: src.relations, templates: env?.templates ?? [] };
  const box = (ib: Infobox | null) =>
    infoboxHtml(ib, { project: env!.project, title: src.title, links, relations: src.relations, presentDay: env!.presentDay, frame: env!.frame(ib?.template) });
  let content: string;
  if (call.infobox) {
    content = box(src.infobox) || warning(`${title} has no infobox to show.`);
  } else if (call.section) {
    const text = sectionSource(src.body, call.section);
    content = text === null ? warning(`${title} has no section “${call.section}”.`) : render(text, { tocBox: false, links }, env, inner, counter, lists).html;
  } else {
    content = box(src.infobox) + render(src.body + bottomListsSource(lists, links), { tocBox: false, links }, env, inner, counter, lists).html;
  }
  const link = (cls: string, text: string) =>
    `<a class="wikilink ${cls}" href="#" data-page="${escapeHtml(id)}" data-target="${escapeHtml(title)}"${call.section ? ` data-section="${escapeHtml(call.section)}"` : ""}>${text}</a>`;
  const own = ownIds(content, `e${++counter.n}-`);
  if (call.box) {
    // Clicking the bar shows or hides the box; the title opens the page.
    return (
      `<details class="embed embed-box" data-embed="${escapeHtml(id)}"${call.box === "open" ? " open" : ""}>` +
      `<summary class="embed-box-title">${link("embed-box-link", escapeHtml(title))}<span class="embed-box-toggle"></span></summary>` +
      `<div class="embed-box-body">${own}</div></details>`
    );
  }
  return `<div class="embed" data-embed="${escapeHtml(id)}">${link("embed-open", `${escapeHtml(title)} ↗`)}${own}</div>`;
}

/** Embedded HTML mustn't reuse the host's ids: headings lose theirs (they
 * aren't in the host's Contents), footnotes get a prefix, heading spoilers
 * lose their shared keys. */
function ownIds(html: string, prefix: string): string {
  return html
    .replace(/<(h[1-6]) id="[^"]*">/g, "<$1>")
    .replace(/ data-sp="h:[^"]*"/g, "")
    .replace(/(id|href)="(#?)(cite-(?:ref|note)-[^"]*)"/g, `$1="$2${prefix}$3"`);
}

/** Loads the pages `text` embeds (and what they embed), again whenever the
 * embeds or the project's pages change. */
export function useEmbedEnv(text: string, hostId: string): EmbedEnv | null {
  const wiki = useWiki();
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const name of embedTargets(text)) {
      const t = wiki.names.resolve(name);
      if (t) set.add(t.page.id);
    }
    return [...set].sort().join("\n");
  }, [text, wiki.names]);
  const [sources, setSources] = useState<Map<string, EmbedSource> | null>(null);
  useEffect(() => {
    if (!ids) return setSources(null);
    let live = true;
    api.embedSources(wiki.project, ids.split("\n")).then(
      (list) => live && setSources(new Map(list.map((s) => [s.id, s]))),
      () => live && setSources(new Map()),
    );
    return () => {
      live = false;
    };
  }, [ids, wiki.project, wiki.names]);
  return useMemo(
    () => (ids ? { project: wiki.project, sources: sources ?? new Map(), hostId, frame: (t) => frameFor(wiki, t), presentDay: wiki.settings.presentDay, templates: wiki.templates } : null),
    [ids, sources, wiki, hostId],
  );
}
