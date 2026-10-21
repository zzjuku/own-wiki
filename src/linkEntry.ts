// An entry of a Page link field: a page name ("Page A"), or words around a
// link ("Lord [[Page A]] (supposedly)"). The words show only in this page's
// infobox; everything else (relations, What links here, renames) goes by the
// link (src-tauri/src/infobox.rs, link_value_page).

export interface LinkEntry {
  before: string;
  /** The page as written, with a section if any ("Page A#Early life"). */
  page: string;
  after: string;
}

const WITH_WORDS = /^([\s\S]*?)\[\[([^[\]|]*)(?:\|[^\]]*)?\]\]([\s\S]*)$/;

export function parseLinkEntry(s: string): LinkEntry {
  const m = WITH_WORDS.exec(s);
  return m ? { before: m[1].trim(), page: m[2].trim(), after: m[3].trim() } : { before: "", page: s.trim(), after: "" };
}

/** Words after the link start without a space when they begin with punctuation ("Page A, the Elder"). */
const TIGHT = /^[,.;:!?)\]]/;

export function joinLinkEntry({ before, page, after }: LinkEntry): string {
  const b = before.trim();
  const a = after.trim();
  if (!b && !a) return page;
  return `${b ? `${b} ` : ""}[[${page}]]${a ? (TIGHT.test(a) ? a : ` ${a}`) : ""}`;
}

/** The page an entry links to (no section). */
export const entryPage = (s: string) => parseLinkEntry(s).page.split("#")[0].trim();

/** The entry has words around its link. */
export const hasWords = (s: string) => WITH_WORDS.test(s);
