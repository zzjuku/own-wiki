// Relations in the Infobox tab (M9): a Linked from field's entries (from
// other pages, or typed in) with Add and remove, and the entries two-way
// fields of other pages add to a Page link field. Adding or removing an entry
// that lives on another page writes that page (src-tauri/src/relations.rs):
// "Alex is John's: Father / Mother" writes Alex into John's Father field.
import { useEffect, useMemo, useState } from "react";
import { api, errorText, type Field, type Infobox, type Page, type Relations, type RelationEdit } from "./api";
import { useDialogs } from "./dialogs";
import { PageNameInput } from "./FieldInputs";
import { isLayout, kindLabel } from "./infobox";
import { useReportError } from "./notify";
import { reverseEntries, twoWayExtras, type RelationEntry } from "./relations";
import { useWiki } from "./wiki";
import { norm } from "./wikilinks";

/** What the relation inputs need besides the field. */
export interface RelationProps {
  pageId: string;
  /** The page's title (written into the other page). */
  pageTitle: string;
  relations: Relations;
  /** A relation was written into another page: re-read the relations. */
  onRelationsChanged: () => void;
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** "John's Father", "John's Father and Mother". */
function sourcesText(e: RelationEntry): string {
  const byPage = new Map<string, string[]>();
  for (const s of e.sources) byPage.set(s.title, [...(byPage.get(s.title) ?? []), s.field]);
  return [...byPage].map(([title, fields]) => `${title}'s ${fields.join(" and ")}`).join(", ");
}

/** Removing entries that live on other pages: asks, then writes those pages. */
function useRemoveFromOthers({ pageId, pageTitle, onRelationsChanged }: RelationProps) {
  const wiki = useWiki();
  const dialogs = useDialogs();
  const report = useReportError();
  return async (e: RelationEntry) => {
    // Only Page link fields can be written back; [[links]] in text are changed by hand.
    let pages: Page[];
    try {
      pages = await Promise.all([...new Set(e.sources.map((s) => s.id))].map((id) => api.readPage(wiki.project, id)));
    } catch (err) {
      return report(err);
    }
    const kindOf = (id: string, field: string) =>
      pages.find((p) => p.id === id)?.infobox?.fields.find((f) => !isLayout(f.type) && norm(f.label) === norm(field))?.type;
    const writable = e.sources.filter((s) => ["link", "links"].includes(kindOf(s.id, s.field) ?? ""));
    const manual = e.sources.filter((s) => !writable.includes(s));
    const manualNote = manual.length > 0 && (
      <>
        {" "}
        It's also named in {manual.map((s) => `${s.title}'s ${s.field}`).join(", ")}, which can only be changed on that page.
      </>
    );
    if (!writable.length) {
      return dialogs.alert({
        title: "Remove relation",
        message: (
          <>
            <strong>{pageTitle}</strong> is named in {sourcesText(e)} (not a Page link field). Change it on that page.
          </>
        ),
      });
    }
    const where = writable.map((s) => `${s.title}'s ${s.field}`).join(", ");
    dialogs.confirm({
      title: "Remove relation",
      message: (
        <>
          Remove <strong>{pageTitle}</strong> from {where}? This changes{" "}
          {[...new Set(writable.map((s) => s.title))].map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <strong>{t}</strong>
            </span>
          ))}
          's page.{manualNote}
        </>
      ),
      confirmLabel: "Remove",
      danger: true,
      submit: async () => {
        try {
          for (const s of writable) await api.setRelation(wiki.project, s.id, s.field, pageId, "remove");
        } finally {
          onRelationsChanged();
        }
      },
    });
  };
}

function EntryName({ entry }: { entry: RelationEntry }) {
  return (
    <span className={`relation-name ${entry.id ? "" : "missing"} ${entry.spoiler ? "relation-spoiler" : ""}`} title={entry.spoiler ? "A spoiler where it comes from" : undefined}>
      {entry.name}
    </span>
  );
}

/** A Linked from field: its entries, Add…, and × on each. */
export function ReverseFieldInput({ field, onChange, ...rel }: RelationProps & { field: Field; onChange: (v: unknown) => void }) {
  const wiki = useWiki();
  const [adding, setAdding] = useState(false);
  const removeFromOthers = useRemoveFromOthers(rel);
  const entries = reverseEntries(field, rel.relations, (n) => wiki.names.resolve(n));
  const from = field.options?.from ?? [];
  const typed = stringList(field.value);

  function removeTyped(e: RelationEntry) {
    const same = (t: string) => (e.id ? wiki.names.resolve(t)?.page.id === e.id : norm(t) === norm(e.name));
    onChange(typed.filter((t) => !same(t.split("#")[0].trim())));
  }

  return (
    <div className="ib-relations">
      {entries.length > 0 && (
        <ul className="relation-list" aria-label={`${field.label} entries`}>
          {entries.map((e) => (
            <li key={e.id ?? `missing:${e.name}`}>
              <EntryName entry={e} />
              <span className="relation-source">
                {[e.typed && "typed in", e.sources.length && `from ${sourcesText(e)}`].filter(Boolean).join(" · ")}
              </span>
              <button
                type="button"
                className="plain remove"
                title={e.typed ? "Remove this name" : "Remove (changes the other page)"}
                aria-label={`Remove ${e.name}`}
                onClick={() => (e.typed ? removeTyped(e) : void removeFromOthers(e))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!entries.length && (
        <span className="muted small">
          {from.length ? `No page points here yet.` : "Choose which fields point here in the field settings (⚙)."}
        </span>
      )}
      <button type="button" className="plain add-entry" disabled={!from.length} onClick={() => setAdding(true)}>
        + Add…
      </button>
      {adding && (
        <AddRelationDialog
          {...rel}
          field={field}
          close={() => setAdding(false)}
          addTyped={(name) => onChange([...typed, name])}
        />
      )}
    </div>
  );
}

/** Entries other pages' two-way fields add to a Page link field. */
export function TwoWayExtras({ field, ...rel }: RelationProps & { field: Field }) {
  const wiki = useWiki();
  const removeFromOthers = useRemoveFromOthers(rel);
  const extras = twoWayExtras(field, rel.relations, (n) => wiki.names.resolve(n));
  if (!extras.length) return null;
  return (
    <div className="relation-extras">
      <span className="muted small">Also shown, from other pages:</span>
      <ul className="relation-list" aria-label={`${field.label} from other pages`}>
        {extras.map((e) => (
          <li key={e.id!}>
            <EntryName entry={e} />
            <span className="relation-source">from {sourcesText(e)}</span>
            <button
              type="button"
              className="plain remove"
              title="Remove (changes the other page)"
              aria-label={`Remove ${e.name}`}
              onClick={() => void removeFromOthers(e)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A field of the other page that the relation can go into. */
interface Slot {
  /** The name in `from` (or the field's own label on the other page). */
  label: string;
  /** missing: added as the page's own field; taken: holds other pages;
   * here: already holds this page; wrongType: not a Page link field. */
  status: "empty" | "missing" | "taken" | "here" | "wrongType";
  kind?: string;
  /** Pages it holds now. */
  current: string[];
}

function slotsFor(ib: Infobox | null, from: string[], isThisPage: (name: string) => boolean): Slot[] {
  return from.map((name) => {
    const f = ib?.fields.find((x) => !isLayout(x.type) && norm(x.label) === norm(name));
    if (!f) return { label: name, status: "missing", current: [] };
    if (f.type !== "link" && f.type !== "links") return { label: f.label, status: "wrongType", kind: f.type, current: [] };
    const current = (typeof f.value === "string" ? [f.value] : stringList(f.value)).map((v) => v.split("#")[0].trim()).filter(Boolean);
    if (current.some(isThisPage)) return { label: f.label, status: "here", kind: f.type, current };
    return { label: f.label, status: current.length ? "taken" : "empty", kind: f.type, current };
  });
}

const selectable = (s: Slot) => s.status !== "wrongType" && s.status !== "here";

function AddRelationDialog({
  pageId,
  pageTitle,
  field,
  close,
  addTyped,
  onRelationsChanged,
}: RelationProps & { field: Field; close: () => void; addTyped: (name: string) => void }) {
  const wiki = useWiki();
  const from = field.options?.from ?? [];
  const [name, setName] = useState("");
  const target = name.trim() ? wiki.names.resolve(name) : null;
  const targetId = target?.page.id ?? null;
  // The other page as it is now (to see what its fields hold).
  const [page, setPage] = useState<{ id: string; page: Page | null; error: string | null } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    let live = true;
    api.readPage(wiki.project, targetId).then(
      (p) => live && setPage({ id: targetId, page: p, error: p.infoboxError ? `${p.title}'s infobox can't be read, so it can't be changed here.` : null }),
      (e) => live && setPage({ id: targetId, page: null, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [targetId, wiki.project]);

  const loaded = targetId && page?.id === targetId ? page : null;
  const missing = !!name.trim() && !target;
  const otherTitle = target?.page.title ?? name.trim();
  const thisPage = (n: string) => wiki.names.resolve(n)?.page.id === pageId;
  const slots = useMemo(
    () => (loaded?.page && !loaded.error ? slotsFor(loaded.page.infobox, from, thisPage) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, from.join("\n"), wiki.names],
  );
  // The one picked, else the first usable field in `from` order (a taken one
  // shows its warning rather than quietly picking another field).
  const picked = slots.find((s) => s.label === choice && selectable(s)) ?? slots.find(selectable) ?? null;
  const self = targetId === pageId;

  async function write(edit: RelationEdit) {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await api.setRelation(wiki.project, targetId!, picked.label, pageId, edit);
      onRelationsChanged();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const slotNote = (s: Slot): string => {
    switch (s.status) {
      case "empty":
        return "empty now";
      case "missing":
        return `added to ${otherTitle}'s page as a new field`;
      case "taken":
        return `now: ${s.current.join(", ")}`;
      case "here":
        return `already ${pageTitle}`;
      case "wrongType":
        return `a ${kindLabel(s.kind ?? "")} field; change it to Page link to use it here`;
    }
  };

  const actions = (() => {
    if (busy || self || !picked) return null;
    if (picked.status === "taken") {
      return (
        <>
          <button type="button" onClick={() => void write("replace")}>
            Replace {picked.current.join(", ")}
          </button>
          {picked.kind === "links" && (
            <button type="button" className="primary" onClick={() => void write("add")}>
              Add {pageTitle} too
            </button>
          )}
        </>
      );
    }
    return (
      <button type="button" className="primary" onClick={() => void write("add")}>
        Add
      </button>
    );
  })();

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="dialog relation-dialog"
        role="dialog"
        aria-label={`Add to ${field.label}`}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <h2>Add to {field.label}</h2>
        <label className="field">
          <span>Page</span>
          {/* A missing page gets "Create page…" (the open page's template suggested); then the choice below. */}
          <PageNameInput label="Page" value={name} autoFocus fromPage={pageId} onChange={setName} />
        </label>

        {self && <p className="dialog-error">A page can't be listed in its own field.</p>}
        {target && !self && loaded?.error && <p className="dialog-error">{loaded.error}</p>}

        {missing && (
          <p className="dialog-note relation-missing">
            Create the page with <strong>Create page…</strong> under the name, then choose where {pageTitle} goes. Or keep the name only (typed in on{" "}
            {pageTitle}'s page).
          </p>
        )}

        {slots.length > 0 && !self && (
          <fieldset className="relation-slots">
            <legend>
              {pageTitle} is {otherTitle}'s:
            </legend>
            {slots.map((s) => (
              <label key={s.label} className={`check ${selectable(s) ? "" : "disabled"}`}>
                <input
                  type="radio"
                  name="relation-slot"
                  disabled={!selectable(s)}
                  checked={picked?.label === s.label}
                  onChange={() => setChoice(s.label)}
                />
                <span>{s.label}</span>
                <span className="muted small">{slotNote(s)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {picked?.status === "taken" && !self && (
          <p className="dialog-warning">
            {otherTitle}'s {picked.label} is already {picked.current.join(", ")}.
            {picked.kind === "link" && " It holds one page only."}
          </p>
        )}
        {picked && !self && (
          <p className="dialog-note relation-writes">
            Writes {pageTitle} into {otherTitle}'s page. Nothing is stored on {pageTitle}'s page.
          </p>
        )}
        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          {missing && (
            <button
              type="button"
              className="relation-typed"
              onClick={() => {
                addTyped(name.trim());
                close();
              }}
            >
              Keep as name only
            </button>
          )}
          <div className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
