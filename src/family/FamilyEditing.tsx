// Editing on the Family tree screen (M12): a click selects a person or a
// line; the bar at the bottom offers what can be done with it. Adding writes
// through the same dialog and write-back as the Infobox tab (M9: "Alex is
// John's: Father / Mother"): parents and partners go into the selected
// person's page, a child gets the selected person in their own page. Removing
// a line takes the relations out of the pages they're stored on.
import { useState, type ReactNode } from "react";
import { api } from "../api";
import { useDialogs } from "../dialogs";
import { useReportError } from "../notify";
import { RelationDialog } from "../RelationInputs";
import { useWiki } from "../wiki";
import type { Family, FamilyData } from "./data";
import type { TreeLayout } from "./layout";
import type { Selection } from "./TreeCanvas";

type Adding = "parent" | "child" | "partner";

/** The people a selected line stands for (people with a box; none for spoiler boxes). */
function lineParts(layout: TreeLayout, index: number): { kind: "couple" | "child"; people: number[] } | null {
  const line = layout.lines[index];
  if (!line?.select) return null;
  const byKey = new Map(layout.boxes.map((b) => [b.key, b.box]));
  const people = line.people.map((k) => byKey.get(k)?.person);
  if (people.some((p) => p === undefined)) return null;
  return { kind: line.select, people: people as number[] };
}

export function SelectionBar({
  selection,
  layout,
  fam,
  data,
  isCentre,
  onClear,
  onOpen,
  onCentre,
  onCreate,
}: {
  selection: Selection;
  layout: TreeLayout;
  fam: Family;
  data: FamilyData;
  /** The selected person is the one in the middle (no "Show their tree"). */
  isCentre: (person: number) => boolean;
  onClear: () => void;
  onOpen: (id: string) => void;
  onCentre: (id: string) => void;
  onCreate: (person: number) => void;
}) {
  const wiki = useWiki();
  const dialogs = useDialogs();
  const report = useReportError();
  const [adding, setAdding] = useState<Adding | null>(null);
  const name = (i: number) => fam.people[i].title;
  const fields = { parents: data.settings.parents.map((f) => f.field), partners: data.settings.partners.map((f) => f.field) };

  let content: ReactNode = null;
  if (selection.kind === "box") {
    const i = layout.boxes.find((b) => b.key === selection.key)?.box.person;
    if (i === undefined) return null;
    const p = fam.people[i];
    content = p.id ? (
      <>
        <strong className="family-bar-name">{p.title}</strong>
        <button onClick={() => onOpen(p.id!)}>Open page</button>
        {!isCentre(i) && <button onClick={() => onCentre(p.id!)}>Show their tree</button>}
        <span className="family-bar-gap" />
        <button disabled={!fields.parents.length} onClick={() => setAdding("parent")}>
          Add parent…
        </button>
        <button disabled={!fields.parents.length} onClick={() => setAdding("child")}>
          Add child…
        </button>
        <button disabled={!fields.partners.length} onClick={() => setAdding("partner")}>
          Add partner…
        </button>
        {adding && (
          <RelationDialog
            title={adding === "parent" ? `Add a parent of ${p.title}` : adding === "child" ? `Add a child of ${p.title}` : `Add a partner of ${p.title}`}
            pickLabel={adding === "parent" ? "Parent" : adding === "child" ? "Child" : "Partner"}
            fixed={{ id: p.id, title: p.title }}
            // A child's page names its parents; parents and partners go into this page.
            fixedIs={adding === "child" ? "source" : "target"}
            fields={adding === "partner" ? fields.partners : fields.parents}
            close={() => setAdding(null)}
            onDone={() => {}}
          />
        )}
      </>
    ) : (
      <>
        <strong className="family-bar-name">{p.title}</strong>
        <span className="muted">has no page yet: create it to give them parents or partners.</span>
        <button className="primary" onClick={() => onCreate(i)}>
          Create page…
        </button>
      </>
    );
  } else {
    const parts = lineParts(layout, selection.index);
    if (!parts) return null;
    const { kind, people } = parts;
    const child = people[people.length - 1];
    const parents = people.slice(0, -1);
    const label = kind === "couple" ? `${name(people[0])} and ${name(people[1])}` : `${parents.map(name).join(" and ")} → ${name(child)}`;
    content = (
      <>
        <strong className="family-bar-name">{label}</strong>
        <span className="muted">{kind === "couple" ? "partners" : parents.length > 1 ? "parents and child" : "parent and child"}</span>
        <button className="danger-text" onClick={() => remove(kind, people)}>
          Remove…
        </button>
      </>
    );
  }

  /** Removes a couple's partner links, or a child's links to these parents (from the pages they're stored on). */
  function remove(kind: "couple" | "child", people: number[]) {
    const writes: { target: string; field: string; source: string }[] = [];
    const manual: string[] = [];
    const source = (i: number) => fam.people[i].id ?? fam.people[i].title;
    if (kind === "couple") {
      const [a, b] = people;
      for (const l of data.partners) {
        if (!((l.a === a && l.b === b) || (l.a === b && l.b === a))) continue;
        const target = fam.people[l.a].id;
        if (target) writes.push({ target, field: data.settings.partners[l.field].field, source: source(l.b) });
      }
    } else {
      const child = people[people.length - 1];
      const parents = new Set(people.slice(0, -1));
      for (const l of fam.parentsOf[child].filter((x) => parents.has(x.parent))) {
        const target = fam.people[child].id;
        if (l.typed || !target) {
          manual.push(`${fam.people[l.parent].title}'s page (typed into a Linked from field)`);
          continue;
        }
        // Every parent field: the same parent may be in several (Father and Adoptive father).
        for (const f of data.settings.parents) writes.push({ target, field: f.field, source: source(l.parent) });
      }
    }
    const changed = [...new Set(writes.map((w) => fam.people[fam.byPage.get(w.target)!]?.title ?? w.target))];
    if (!writes.length)
      return dialogs.alert({ title: "Remove", message: <>This can only be changed by hand, on {manual.join(", ")}.</> });
    const what =
      kind === "couple" ? (
        <>
          the partner link between <strong>{name(people[0])}</strong> and <strong>{name(people[1])}</strong>
        </>
      ) : (
        <>
          <strong>{people.slice(0, -1).map(name).join(" and ")}</strong> as <strong>{name(people[people.length - 1])}</strong>'s{" "}
          {people.length > 2 ? "parents" : "parent"}
        </>
      );
    dialogs.confirm({
      title: "Remove relation",
      message: (
        <>
          Remove {what}? This changes {changed.map((t, i) => <span key={t}>{i > 0 && ", "}<strong>{t}</strong></span>)}'s page.
          {manual.length > 0 && <> It's also named on {manual.join(", ")}, which can only be changed there.</>}
        </>
      ),
      confirmLabel: "Remove",
      danger: true,
      submit: async () => {
        try {
          for (const w of writes) await api.setRelation(wiki.project, w.target, w.field, w.source, "remove");
          onClear();
        } catch (e) {
          report(e);
        }
      },
    });
  }

  return (
    <div className="family-bar" role="toolbar" aria-label="Selected">
      {content}
      <span className="spacer" />
      <button className="plain" title="Let go (Esc)" aria-label="Let go" onClick={onClear}>
        ×
      </button>
    </div>
  );
}
