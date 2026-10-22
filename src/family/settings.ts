// Family tree settings (project.json `familyTree`): which Page link fields
// point to parents and which link partners, and their line styles.
import type { Template } from "../api";
import { norm } from "../wikilinks";
import type { FamilySettings, FieldStyle } from "./data";

/** A template field was renamed (like Linked from fields, see relations.ts): the settings follow.
 * While another template still has a field named `old`, the new name is added after it instead. */
export function renameFieldInFamily(ft: FamilySettings | null | undefined, templates: Template[], old: string, next: string): FamilySettings | null {
  if (!ft || !old.trim() || !next.trim() || norm(old) === norm(next)) return null;
  const stillUsed = templates.some((t) => t.fields.some((f) => f.type !== "heading" && f.type !== "divider" && norm(f.label) === norm(old)));
  let changed = false;
  const fix = (list: FieldStyle[] | undefined) => {
    if (!list?.some((f) => norm(f.field) === norm(old))) return list;
    changed = true;
    const out: FieldStyle[] = [];
    for (const f of list) {
      if (norm(f.field) !== norm(old)) out.push(f);
      else if (stillUsed) out.push(f, { ...f, field: next });
      else out.push({ ...f, field: next });
    }
    return out.filter((f, i) => out.findIndex((g) => norm(g.field) === norm(f.field)) === i);
  };
  const result = { ...ft, parents: fix(ft.parents), partners: fix(ft.partners) };
  // The house field follows unless another template still has the old name.
  if (ft.house && norm(ft.house) === norm(old) && !stillUsed) {
    result.house = next;
    changed = true;
  }
  return changed ? result : null;
}

export const LINK_KINDS = ["links", "link"];
/** Field types a house field can be. */
export const HOUSE_KINDS = ["text", "list", "choice", "links", "link"];

/** Names of fields of types `kinds`: those pages have, and those templates have. */
export function fieldNamesOf(fromPages: string[], templates: Template[], kinds: string[]): string[] {
  const out = new Map<string, string>();
  for (const n of fromPages) out.set(norm(n), n);
  for (const t of templates) for (const f of t.fields) if (kinds.includes(f.type) && f.label.trim()) out.set(norm(f.label), f.label.trim());
  return [...out.values()];
}
