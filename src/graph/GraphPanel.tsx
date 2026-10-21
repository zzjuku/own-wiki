// The Graph screen's side panel (M11), Obsidian-style: filters (remembered on
// this computer), extra nodes, arrows, and the colour rules (saved in the
// project, so both computers show the same colours). The local graph beside
// pages shows the switches part only.
import { DragHandle, useReorder } from "../controls";
import { compareNames, ROOT } from "../tree";
import { useWiki } from "../wiki";
import type { GraphColorRule, GraphFilters } from "./model";

type SetFilters = (change: Partial<GraphFilters>) => void;

function Check({ label, hint, on, set }: { label: string; hint?: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <label className="check graph-check" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Link types, extra nodes and arrows (shared with the local graph). */
export function GraphSwitches({ filters: f, set }: { filters: GraphFilters; set: SetFilters }) {
  return (
    <>
      <section className="graph-section">
        <h3>Lines</h3>
        <Check label="Text links" on={f.textLinks} set={(textLinks) => set({ textLinks })} />
        <Check label="Infobox links" hint="Page link fields and links in infobox text, relations included" on={f.fieldLinks} set={(fieldLinks) => set({ fieldLinks })} />
        <Check label="Arrows" hint="Show which way each link points" on={f.arrows} set={(arrows) => set({ arrows })} />
      </section>
      <section className="graph-section">
        <h3>Also show</h3>
        <Check label="Red links" hint="Pages that are linked but don't exist yet (click one to create it)" on={f.redLinks} set={(redLinks) => set({ redLinks })} />
        <Check label="Categories" hint="A node per category, lined to its pages and parent categories" on={f.categories} set={(categories) => set({ categories })} />
        <Check label="Groups" hint="A node per group, lined to the pages directly inside and its parent group" on={f.groups} set={(groups) => set({ groups })} />
      </section>
    </>
  );
}

/** Templates, groups and categories to pick from (filters, colour rules). */
function useChoices() {
  const wiki = useWiki();
  return {
    template: [...wiki.templates].sort((a, b) => compareNames(a.name, b.name)).map((t) => ({ id: t.id, label: t.name })),
    group: wiki.groupOptions.filter((g) => g.id !== ROOT),
    category: wiki.categories.list.map((c) => ({ id: c.name, label: c.name })),
  };
}

const KINDS: { kind: GraphColorRule["kind"]; label: string }[] = [
  { kind: "template", label: "Template" },
  { kind: "group", label: "Group" },
  { kind: "category", label: "Category" },
];

/** A default colour for a new rule, cycling through a few distinct ones. */
const NEW_COLORS = ["#d9534f", "#3b82c4", "#4a9a5b", "#c58b20", "#8a5cc2", "#2a9d9a", "#d0628f"];

function ColorRules({ rules, set }: { rules: GraphColorRule[]; set: (rules: GraphColorRule[]) => void }) {
  const choices = useChoices();
  const reorder = useReorder((order) => set(order.map((i) => rules[i])));
  const change = (i: number, r: Partial<GraphColorRule>) => set(rules.map((x, k) => (k === i ? { ...x, ...r } : x)));
  return (
    <section className="graph-section">
      <h3>Colours</h3>
      <p className="hint">The first rule a page matches gives its colour; drag to change the order. Other pages keep the theme's colour.</p>
      <ol className="graph-rules" ref={reorder.listRef as React.RefObject<HTMLOListElement>}>
        {rules.map((r, i) => {
          const options = choices[r.kind];
          const missing = r.value && !options.some((o) => o.id === r.value);
          return (
            <li key={i} data-reorder className={`graph-rule ${reorder.rowClass(i, rules.length)}`}>
              <DragHandle label={`Move rule ${i + 1}`} onPointerDown={(e) => reorder.start(e, i)} />
              <input type="color" className="graph-rule-color" aria-label="Colour" value={r.color} onChange={(e) => change(i, { color: e.target.value })} />
              <select aria-label="Rule kind" value={r.kind} onChange={(e) => change(i, { kind: e.target.value as GraphColorRule["kind"], value: "" })}>
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
              <select aria-label="Rule value" value={r.value} onChange={(e) => change(i, { value: e.target.value })}>
                <option value="">Choose…</option>
                {missing && <option value={r.value}>{r.value} (not found)</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label.trim()}
                  </option>
                ))}
              </select>
              <button className="plain graph-rule-remove" title="Remove this rule" aria-label="Remove this rule" onClick={() => set(rules.filter((_, k) => k !== i))}>
                ×
              </button>
            </li>
          );
        })}
      </ol>
      <button className="graph-rule-add" onClick={() => set([...rules, { kind: "template", value: "", color: NEW_COLORS[rules.length % NEW_COLORS.length] }])}>
        + Add colour rule
      </button>
    </section>
  );
}

export function GraphPanel({
  filters: f,
  setFilters: set,
  rules,
  setRules,
}: {
  filters: GraphFilters;
  setFilters: SetFilters;
  rules: GraphColorRule[];
  setRules: (rules: GraphColorRule[]) => void;
}) {
  const choices = useChoices();
  const filtered = !!(f.group || f.category || f.template || f.hideOrphans);
  return (
    <aside className="graph-panel" aria-label="Graph filters and colours">
      <section className="graph-section">
        <h3>Filters</h3>
        <select aria-label="Group" value={f.group} onChange={(e) => set({ group: e.target.value })}>
          <option value="">All groups</option>
          {choices.group.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All categories</option>
          {choices.category.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Template" value={f.template} onChange={(e) => set({ template: e.target.value })}>
          <option value="">All templates</option>
          {choices.template.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <Check label="Hide orphans" hint="Pages without links" on={f.hideOrphans} set={(hideOrphans) => set({ hideOrphans })} />
        {filtered && (
          <button className="plain graph-clear" onClick={() => set({ group: "", category: "", template: "", hideOrphans: false })}>
            Clear filters
          </button>
        )}
      </section>
      <GraphSwitches filters={f} set={set} />
      <ColorRules rules={rules} set={setRules} />
    </aside>
  );
}
