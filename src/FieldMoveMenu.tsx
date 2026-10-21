// The ⋯ menu of a field row in the Infobox tab and the template editor:
// "Move to section…" puts a field at the end of another section in one step,
// or a section heading (with its fields) after another section (M10).
import { useState } from "react";
import type { Field } from "./api";
import { useDialogs, type PickOption } from "./dialogs";
import { sectionOf, sectionOrder } from "./fieldMoves";

const TOP = "top";
const name = (f: Field) => f.label.trim() || "(no heading text)";

export function FieldMoveMenu({ fields, index, onOrder }: { fields: Field[]; index: number; onOrder: (order: number[]) => void }) {
  const dialogs = useDialogs();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const f = fields[index];
  const heading = f.type === "heading";
  const headings = fields.map((x, i) => (x.type === "heading" && i !== index ? i : -1)).filter((i) => i >= 0);
  const label = heading ? `section “${name(f)}”` : `“${f.label.trim() || "(no label)"}”`;

  function pick() {
    setAt(null);
    // A heading lands after another section; a field at the end of one.
    const before = heading ? sectionOf(fields, index) : -1;
    const current = (target: number) => (heading ? target === before : target === sectionOf(fields, index)) ? "current" : undefined;
    const options: PickOption[] = [
      {
        id: TOP,
        label: heading ? "First section" : "Top (before the first section)",
        fullLabel: heading ? "First section" : "Top",
        depth: 0,
        note: current(-1),
      },
      ...headings.map((i) => ({
        id: String(i),
        label: heading ? `After “${name(fields[i])}”` : name(fields[i]),
        fullLabel: name(fields[i]),
        depth: heading ? 0 : 1,
        note: current(i),
      })),
    ];
    dialogs.pick({
      title: `Move ${label} to…`,
      message: heading ? <span className="muted">The section's fields move with it.</span> : undefined,
      options,
      noun: "section",
      confirmLabel: "Move",
      submit: async (id) => {
        const order = sectionOrder(fields, index, id === TOP ? -1 : Number(id));
        if (order) onOrder(order);
      },
    });
  }

  return (
    <>
      <button
        type="button"
        className="plain field-more"
        title="More"
        aria-label={`More for ${f.label || (heading ? "section" : "field")}`}
        aria-expanded={!!at}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { left: Math.max(8, r.right - 190), top: r.bottom + 4 });
        }}
      >
        ⋯
      </button>
      {at && (
        <>
          <div className="menu-catcher" onMouseDown={() => setAt(null)} />
          <div className="menu field-menu" role="menu" style={at}>
            <button
              role="menuitem"
              disabled={!headings.length && !heading}
              title={!headings.length && !heading ? "Add a section heading first" : undefined}
              onClick={pick}
            >
              Move to section…
            </button>
          </div>
        </>
      )}
    </>
  );
}
