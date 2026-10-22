// Relations in the Infobox tab (M9): a Linked from field's entries (from
// other pages, or typed in) with Add and remove, and the entries two-way
// fields of other pages add to a Page link field. Adding or removing an entry
// that lives on another page writes that page (src-tauri/src/relations.rs):
// "Alex is John's: Father / Mother" writes Alex into John's Father field.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText, type Field, type Infobox, type Page, type PageInfo, type Relations, type RelationEdit } from "./api";
import { useDialogs } from "./dialogs";
import { PageNameInput } from "./FieldInputs";
import { entryPage } from "./linkEntry";
import { MultiPagePicker } from "./MultiPagePicker";
import { isLayout, kindLabel } from "./infobox";
import { useReportError } from "./notify";
import { fromProblems, reverseEntries, twoWayExtras, type RelationEntry } from "./relations";
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
  // Add several…: first the pages, then one choice for all of them.
  const [picking, setPicking] = useState(false);
  const [several, setSeveral] = useState<PageInfo[] | null>(null);
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
      {fromProblems(wiki.templates, from)
        .filter((p) => p.problem === "reverse")
        .map((p) => (
          <p key={p.name} className="field-warning" role="alert">
            ⚠ “{p.name}” is a Linked from field too, so nothing stores this relation. In the template, make “{p.name}” a Page link field.
          </p>
        ))}
      {!entries.length && (
        <span className="muted small">
          {from.length ? `No page points here yet.` : "Choose which fields point here in the field settings (⚙)."}
        </span>
      )}
      <div className="row add-entries">
        <button type="button" className="plain add-entry" disabled={!from.length} onClick={() => setAdding(true)}>
          + Add…
        </button>
        <button type="button" className="plain add-entry" disabled={!from.length} onClick={() => setPicking(true)}>
          + Add several…
        </button>
      </div>
      {picking && (
        <MultiPagePicker
          title={`Add pages to ${field.label}`}
          confirmLabel={(n) => (n === 1 ? "Next: 1 page" : `Next: ${n} pages`)}
          note={<>Tick the pages. Next you choose which of their fields {rel.pageTitle} goes into.</>}
          unavailable={(p) => (p.id === rel.pageId ? "this page" : entries.some((e) => e.id === p.id) ? "already listed" : null)}
          onPick={setSeveral}
          close={() => setPicking(false)}
        />
      )}
      {several && <AddSeveralDialog {...rel} field={field} pages={several} close={() => setSeveral(null)} />}
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
    const current = (typeof f.value === "string" ? [f.value] : stringList(f.value)).map(entryPage).filter(Boolean);
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
  return (
    <RelationDialog
      title={`Add to ${field.label}`}
      fixed={{ id: pageId, title: pageTitle }}
      fixedIs="source"
      fields={field.options?.from ?? []}
      close={close}
      onDone={onRelationsChanged}
      keepName={addTyped}
    />
  );
}

/**
 * Writes one page into a field of another ("Alex is John's: Father /
 * Mother"): the Add… dialog of Linked from fields, and Add parent / child /
 * partner on the Family tree screen. One page is given (`fixed`, the page
 * written into the other's field, or the page whose field is written); the
 * other is chosen here (a missing one: Create page… first). The choice of
 * field shows what each holds now; a taken field asks Replace or Add.
 */
export function RelationDialog({
  title,
  fixed,
  fixedIs,
  fields: from,
  close,
  onDone,
  keepName,
  pickLabel = "Page",
  extra,
  onWritten,
}: {
  title: string;
  fixed: { id: string; title: string };
  /** "source": the given page is written into the chosen page's field; "target": the chosen page goes into the given page's field. */
  fixedIs: "source" | "target";
  /** The fields to choose from, in order. */
  fields: string[];
  close: () => void;
  /** Something was written. */
  onDone: () => void;
  /** A name without a page can be kept as a name only (typed in on the given page). */
  keepName?: (name: string) => void;
  pickLabel?: string;
  /** More choices, shown above the buttons (the Family tree's "other parent"). */
  extra?: ReactNode;
  /** After the write, before closing: more writes into the target page (`field`: the one chosen). */
  onWritten?: (target: { id: string; title: string }, field: string) => Promise<void>;
}) {
  const wiki = useWiki();
  const [name, setName] = useState("");
  const chosen = name.trim() ? wiki.names.resolve(name) : null;
  const chosenId = chosen?.page.id ?? null;
  const chosenTitle = chosen?.page.title ?? name.trim();
  const [sourceId, sourceTitle] = fixedIs === "source" ? [fixed.id, fixed.title] : [chosenId, chosenTitle];
  const [targetId, targetTitle] = fixedIs === "source" ? [chosenId, chosenTitle] : [fixed.id, fixed.title];
  // The target page as it is now (to see what its fields hold).
  const [page, setPage] = useState<{ id: string; page: Page | null; error: string | null } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!targetId || !sourceId) return;
    let live = true;
    api.readPage(wiki.project, targetId).then(
      (p) => live && setPage({ id: targetId, page: p, error: p.infoboxError ? `${p.title}'s infobox can't be read, so it can't be changed here.` : null }),
      (e) => live && setPage({ id: targetId, page: null, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [targetId, sourceId, wiki.project]);

  const loaded = targetId && page?.id === targetId ? page : null;
  const missing = !!name.trim() && !chosen;
  const isSource = (n: string) => wiki.names.resolve(n)?.page.id === sourceId;
  const slots = useMemo(
    () => (loaded?.page && !loaded.error && sourceId ? slotsFor(loaded.page.infobox, from, isSource) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, from.join("\n"), wiki.names, sourceId],
  );
  // The one picked, else the first usable field in `from` order (a taken one
  // shows its warning rather than quietly picking another field).
  const picked = slots.find((s) => s.label === choice && selectable(s)) ?? slots.find(selectable) ?? null;
  const self = !!chosenId && chosenId === fixed.id;

  async function write(edit: RelationEdit) {
    if (!picked || !targetId || !sourceId) return;
    setBusy(true);
    setError(null);
    try {
      await api.setRelation(wiki.project, targetId, picked.label, sourceId, edit);
      await onWritten?.({ id: targetId, title: targetTitle }, picked.label);
      onDone();
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
        return `added to ${targetTitle}'s page as a new field`;
      case "taken":
        return `now: ${s.current.join(", ")}`;
      case "here":
        return `already ${sourceTitle}`;
      case "wrongType":
        return s.kind === "linkedfrom"
          ? "a Linked from field (it fills itself); make it a Page link field in the template to add here"
          : `a ${kindLabel(s.kind ?? "")} field; change it to Page link to use it here`;
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
              Add {sourceTitle} too
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
      <div className="dialog relation-dialog" role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>{title}</h2>
        <label className="field">
          <span>{pickLabel}</span>
          {/* A missing page gets "Create page…" (the given page's template suggested); then the choice below. */}
          <PageNameInput label={pickLabel} value={name} autoFocus fromPage={fixed.id} onChange={setName} />
        </label>

        {self && <p className="dialog-error">A page can't be listed in its own field.</p>}
        {chosen && !self && loaded?.error && <p className="dialog-error">{loaded.error}</p>}

        {missing && (
          <p className="dialog-note relation-missing">
            Create the page with <strong>Create page…</strong> under the name, then choose the field.
            {keepName && <> Or keep the name only (typed in on {fixed.title}'s page).</>}
          </p>
        )}

        {slots.length > 0 && !self && (
          <fieldset className="relation-slots">
            <legend>
              {sourceTitle} is {targetTitle}'s:
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
            {targetTitle}'s {picked.label} is already {picked.current.join(", ")}.
            {picked.kind === "link" && " It holds one page only."}
          </p>
        )}
        {picked && !self && (
          <p className="dialog-note relation-writes">
            Writes {sourceTitle} into {targetTitle}'s page. Nothing is stored on {sourceTitle}'s page.
          </p>
        )}
        {picked && !self && extra}
        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          {missing && keepName && (
            <button
              type="button"
              className="relation-typed"
              onClick={() => {
                keepName(name.trim());
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

/** What happens to a page's field when several pages are added at once. */
type TakenMode = "add" | "replace" | "skip";

/**
 * Add several…, second step: one field choice ("Alex is their: Father") for
 * all ticked pages, what that means for each of them, and pages whose field
 * already holds someone else: add next to them, replace, or skip.
 */
function AddSeveralDialog({ pageId, pageTitle, field, pages, close, onRelationsChanged }: RelationProps & { field: Field; pages: PageInfo[]; close: () => void }) {
  const wiki = useWiki();
  const from = field.options?.from ?? [];
  const [loaded, setLoaded] = useState<Map<string, Page | null> | null>(null);
  const [choice, setChoice] = useState(from[0] ?? "");
  const [taken, setTaken] = useState<TakenMode>("add");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all(pages.map((p) => api.readPage(wiki.project, p.id).catch(() => null))).then(
      (list) => live && setLoaded(new Map(pages.map((p, i) => [p.id, list[i]]))),
    );
    return () => {
      live = false;
    };
  }, [pages, wiki.project]);

  const thisPage = (n: string) => wiki.names.resolve(n)?.page.id === pageId;
  // Each page's state of the chosen field, and what Add will do there.
  const plan = pages.map((p) => {
    const page = loaded?.get(p.id);
    if (loaded && (!page || page.infoboxError)) return { p, edit: null, note: "its infobox can't be read: skipped" };
    const slot = page ? slotsFor(page.infobox, [choice], thisPage)[0] : null;
    if (!slot) return { p, edit: null, note: "…" };
    switch (slot.status) {
      case "empty":
        return { p, edit: "add" as const, note: "empty now" };
      case "missing":
        return { p, edit: "add" as const, note: "added as a new field" };
      case "here":
        return { p, edit: null, note: `already ${pageTitle}: skipped` };
      case "wrongType":
        return { p, edit: null, note: `a ${kindLabel(slot.kind ?? "")} field: skipped` };
      case "taken":
        if (taken === "skip") return { p, edit: null, note: `already ${slot.current.join(", ")}: skipped` };
        if (taken === "add" && slot.kind === "link") return { p, edit: null, note: `already ${slot.current.join(", ")} (one page only): skipped` };
        return { p, edit: taken, note: taken === "add" ? `${pageTitle} added next to ${slot.current.join(", ")}` : `replaces ${slot.current.join(", ")}` };
    }
  });
  const anyTaken = !!loaded && pages.some((p) => {
    const page = loaded.get(p.id);
    return page && slotsFor(page.infobox, [choice], thisPage)[0]?.status === "taken";
  });
  const todo = plan.filter((x) => x.edit);

  async function run() {
    setBusy(true);
    const bad: string[] = [];
    for (const x of todo) {
      try {
        await api.setRelation(wiki.project, x.p.id, choice, pageId, x.edit as RelationEdit);
      } catch {
        bad.push(x.p.title);
      }
    }
    onRelationsChanged();
    setBusy(false);
    if (bad.length) setFailed(bad);
    else close();
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide relation-dialog" role="dialog" aria-label={`Add several to ${field.label}`} onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Add {pages.length === 1 ? "1 page" : `${pages.length} pages`} to {field.label}</h2>
        <fieldset className="relation-slots">
          <legend>{pageTitle} is their:</legend>
          {from.map((name) => (
            <label key={name} className="check">
              <input type="radio" name="several-slot" checked={choice === name} onChange={() => setChoice(name)} />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
        {anyTaken && (
          <label className="field relation-taken">
            <span>Where {choice} already holds another page</span>
            <select value={taken} onChange={(e) => setTaken(e.target.value as TakenMode)}>
              <option value="add">Add {pageTitle} next to it</option>
              <option value="replace">Replace it with {pageTitle}</option>
              <option value="skip">Leave that page alone</option>
            </select>
          </label>
        )}
        <ul className="relation-list several-plan" aria-label="What happens on each page">
          {plan.map((x) => (
            <li key={x.p.id} className={x.edit ? "" : "skipped"}>
              <span className="relation-name">{x.p.title}</span>
              <span className="relation-source">{x.note}</span>
            </li>
          ))}
        </ul>
        <p className="dialog-note relation-writes">Writes {pageTitle} into each page's {choice}. Nothing is stored on {pageTitle}'s page.</p>
        {failed.length > 0 && <p className="dialog-error">These pages couldn't be changed: {failed.join(", ")}.</p>}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            {failed.length ? "Close" : "Cancel"}
          </button>
          {!failed.length && (
            <button type="button" className="primary" disabled={busy || !loaded || !todo.length} onClick={() => void run()}>
              {todo.length === 1 ? "Add to 1 page" : `Add to ${todo.length} pages`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
