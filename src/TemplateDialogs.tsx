// Dialogs of the Templates screen: pushing a template's changes to the pages
// created from it ("Apply to existing pages…"), and copying templates from
// another project.
import { useEffect, useMemo, useState } from "react";
import { api, errorText, type ApplyResult, type ApplySummary, type ProjectInfo, type Template } from "./api";
import { newTemplateId } from "./infobox";
import { displayGroup } from "./tree";
import { norm } from "./wikilinks";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "adds 2 fields · hides 1 value · new order" */
export function summaryText(s: ApplySummary): string {
  const parts: string[] = [];
  if (s.added) parts.push(`adds ${plural(s.added, "field")}`);
  if (s.updated) parts.push(`updates ${plural(s.updated, "field")}`);
  if (s.hidden) parts.push(`hides ${plural(s.hidden, "value")}`);
  if (s.removed) parts.push(`removes ${plural(s.removed, "empty field")}`);
  if (s.reordered) parts.push("new order");
  if (s.color) parts.push("new colour");
  if (s.categories) parts.push(`adds ${plural(s.categories, "category", "categories")}`);
  return parts.join(" · ");
}

export function ApplyDialog({
  project,
  template,
  flush,
  close,
  onApplied,
}: {
  project: string;
  template: Template;
  /** Saves pending template edits first. */
  flush: () => Promise<void>;
  close: () => void;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<ApplyResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usingCount, setUsingCount] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await flush();
        const [dry, using] = await Promise.all([
          api.applyTemplate(project, template.id, null, true),
          api.templatePages(project, template.id),
        ]);
        if (!live) return;
        setPreview(dry);
        setUsingCount(using.length);
        setChosen(new Set(dry.changes.map((c) => c.page.id)));
      } catch (e) {
        if (live) setError(errorText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [project, template.id, flush]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.applyTemplate(project, template.id, [...chosen], false);
      setDone(result);
      onApplied();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const changes = preview?.changes ?? [];
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="dialog wide apply-dialog" role="dialog" aria-label="Apply to existing pages" onKeyDown={(e) => e.key === "Escape" && !busy && close()}>
        <h2>Apply “{template.name}” to existing pages</h2>
        {done ? (
          <>
            <p>
              Updated {plural(done.changes.length, "page")}.
              {done.failed.length > 0 && <> These pages couldn't be updated: {done.failed.join(", ")}.</>}
            </p>
            <div className="dialog-actions">
              <button type="button" className="primary" autoFocus onClick={close}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-note">
              Brings the infoboxes of pages created from this template in line with it: new fields are added, changed
              names, types, hints and options are updated, and values of removed fields become hidden values (nothing
              is lost). Fields a page added itself and the page text stay as they are.
            </p>
            {!preview && !error && <p className="muted">Checking pages…</p>}
            {preview && changes.length === 0 && (
              <p className="empty small">
                {usingCount ? `All ${plural(usingCount, "page")} created from this template already match it.` : "No page was created from this template yet."}
              </p>
            )}
            {changes.length > 0 && (
              <>
                <div className="apply-head">
                  <span>
                    {plural(changes.length, "page")} would change{usingCount > changes.length && ` (of ${usingCount} created from it)`}.
                  </span>
                  <div className="spacer" />
                  <button type="button" className="plain" onClick={() => setChosen(new Set(changes.map((c) => c.page.id)))}>
                    Select all
                  </button>
                  <button type="button" className="plain" onClick={() => setChosen(new Set())}>
                    Select none
                  </button>
                </div>
                <ul className="apply-list">
                  {changes.map((c) => (
                    <li key={c.page.id}>
                      <label className="check">
                        <input type="checkbox" checked={chosen.has(c.page.id)} onChange={(e) => toggle(c.page.id, e.target.checked)} />
                        <span className="apply-title">{c.page.title}</span>
                        {c.page.group && <span className="muted">{displayGroup(c.page.group)}</span>}
                        <span className="apply-summary">{summaryText(c.summary)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview && preview.failed.length > 0 && (
              <p className="dialog-warning">These pages couldn't be read: {preview.failed.join(", ")}.</p>
            )}
            {error && <p className="dialog-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={busy || chosen.size === 0} onClick={() => void apply()}>
                {busy ? "Applying…" : `Apply to ${plural(chosen.size, "page")}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface CopyRow {
  template: Template;
  include: boolean;
  name: string;
}

export function CopyTemplatesDialog({
  project,
  templates,
  onCopy,
  close,
}: {
  project: string;
  templates: Template[];
  onCopy: (copies: Template[]) => void;
  close: () => void;
}) {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<CopyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(
      (list) => setProjects(list.filter((p) => p.id !== project)),
      (e) => setError(errorText(e)),
    );
  }, [project]);

  useEffect(() => {
    if (!source) return setRows(null);
    let live = true;
    api.getTemplates(source).then(
      (list) => {
        if (!live) return;
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setRows(sorted.map((t) => ({ template: t, include: true, name: t.name })));
      },
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [source]);

  /** Why a row's name can't be used (taken here, or by another row being copied). */
  const problems = useMemo(() => {
    if (!rows) return [];
    return rows.map((r, i) => {
      if (!r.include) return null;
      const n = norm(r.name);
      if (!n) return "Needs a name.";
      const here = templates.find((t) => norm(t.name) === n);
      if (here) return `This project already has a template named “${here.name}”. Choose another name, or untick to skip it.`;
      if (rows.some((o, j) => j < i && o.include && norm(o.name) === n)) return "Two copied templates have this name.";
      return null;
    });
  }, [rows, templates]);

  const chosen = rows?.filter((r) => r.include) ?? [];
  const blocked = problems.some(Boolean) || chosen.length === 0;

  function copy() {
    onCopy(chosen.map((r) => ({ ...structuredClone(r.template), id: newTemplateId(r.name), name: r.name.trim() })));
    close();
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide copy-dialog" role="dialog" aria-label="Copy templates from another project" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Copy templates from another project</h2>
        {projects && projects.length === 0 && <p className="empty small">There is no other project in the library.</p>}
        {projects && projects.length > 0 && (
          <label className="field">
            <span>Project</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} autoFocus>
              <option value="">Choose a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {rows && rows.length === 0 && <p className="empty small">That project has no templates.</p>}
        {rows && rows.length > 0 && (
          <ul className="copy-list">
            {rows.map((r, i) => (
              <li key={r.template.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                  />
                  <span>{r.template.name}</span>
                  <span className="muted">{plural(r.template.fields.filter((f) => f.type !== "heading").length, "field")}</span>
                </label>
                {r.include && (problems[i] || r.name !== r.template.name) && (
                  <div className="copy-rename">
                    <span className="muted">Copy as</span>
                    <input
                      aria-label={`New name for ${r.template.name}`}
                      value={r.name}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    {problems[i] && <span className="dialog-error">{problems[i]}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={blocked} onClick={copy}>
            Copy {chosen.length ? plural(chosen.length, "template") : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
