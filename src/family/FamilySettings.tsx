// Project settings → Family tree (M12): the Page link fields that point to
// parents (in left-to-right order) and that link partners, each with a line style.
import { useEffect, useState } from "react";
import { api, type ProjectSettings } from "../api";
import { compareNames } from "../tree";
import { useWiki } from "../wiki";
import { norm } from "../wikilinks";
import { type FieldStyle, LINE_STYLES, lineStyle, type LineStyle } from "./data";
import { fieldNamesOf, HOUSE_KINDS, LINK_KINDS } from "./settings";

const STYLE_NAMES: Record<LineStyle, string> = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };

export function FamilyTreeSettings({ settings, change }: { settings: ProjectSettings; change: (next: ProjectSettings) => void }) {
  const wiki = useWiki();
  const [fromPages, setFromPages] = useState<{ links: string[]; house: string[] }>({ links: [], house: [] });
  useEffect(() => {
    Promise.all([api.fieldNames(wiki.project, LINK_KINDS), api.fieldNames(wiki.project, HOUSE_KINDS)]).then(
      ([links, house]) => setFromPages({ links, house }),
      () => {},
    );
  }, [wiki.project]);
  const ft = settings.familyTree ?? {};
  const names = fieldNamesOf(fromPages.links, wiki.templates, LINK_KINDS).sort(compareNames);
  const taken = new Set([...(ft.parents ?? []), ...(ft.partners ?? [])].map((f) => norm(f.field)));
  const free = names.filter((n) => !taken.has(norm(n)));
  // House field: text-like and Page link fields (and the one chosen).
  const houseNames = fieldNamesOf([...fromPages.house, ...(ft.house ? [ft.house] : [])], wiki.templates, HOUSE_KINDS).sort(compareNames);
  const set = (which: "parents" | "partners", list: FieldStyle[]) => change({ ...settings, familyTree: { ...ft, [which]: list } });

  const list = (which: "parents" | "partners", title: string, hint: string, example: string) => {
    const rows = ft[which] ?? [];
    const update = (i: number, patch: Partial<FieldStyle>) => set(which, rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const move = (i: number, by: number) => {
      const next = [...rows];
      const [r] = next.splice(i, 1);
      next.splice(i + by, 0, r);
      set(which, next);
    };
    return (
      <div className="family-fields" aria-label={title}>
        <h4>{title}</h4>
        <p className="hint">{hint}</p>
        {rows.map((r, i) => (
          <div className="family-field-row" key={i}>
            <select aria-label={`${title}: field`} value={r.field} onChange={(e) => update(i, { field: e.target.value })}>
              {[r.field, ...free].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {!names.some((x) => norm(x) === norm(n)) ? " (no field has this name)" : ""}
                </option>
              ))}
            </select>
            <select aria-label={`${title}: line for ${r.field}`} value={lineStyle(r.line)} onChange={(e) => update(i, { line: e.target.value })}>
              {LINE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {STYLE_NAMES[s]}
                </option>
              ))}
            </select>
            <svg className={`family-line-sample ${lineStyle(r.line)}`} width="36" height="10" aria-hidden="true">
              <path d="M2,5H34" />
            </svg>
            <button className="plain" title="Move up" aria-label={`Move ${r.field} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="plain" title="Move down" aria-label={`Move ${r.field} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button className="plain danger-text" title="Remove" aria-label={`Remove ${r.field}`} onClick={() => set(which, rows.filter((_, k) => k !== i))}>
              ×
            </button>
          </div>
        ))}
        <select
          className="family-add"
          aria-label={`Add ${which === "parents" ? "a parent" : "a partner"} field`}
          value=""
          disabled={!free.length}
          onChange={(e) => e.target.value && set(which, [...rows, { field: e.target.value, line: "solid" }])}
        >
          <option value="">{free.length ? `Add a field… (e.g. ${example})` : names.length ? "Every Page link field is chosen" : "No Page link fields yet"}</option>
          {free.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <section className="family-settings" id="family-tree-settings">
      <h3>Family tree</h3>
      <p className="hint">
        Family trees are drawn from Page link fields. Choose which fields point from a child to a parent and which link partners. Children
        come from the parent fields (and names typed into a Linked from field reading one).
      </p>
      {list("parents", "Parent fields", "On a child's page, pointing to a parent. Their order sets the parents' order, left to right.", "Father")}
      {list("partners", "Partner fields", "Linking partners; a link entered on either page counts.", "Spouse")}
      <div className="family-fields">
        <h4>House field</h4>
        <p className="hint">
          The field naming a person's house or dynasty (text, list, choice or Page link). Each house can then be shown on its own on the
          Family tree screen: its members, their partners and their children.
        </p>
        <select
          aria-label="House field"
          value={ft.house ?? ""}
          onChange={(e) => {
            const { house: _, ...rest } = ft;
            change({ ...settings, familyTree: e.target.value ? { ...rest, house: e.target.value } : rest });
          }}
        >
          <option value="">None</option>
          {houseNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
