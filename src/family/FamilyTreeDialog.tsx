// The Family tree dialog: writes a `<familytree …>` line (treeLine.ts) that
// draws a person's family tree in the page text, with how many generations
// up and down. Opened from the toolbar, or by clicking such a line in the source.
import { useMemo, useState } from "react";
import { useWiki } from "../wiki";
import { MAX_GENERATIONS } from "./prefs";
import { DEFAULT_LINE_GENS, type TreeLineCall } from "./treeLine";

export function FamilyTreeDialog({
  initial,
  pageTitle,
  save,
  remove,
  close,
}: {
  initial: TreeLineCall | null;
  /** The page being edited (the person suggested for a new tree). */
  pageTitle: string;
  save: (call: TreeLineCall) => void;
  remove?: () => void;
  close: () => void;
}) {
  const wiki = useWiki();
  const [root, setRoot] = useState(initial?.root ?? pageTitle);
  const [up, setUp] = useState(initial?.up ?? DEFAULT_LINE_GENS.up);
  const [down, setDown] = useState(initial?.down ?? DEFAULT_LINE_GENS.down);
  const titles = useMemo(() => wiki.names.entries.filter((e) => !e.alias).map((e) => e.name), [wiki.names]);
  const missing = root.trim() !== "" && !wiki.names.resolve(root);
  const clamp = (v: string) => Math.max(0, Math.min(MAX_GENERATIONS, Math.round(Number(v)) || 0));
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog family-tree-dialog" role="dialog" aria-label="Family tree" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Family tree</h2>
        <p className="dialog-note">
          Draws a person's family tree in the page, always up to date. Click a person in it to open their page; Open in Family tree
          shows it on the Family tree screen.
        </p>
        <label className="field">
          <span>Person in the middle</span>
          <input list="family-tree-pages" value={root} autoFocus spellCheck={false} onChange={(e) => setRoot(e.target.value)} />
          <datalist id="family-tree-pages">
            {titles.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        {missing && <p className="hint family-dialog-missing">There&apos;s no page with this name.</p>}
        <div className="family-dialog-gens">
          <label className="field">
            <span>Generations up</span>
            <input type="number" min={0} max={MAX_GENERATIONS} value={up} onChange={(e) => setUp(clamp(e.target.value))} />
          </label>
          <label className="field">
            <span>Generations down</span>
            <input type="number" min={0} max={MAX_GENERATIONS} value={down} onChange={(e) => setDown(clamp(e.target.value))} />
          </label>
        </div>
        <div className="dialog-actions">
          {remove && (
            <button type="button" className="danger-text" onClick={remove}>
              Remove
            </button>
          )}
          <div className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!root.trim()} onClick={() => save({ root: root.trim(), up, down })}>
            {initial ? "Save" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
