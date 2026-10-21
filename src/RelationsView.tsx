// The Relations screen (M9): every relation stored in the project's
// infoboxes, where each one shows up, and what doesn't work, to check that
// relations are set up right. Spoiler fields stay hidden (click to show).
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type RelationRow, type RelationsTable } from "./api";
import { useSpoilerReveal } from "./spoilers";
import { compareNames } from "./tree";
import { useWiki } from "./wiki";
import { norm } from "./wikilinks";

/** Rows shown at first; more on request (big projects have thousands). */
const PAGE = 500;

const KIND_TEXT: Record<RelationRow["kind"], string> = {
  link: "",
  text: "link in a text field",
  typed: "typed in",
};

export function RelationsView({ openPage }: { openPage: (id: string) => void }) {
  const wiki = useWiki();
  const [table, setTable] = useState<RelationsTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [field, setField] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const ref = useRef<HTMLDivElement>(null);
  const spoilers = useSpoilerReveal(ref);

  useEffect(() => {
    let live = true;
    api.relationsTable(wiki.project).then(
      (t) => live && setTable(t),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [wiki.project, wiki.names]);

  const fields = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of table?.rows ?? []) if (!r.spoiler) m.set(norm(r.field), r.field);
    return [...m.values()].sort(compareNames);
  }, [table]);

  const rows = useMemo(() => {
    const q = norm(filter);
    return (table?.rows ?? []).filter(
      (r) =>
        (!problemsOnly || r.problem) &&
        (!field || (!r.spoiler && norm(r.field) === norm(field))) &&
        // A hidden (spoiler) row matches only by its own page, so filtering never gives it away.
        (!q || norm(r.title).includes(q) || (!r.spoiler && (norm(r.targetTitle ?? r.target).includes(q) || norm(r.field).includes(q)))),
    );
  }, [table, filter, field, problemsOnly]);
  const problems = (table?.rows ?? []).filter((r) => r.problem).length + (table?.fieldProblems.length ?? 0);

  const hide = (r: RelationRow, html: React.ReactNode) =>
    r.spoiler ? (
      <span className="spoiler" title="Spoiler: click to show">
        {html}
      </span>
    ) : (
      html
    );
  const pageButton = (id: string | undefined, title: string) =>
    id ? (
      <button className="plain relations-page" onClick={() => openPage(id)}>
        {title}
      </button>
    ) : (
      <span className="relations-page missing">{title}</span>
    );

  return (
    <div className="page relations-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Relations</h1>
        </div>
        <div className="spacer" />
        {table && (
          <span className="muted small">
            {table.rows.length === 1 ? "1 relation" : `${table.rows.length} relations`}
            {problems > 0 && ` · ${problems === 1 ? "1 problem" : `${problems} problems`}`}
          </span>
        )}
      </header>
      <div className="relations-body" ref={ref} onClickCapture={spoilers.onClick}>
        <p className="hint">
          Every relation stored in an infobox (a page in a Page link field, or a name typed into a Linked from field), and where it
          shows up on the other page. Links in text fields are listed where a Linked from field reads them.
        </p>
        {error && <p className="dialog-error">{error}</p>}
        {table && table.fieldProblems.length > 0 && (
          <div className="relations-field-problems" role="alert">
            <strong>Linked from fields that read names no field has:</strong>
            <ul>
              {table.fieldProblems.map((p) => (
                <li key={`${p.id}\n${p.field}`}>
                  {pageButton(p.id, p.title)} · {p.field} reads {p.names.map((n) => `“${n}”`).join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="relations-filters">
          <input
            className="categories-filter"
            placeholder="Filter by page or field…"
            aria-label="Filter relations"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(PAGE);
            }}
          />
          <select aria-label="Field" value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">All fields</option>
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
            <span>Only problems</span>
          </label>
        </div>
        {table && rows.length === 0 && (
          <p className="empty small">{table.rows.length ? "No relation matches." : "No relations yet. Fill in Page link fields in infoboxes."}</p>
        )}
        {rows.length > 0 && (
          <table className="relations-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Field</th>
                <th>Points to</th>
                <th>Shows up as</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r, i) => (
                <tr key={i} className={r.problem ? "has-problem" : ""}>
                  <td>{pageButton(r.id, r.title)}</td>
                  <td>
                    {hide(r, r.field)}
                    {KIND_TEXT[r.kind] && <span className="muted small"> · {KIND_TEXT[r.kind]}</span>}
                    {r.twoWay && <span className="muted small"> · two-way</span>}
                  </td>
                  <td>{hide(r, pageButton(r.targetId, r.targetTitle ?? r.target))}</td>
                  <td>{r.shows.length ? hide(r, `${r.targetTitle && r.kind !== "typed" ? `${r.targetTitle} → ` : ""}${r.shows.join(", ")}`) : <span className="muted">—</span>}</td>
                  <td className="relations-problem">{r.problem && hide(r, `⚠ ${r.problem}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > limit && (
          <button className="relations-more" onClick={() => setLimit(limit + PAGE)}>
            Show more ({rows.length - limit} left)
          </button>
        )}
      </div>
    </div>
  );
}
