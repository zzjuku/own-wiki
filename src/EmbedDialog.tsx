// The embed dialog: which page to embed, and what of it: the whole page
// (infobox and text), one section, or only the infobox. Opened by the Embed
// button (new) or Change in the embed popup.
import { useEffect, useState } from "react";
import { api, type Heading } from "./api";
import type { EmbedCall } from "./embedSyntax";
import { PageNameInput } from "./FieldInputs";
import { useWiki } from "./wiki";

type Mode = "page" | "section" | "infobox";

interface Props {
  initial: EmbedCall | null;
  save: (e: EmbedCall) => void;
  close: () => void;
}

export function EmbedDialog({ initial, save, close }: Props) {
  const wiki = useWiki();
  const [page, setPage] = useState(initial?.page ?? "");
  const [mode, setMode] = useState<Mode>(initial?.infobox ? "infobox" : initial?.section ? "section" : "page");
  const [section, setSection] = useState(initial?.section ?? "");
  const [sections, setSections] = useState<Heading[]>([]);
  const [box, setBox] = useState<EmbedCall["box"]>(initial?.box ?? null);
  const target = wiki.names.resolve(page);

  useEffect(() => {
    if (!target) return setSections([]);
    let live = true;
    api.pageSections(wiki.project, target.page.id).then(
      (h) => live && setSections(h),
      () => live && setSections([]),
    );
    return () => {
      live = false;
    };
  }, [target?.page.id, wiki.project]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = page.trim() !== "" && (mode !== "section" || section.trim() !== "");

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="dialog embed-dialog"
        role="dialog"
        aria-label={initial ? "Change embed" : "Embed a page"}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) save({ page: page.trim(), section: mode === "section" ? section.trim() : null, infobox: mode === "infobox", box });
        }}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <h2>{initial ? "Change embed" : "Embed a page"}</h2>
        <p className="muted small-note">Shows the page's current content here. Changes to that page show up here too.</p>
        <div className="field">
          <span>Page</span>
          <PageNameInput label="Page to embed" value={page} onChange={setPage} autoFocus />
        </div>
        {page.trim() && !target && <p className="hint">This page doesn't exist yet: the embed shows a red box until it's created.</p>}
        <fieldset className="embed-modes">
          <legend>Show</legend>
          <label className="check">
            <input type="radio" name="mode" checked={mode === "page"} onChange={() => setMode("page")} />
            <span>Whole page (infobox and text)</span>
          </label>
          <label className="check">
            <input type="radio" name="mode" checked={mode === "section"} onChange={() => setMode("section")} />
            <span>One section</span>
          </label>
          {mode === "section" && (
            <select className="embed-section" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">Choose a section…</option>
              {section && !sections.some((h) => h.text === section || h.anchor === section) && <option value={section}>{section}</option>}
              {sections.map((h) => (
                // Sections with the same name are told apart by their anchor ("early-life-2").
                <option key={h.anchor} value={sections.filter((x) => x.text === h.text).length > 1 ? h.anchor : h.text}>
                  {" ".repeat(Math.max(0, h.level - 2))}
                  {h.text}
                </option>
              ))}
            </select>
          )}
          <label className="check">
            <input type="radio" name="mode" checked={mode === "infobox"} onChange={() => setMode("infobox")} />
            <span>Infobox only</span>
          </label>
        </fieldset>
        <fieldset className="embed-modes">
          <legend>Look</legend>
          <label className="check">
            <input type="radio" name="look" checked={box === null} onChange={() => setBox(null)} />
            <span>Seamless: part of the page</span>
          </label>
          <label className="check">
            <input type="radio" name="look" checked={box !== null} onChange={() => setBox("open")} />
            <span>Collapsible box with a title bar (show / hide)</span>
          </label>
          {box !== null && (
            <select className="embed-section" aria-label="Box starts" value={box} onChange={(e) => setBox(e.target.value as "open" | "closed")}>
              <option value="open">Starts open</option>
              <option value="closed">Starts closed</option>
            </select>
          )}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            {initial ? "Save" : "Embed"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Clicking an embed in the source: Open, Change, Remove. */
export function EmbedPopup({
  call,
  at,
  open,
  change,
  remove,
  close,
}: {
  call: EmbedCall;
  at: { left: number; top: number };
  open: () => void;
  change: () => void;
  remove: () => void;
  close: () => void;
}) {
  const wiki = useWiki();
  const exists = !!wiki.names.resolve(call.page);
  const what =
    (call.infobox ? "its infobox" : call.section ? `section “${call.section}”` : "the whole page") +
    (call.box === "closed" ? ", in a box that starts closed" : call.box === "open" ? ", in a collapsible box" : "");
  return (
    <div
      className="link-popup embed-popup"
      style={{ left: Math.max(8, Math.min(at.left, window.innerWidth - 340)), top: at.top }}
      role="dialog"
      aria-label="Embed"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <p className="embed-popup-text">
        Embeds <strong>{call.page}</strong>: {what}.{!exists && <span className="link-missing"> This page doesn't exist yet.</span>}
      </p>
      <div className="link-actions">
        <button type="button" onClick={open}>
          {exists ? "Open" : "Create page"}
        </button>
        <button type="button" onClick={change}>
          Change…
        </button>
        <button type="button" className="danger-text" title="Takes the embed out of this page. The embedded page stays as it is." onClick={remove}>
          Remove
        </button>
      </div>
    </div>
  );
}
