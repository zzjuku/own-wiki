// The Infobox tab of the page editor: fill in the infobox values; add,
// remove, rename and reorder this page's own fields; change the box colour;
// add, switch or remove the infobox; restore or discard hidden values.
import { useRef, useState, type ReactNode } from "react";
import type { Field, FieldKind, Infobox, Template } from "./api";
import { ColorPicker, DragHandle, moveItem, useReorder } from "./controls";
import { useDialogs } from "./dialogs";
import {
  changeTemplate,
  cleanValue,
  convertValue,
  fieldHasValue,
  hasValue,
  instantiate,
  isLayout,
  kindLabel,
  newFieldLabel,
  rawValueText,
  valueProblem,
  valueText,
  type ImageValue,
} from "./infobox";
import { frameFor, useWiki } from "./wiki";
import { DateInput, ImageFrameContext, ImageInput, PageLinksInput, PageNameInput } from "./FieldInputs";
import { MiniEditor } from "./MiniEditor";
import { FieldDef } from "./TemplatesView";
import { Icon } from "./editorTheme";

interface Props {
  pageId: string;
  infobox: Infobox | null;
  /** The file has an infobox that can't be read. */
  error: string | null;
  templates: Template[];
  onChange: (ib: Infobox | null) => void;
}

let nextRowId = 0;
const newRowId = () => `row-${nextRowId++}`;

export function InfoboxForm({ pageId, infobox: ib, error, templates, onChange: change }: Props) {
  const dialogs = useDialogs();
  const wiki = useWiki();
  const [settingsOpen, setSettingsOpen] = useState<number | null>(null);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [menu, setMenu] = useState<"add" | "change" | null>(null);
  // Stable ids for the field rows, so each row keeps its own editor when
  // fields are added, removed or moved.
  const rowIds = useRef<string[]>([]);
  const count = ib?.fields.length ?? 0;
  if (rowIds.current.length !== count) rowIds.current = Array.from({ length: count }, newRowId);
  /** A change that keeps the fields where they are (values, settings, colour). */
  const onChange = (next: Infobox | null) => change(next);
  /** A change that adds, removes or moves fields: `ids` are the new rows' ids. */
  const restructure = (next: Infobox | null, ids: string[]) => {
    rowIds.current = ids;
    change(next);
  };
  const reorder = useReorder((from, to) => {
    if (!ib) return;
    setSettingsOpen(null);
    restructure({ ...ib, fields: moveItem(ib.fields, from, to) }, moveItem(rowIds.current, from, to));
  });

  if (error) {
    return (
      <div className="infobox-form">
        <p className="notice">
          This page's infobox can't be read, so it can't be edited here. The file is left as it is. ({error})
        </p>
      </div>
    );
  }

  const sortedTemplates = [...templates].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (!ib) {
    return (
      <div className="infobox-form">
        <div className="infobox-none">
          <p>This page has no infobox.</p>
          <div className="more-wrap">
            <button className="primary" onClick={() => setMenu(menu === "add" ? null : "add")}>
              Add infobox ▾
            </button>
            {menu === "add" && (
              <TemplateMenu
                templates={sortedTemplates}
                empty="Empty infobox"
                close={() => setMenu(null)}
                pick={(t) => {
                  const next = t ? instantiate(t) : { fields: [] };
                  restructure(next, next.fields.map(newRowId));
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  const template = ib.template ? templates.find((t) => t.id === ib.template) : undefined;
  const setFields = (fields: Field[]) => onChange({ ...ib, fields });
  const setField = (i: number, f: Field) => setFields(ib.fields.map((x, j) => (j === i ? f : x)));

  function removeField(i: number) {
    const f = ib!.fields[i];
    const go = () => {
      setSettingsOpen(null);
      restructure(
        { ...ib!, fields: ib!.fields.filter((_, j) => j !== i) },
        rowIds.current.filter((_, j) => j !== i),
      );
    };
    if (!fieldHasValue(f)) return go();
    dialogs.confirm({
      title: "Delete field",
      message: (
        <>
          Delete the field <strong>{f.label || "(no label)"}</strong> and its value on this page?
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
      submit: async () => go(),
    });
  }

  function addField(kind: FieldKind) {
    restructure({ ...ib!, fields: [...ib!.fields, { label: newFieldLabel(kind), type: kind }] }, [...rowIds.current, newRowId()]);
    setSettingsOpen(ib!.fields.length);
    setJustAdded(ib!.fields.length);
  }

  function pickTemplate(t: Template | null) {
    if (!t) return;
    const next = changeTemplate(ib!, t);
    const apply = () => {
      setSettingsOpen(null);
      restructure(next, next.fields.map(newRowId));
    };
    const hiddenNow = (next.hidden?.length ?? 0) - (ib!.hidden?.length ?? 0);
    if (hiddenNow <= 0) return apply();
    dialogs.confirm({
      title: "Change template",
      message: (
        <>
          Switch to <strong>{t.name}</strong>? Fields with the same name keep their values.{" "}
          {hiddenNow === 1 ? "1 other value becomes a hidden value" : `${hiddenNow} other values become hidden values`}{" "}
          (shown under Hidden values, where you can restore them).
        </>
      ),
      confirmLabel: "Change template",
      submit: async () => apply(),
    });
  }

  function removeInfobox() {
    dialogs.confirm({
      title: "Remove infobox",
      message: <>Remove this page's infobox with all its values{ib!.hidden?.length ? " and hidden values" : ""}?</>,
      confirmLabel: "Remove",
      danger: true,
      submit: async () => onChange(null),
    });
  }

  function setColor(color: string | null) {
    onChange({ ...ib!, color, ownColor: color !== (template?.color ?? null) ? true : undefined });
  }

  const hidden = ib.hidden ?? [];

  return (
    <ImageFrameContext.Provider value={frameFor(wiki, ib.template)}>
    <div className="infobox-form">
      <div className="infobox-form-head">
        <span className="infobox-template">
          {template ? (
            <>
              Template: <strong>{template.name}</strong>
            </>
          ) : ib.template ? (
            <span className="muted">From a template that was deleted</span>
          ) : (
            <span className="muted">No template</span>
          )}
        </span>
        <div className="spacer" />
        <div className="more-wrap">
          <button onClick={() => setMenu(menu === "change" ? null : "change")} disabled={!templates.length}>
            Change template ▾
          </button>
          {menu === "change" && (
            <TemplateMenu templates={sortedTemplates} current={ib.template ?? null} close={() => setMenu(null)} pick={pickTemplate} />
          )}
        </div>
        <button className="danger-text" onClick={removeInfobox}>
          Remove infobox
        </button>
      </div>

      <div className="infobox-color">
        <span>Colour</span>
        <ColorPicker
          value={ib.color}
          defaultLabel={template ? "Template colour" : "Theme colour"}
          onChange={(c) => setColor(c === null && template?.color ? template.color : c)}
        />
      </div>

      <ul className="ib-fields" ref={(el) => void (reorder.listRef.current = el)}>
        {ib.fields.map((f, i) => (
          <li key={`${rowIds.current[i]}:${f.type}`} data-reorder className={`ib-row ${isLayout(f.type) ? `is-${f.type}` : ""} ${reorder.rowClass(i, ib.fields.length)}`}>
            <div className="ib-line">
              <DragHandle label={`Move ${f.label}`} onPointerDown={(e) => reorder.start(e, i)} />
              {f.type === "heading" ? (
                <span className="ib-heading">{f.label || "Section"}</span>
              ) : f.type === "divider" ? (
                <span className="ib-divider">{f.label ? <span>{f.label}</span> : null}</span>
              ) : (
                <span className="ib-label" title={f.key ? undefined : "This page's own field"}>
                  {f.label || <span className="muted">(no label)</span>}
                </span>
              )}
              <button
                className={`plain ib-gear ${settingsOpen === i ? "active" : ""}`}
                title="Field settings: name, type, remove"
                aria-label={`Settings for ${f.label}`}
                aria-expanded={settingsOpen === i}
                onClick={() => setSettingsOpen(settingsOpen === i ? null : i)}
              >
                <GearIcon />
              </button>
              {!isLayout(f.type) && (
                <button
                  className={`plain ib-spoiler ${f.spoiler ? "active" : ""}`}
                  title={f.spoiler ? "Spoiler: the value stays hidden until clicked. Click to show it normally." : "Make this value a spoiler (hidden until clicked)"}
                  aria-label={`Spoiler: ${f.label}`}
                  aria-pressed={!!f.spoiler}
                  onClick={() => setField(i, { ...f, spoiler: f.spoiler ? undefined : true })}
                >
                  <Icon name="spoiler" />
                </button>
              )}
              {!isLayout(f.type) && (
                <div className="ib-input">
                  <ValueInput pageId={pageId} field={f} onChange={(value) => setField(i, { ...f, value: cleanValue(value) })} />
                </div>
              )}
            </div>
            {f.hint && <p className="ib-hint">{f.hint}</p>}
            {settingsOpen === i && (
              <div className="ib-settings">
                <FieldDef
                  field={f}
                  autoFocus={justAdded === i}
                  linkLabels={[]}
                  handle={null}
                  onChange={(nf) => {
                    const value = nf.type !== f.type && f.value !== undefined ? convertValue(f.value, nf.type) : nf.value;
                    setField(i, { ...nf, value: hasValue(nf.type) ? value : f.value });
                  }}
                  onRemove={() => removeField(i)}
                />
                {f.key && <p className="hint">This field came from the template. Changes here only affect this page.</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {ib.fields.length === 0 && <p className="empty small">No fields yet.</p>}
      <div className="row ib-add">
        <button onClick={() => addField("text")}>+ Add field</button>
        <button onClick={() => addField("heading")}>+ Add section heading</button>
        <button onClick={() => addField("divider")}>+ Add divider</button>
      </div>

      {hidden.length > 0 && (
        <details className="hidden-values">
          <summary>Hidden values ({hidden.length})</summary>
          <p className="hint">Values of fields that were removed from this page's infobox. Restore puts the field back.</p>
          <ul>
            {hidden.map((h, i) => (
              <li key={i}>
                <span className="ib-label">{h.label || "(no label)"}</span>
                <span className="hidden-value">{valueText(h)}</span>
                <span className="muted">{kindLabel(h.type)}</span>
                <div className="spacer" />
                <button
                  onClick={() =>
                    restructure(
                      {
                        ...ib,
                        fields: [...ib.fields, { ...h, key: undefined }],
                        hidden: hidden.filter((_, j) => j !== i).length ? hidden.filter((_, j) => j !== i) : undefined,
                      },
                      [...rowIds.current, newRowId()],
                    )
                  }
                >
                  Restore
                </button>
                <button
                  className="danger-text"
                  onClick={() =>
                    dialogs.confirm({
                      title: "Discard hidden value",
                      message: (
                        <>
                          Delete the hidden value of <strong>{h.label}</strong> for good?
                        </>
                      ),
                      confirmLabel: "Discard",
                      danger: true,
                      submit: async () => {
                        const rest = hidden.filter((_, j) => j !== i);
                        onChange({ ...ib, hidden: rest.length ? rest : undefined });
                      },
                    })
                  }
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
    </ImageFrameContext.Provider>
  );
}

function TemplateMenu({
  templates,
  current,
  empty,
  pick,
  close,
}: {
  templates: Template[];
  current?: string | null;
  empty?: string;
  pick: (t: Template | null) => void;
  close: () => void;
}) {
  return (
    <>
      <div className="menu-catcher" onMouseDown={close} />
      <div className="menu template-menu" role="menu">
        {empty && (
          <button
            role="menuitem"
            onClick={() => {
              close();
              pick(null);
            }}
          >
            {empty}
          </button>
        )}
        {templates.length > 0 && empty && <div className="menu-label">From a template</div>}
        {templates.map((t) => (
          <button
            key={t.id}
            role="menuitem"
            disabled={t.id === current}
            onClick={() => {
              close();
              pick(t);
            }}
          >
            {t.name}
            {t.id === current && " (current)"}
          </button>
        ))}
        {templates.length === 0 && !empty && <div className="menu-label">No templates yet</div>}
      </div>
    </>
  );
}

/** The input for one field's value, by type. Values that don't fit the type get a warning instead. */
function ValueInput({ pageId, field: f, onChange }: { pageId: string; field: Field; onChange: (v: unknown) => void }) {
  const problem = valueProblem(f);
  if (problem) {
    return (
      <div className="value-warning" role="alert">
        <span>⚠ {problem}</span>
        <span className="hidden-value">{rawValueText(f.value)}</span>
        <button type="button" onClick={() => onChange(undefined)}>
          Clear value
        </button>
      </div>
    );
  }
  const v = f.value;
  switch (f.type) {
    case "text":
      return <MiniEditor pageId={pageId} label={f.label} value={typeof v === "string" ? v : ""} onChange={onChange} />;
    case "longtext":
      return <MiniEditor multiline pageId={pageId} label={f.label} value={typeof v === "string" ? v : ""} onChange={onChange} />;
    case "number":
      return <NumberInput label={f.label} value={v as number | undefined} onChange={onChange} />;
    case "yesno":
      return (
        <select aria-label={f.label} value={v === true ? "yes" : v === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "yes")}>
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    case "choice":
      return (
        <select aria-label={f.label} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {(f.options?.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    case "list":
      return <ListInput pageId={pageId} label={f.label} value={Array.isArray(v) ? (v as string[]) : []} onChange={onChange} />;
    case "link":
      return <PageNameInput label={f.label} value={typeof v === "string" ? v : ""} onChange={onChange} />;
    case "links":
      return <PageLinksInput label={f.label} value={Array.isArray(v) ? (v as string[]) : []} onChange={onChange} />;
    case "date":
      return <DateInput label={f.label} value={v} ranges={!!f.options?.ranges} onChange={onChange} />;
    case "image":
      return <ImageInput pageId={pageId} label={f.label} value={v as ImageValue | undefined} onChange={onChange} />;
    default:
      return <span className="muted small">{kindLabel(f.type)} fields can't be edited yet.</span>;
  }
}

function NumberInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const bad = text.trim() !== "" && !Number.isFinite(Number(text.trim().replace(",", ".")));
  return (
    <>
      <input
        className={`ib-number ${bad ? "invalid" : ""}`}
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim().replace(",", ".");
          if (t === "") onChange(undefined);
          else if (Number.isFinite(Number(t))) onChange(Number(t));
        }}
      />
      {bad && <span className="ib-invalid">Not a number — not saved yet.</span>}
    </>
  );
}

function ListInput({ pageId, label, value, onChange }: { pageId: string; label: string; value: string[]; onChange: (v: unknown) => void }) {
  // Entries are edited in place; an empty entry stays while it's being typed.
  const [items, setItems] = useState<string[]>(value.length ? value : [""]);
  const update = (next: string[]) => {
    setItems(next);
    onChange(next);
  };
  return (
    <div className="ib-list">
      {items.map((item, i) => (
        <div key={i} className="ib-list-item">
          <MiniEditor pageId={pageId} label={`${label} ${i + 1}`} value={item} onChange={(t) => update(items.map((x, j) => (j === i ? t : x)))} />
          <button
            type="button"
            className="plain remove"
            title="Remove entry"
            aria-label="Remove entry"
            onClick={() => update(items.length > 1 ? items.filter((_, j) => j !== i) : [""])}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="plain add-entry" onClick={() => setItems([...items, ""])}>
        + Add entry
      </button>
    </div>
  );
}

function GearIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="icon">
      <path
        className="stroke thin"
        d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM6.9 1.5h2.2l.4 1.8 1.2.7 1.8-.6 1.1 1.9-1.4 1.2v1.4l1.4 1.2-1.1 1.9-1.8-.6-1.2.7-.4 1.8H6.9l-.4-1.8-1.2-.7-1.8.6-1.1-1.9L3.8 8.7V7.3L2.4 6.1l1.1-1.9 1.8.6 1.2-.7Z"
      />
    </svg>
  );
}
