// "What links here": every page that links to the open page, with the lines
// that contain the links. Clicking an entry opens that page.
import { useEffect, useMemo, useState } from "react";
import { api, errorText, type Backlink } from "./api";
import { renderSnippet } from "./markdown";
import { compareNames, displayGroup } from "./tree";
import { useWiki } from "./wiki";

interface Props {
  /** The page whose links are listed… */
  pageId?: string;
  /** …or the category (links written [[Category:Name]]). */
  category?: string;
  title: string;
  close: () => void;
}

/** A source line as readable text: list, quote and heading markers dropped,
 * table cells joined. */
function cleanLine(line: string): string {
  let t = line.trim().replace(/^(?:>\s?)+/, "").replace(/^#{1,6}\s+/, "").replace(/^(?:[-*+]|\d+[.)])\s+/, "");
  if (t.startsWith("|")) {
    t = t
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim())
      .filter(Boolean)
      .join(" · ");
  }
  // Quote boxes: "<by>…</by>" lines read as "— …".
  t = t.replace(/^<(by|source)>(.*)<\/\1>$/i, "— $2");
  return t.replace(/^\[\^[^\]\s]+\]:\s*/, "");
}

export function Backlinks({ pageId, category, title, close }: Props) {
  const wiki = useWiki();
  const [list, setList] = useState<Backlink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = category !== undefined ? api.categoryBacklinks(wiki.project, category, true) : api.backlinks(wiki.project, pageId ?? "", true);
    load.then(
      (l) => setList([...l].sort((a, b) => compareNames(a.title, b.title))),
      (e) => setError(errorText(e)),
    );
  }, [wiki.project, pageId, category]);

  // Links to this page show in bold in the lines.
  const links = useMemo(
    () => ({
      resolve: (n: string) => wiki.names.resolve(n),
      currentId: pageId,
      currentCategory: category,
      category: (n: string) => wiki.categories.resolve(n) !== null,
    }),
    [wiki.names, wiki.categories, pageId, category],
  );

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide backlinks" role="dialog" aria-label="What links here" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>What links here</h2>
        <p className="muted">
          Pages that link to <strong>{title}</strong>
          {list && ` (${list.length})`}
        </p>
        {error && <p className="dialog-error">{error}</p>}
        {list && list.length === 0 && <p className="empty small">No page links here yet.</p>}
        {list && list.length > 0 && (
          <ul className="backlink-list">
            {list.map((b) => (
              <li key={b.id}>
                <button
                  className="plain backlink"
                  onClick={() => {
                    close();
                    wiki.follow({ pageId: b.id });
                  }}
                >
                  <span className="backlink-head">
                    <span className="backlink-title">{b.title}</span>
                    {b.group && <span className="backlink-group">{displayGroup(b.group)}</span>}
                  </span>
                  {b.via.length > 0 && (
                    <span className="backlink-via">via alias {b.via.map((v) => `“${v}”`).join(", ")}</span>
                  )}
                  {b.fields.length > 0 && (
                    <span className="backlink-via">via infobox: {b.fields.map((f) => `“${f}”`).join(", ")}</span>
                  )}
                  {b.lines.map((line, i) => (
                    <span
                      key={i}
                      className="backlink-line markdown"
                      dangerouslySetInnerHTML={{ __html: renderSnippet(cleanLine(line), links) }}
                    />
                  ))}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="button" className="primary" autoFocus onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
