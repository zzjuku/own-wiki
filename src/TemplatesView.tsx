// The Templates screen of a project: create, rename, copy and delete
// templates; edit each template's fields, infobox colour and starter text,
// with a live preview of the box. Templates are starting points: changing
// one never changes existing pages (see SPEC.md, M5).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Field, type FieldKind, type Frame, type PageInfo, type Template } from "./api";
import { Autosaver, registerFlusher, type SaveStatus } from "./autosave";
import { Chips, ColorPicker, DragHandle, moveItem, useReorder } from "./controls";
import { useDialogs } from "./dialogs";
import { infoboxHtml, instantiate, isLayout, KINDS, newFieldKey, newFieldLabel, newTemplateId } from "./infobox";
import { MiniEditor } from "./MiniEditor";
import { ApplyDialog, CopyTemplatesDialog } from "./TemplateDialogs";
import { useReportError } from "./notify";
import { displayGroup } from "./tree";
import { useLinkContext, useWiki } from "./wiki";
import { norm } from "./wikilinks";

/** Field types offered (Linked from is postponed; see SPEC.md, Open items). */
export const READY_KINDS: FieldKind[] = ["text", "longtext", "number", "yesno", "choice", "list", "links", "date", "image", "heading", "divider"];

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Editing…",
  saving: "Saving…",
  error: "Not saved",
};

/** The project's templates, saved a moment after each change. */
export function useTemplates(project: string) {
  const report = useReportError();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const saver = useMemo(
    () =>
      new Autosaver(
        (text) => api.setTemplates(project, JSON.parse(text) as Template[]),
        (s, e) => {
          setStatus(s);
          if (e) report(e);
        },
        500,
      ),
    [project, report],
  );
  useEffect(() => {
    const unregister = registerFlusher(() => saver.flush());
    return () => {
      unregister();
      void saver.flush();
    };
  }, [saver]);
  useEffect(() => {
    api.getTemplates(project).then(setTemplates, report);
  }, [project, report]);
  const update = useCallback(
    (next: Template[]) => {
      setTemplates(next);
      saver.change(JSON.stringify(next));
    },
    [saver],
  );
  const flush = useCallback(() => saver.flush(), [saver]);
  return { templates, update, status, flush };
}

export type TemplatesState = ReturnType<typeof useTemplates>;

interface Props {
  project: string;
  state: TemplatesState;
  selected: string | null;
  setSelected: (id: string | null) => void;
  openPage: (id: string) => void;
}

function nameProblem(name: string, templates: Template[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return "Name can't be empty.";
  const taken = templates.find((t) => t.id !== exceptId && norm(t.name) === norm(n));
  return taken ? `A template named “${taken.name}” already exists.` : null;
}

export function TemplatesView({ project, state, selected, setSelected, openPage }: Props) {
  const dialogs = useDialogs();
  const { templates, update, status } = state;
  const current = templates.find((t) => t.id === selected) ?? null;
  const [copyOpen, setCopyOpen] = useState(false);

  useEffect(() => {
    if (!current && templates.length) setSelected(templates[0].id);
  }, [current, templates, setSelected]);

  function create() {
    dialogs.prompt({
      title: "New template",
      label: "Template name",
      confirmLabel: "Create",
      submit: async (name) => {
        const problem = nameProblem(name, templates);
        if (problem) throw problem;
        const t: Template = { id: newTemplateId(name), name: name.trim(), color: null, fields: [] };
        update([...templates, t]);
        setSelected(t.id);
      },
    });
  }

  function change(t: Template) {
    update(templates.map((x) => (x.id === t.id ? t : x)));
  }

  function rename(t: Template) {
    dialogs.prompt({
      title: "Rename template",
      label: "Template name",
      initial: t.name,
      note: <>Pages created from it keep their infoboxes as they are.</>,
      confirmLabel: "Rename",
      submit: async (name) => {
        const problem = nameProblem(name, templates, t.id);
        if (problem) throw problem;
        change({ ...t, name: name.trim() });
      },
    });
  }

  function duplicate(t: Template) {
    let n = 2;
    while (templates.some((x) => norm(x.name) === norm(`${t.name} (${n})`))) n++;
    dialogs.prompt({
      title: "Copy template",
      label: "Name of the copy",
      initial: `${t.name} (${n})`,
      confirmLabel: "Copy",
      submit: async (name) => {
        const problem = nameProblem(name, templates);
        if (problem) throw problem;
        const copy: Template = { ...structuredClone(t), id: newTemplateId(name), name: name.trim() };
        update([...templates, copy]);
        setSelected(copy.id);
      },
    });
  }

  async function remove(t: Template) {
    const using = await api.templatePages(project, t.id).catch(() => [] as PageInfo[]);
    dialogs.confirm({
      title: "Delete template",
      message: (
        <>
          Delete the template <strong>{t.name}</strong>?{" "}
          {using.length
            ? `${using.length} ${using.length === 1 ? "page was" : "pages were"} created from it; they keep their infoboxes as they are.`
            : "No page was created from it."}
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
      submit: async () => {
        update(templates.filter((x) => x.id !== t.id));
        setSelected(null);
      },
    });
  }

  const sorted = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [templates]);

  return (
    <div className="templates-view">
      <header className="page-head">
        <div className="page-titles">
          <h1>Templates</h1>
        </div>
        <div className="spacer" />
        <span className={`save-status ${status}`} aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        <button onClick={() => setCopyOpen(true)}>Copy from another project…</button>
        <button className="primary" onClick={create}>
          New template
        </button>
      </header>
      {copyOpen && (
        <CopyTemplatesDialog
          project={project}
          templates={templates}
          close={() => setCopyOpen(false)}
          onCopy={(copies) => {
            if (!copies.length) return;
            update([...templates, ...copies]);
            setSelected(copies[0].id);
          }}
        />
      )}
      <div className="templates-body">
        <nav className="template-list" aria-label="Templates">
          {sorted.map((t) => (
            <button
              key={t.id}
              className={`plain template-item ${t.id === current?.id ? "selected" : ""}`}
              onClick={() => setSelected(t.id)}
            >
              <span className="template-dot" style={t.color ? { background: t.color } : undefined} />
              <span className="template-name">{t.name}</span>
              <span className="template-count">{t.fields.filter((f) => !isLayout(f.type)).length}</span>
            </button>
          ))}
          {templates.length === 0 && (
            <p className="empty small">
              No templates yet. A template sets the infobox fields (and starter text) new pages begin with.
            </p>
          )}
        </nav>
        {current ? (
          <TemplateEditor
            key={current.id}
            project={project}
            template={current}
            templates={templates}
            onChange={change}
            onRename={() => rename(current)}
            onDuplicate={() => duplicate(current)}
            onDelete={() => void remove(current)}
            openPage={openPage}
            flush={state.flush}
          />
        ) : (
          <p className="empty center">{templates.length ? "" : "Create a template to get started."}</p>
        )}
      </div>
    </div>
  );
}

interface EditorProps {
  project: string;
  template: Template;
  templates: Template[];
  onChange: (t: Template) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  openPage: (id: string) => void;
  flush: () => Promise<void>;
}

function TemplateEditor({ project, template: t, templates, onChange, onRename, onDuplicate, onDelete, openPage, flush }: EditorProps) {
  const wiki = useWiki();
  const links = useLinkContext();
  const [using, setUsing] = useState<PageInfo[] | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  // Bumped after Apply, to re-read the pages using the template.
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    let live = true;
    api.templatePages(project, t.id).then((p) => live && setUsing(p), () => live && setUsing([]));
    return () => {
      live = false;
    };
  }, [project, t.id, wiki.names, applied]);

  const setFields = (fields: Field[]) => onChange({ ...t, fields });
  // A field just added gets its label selected for typing.
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const reorder = useReorder((from, to) => setFields(moveItem(t.fields, from, to)));

  function addField(kind: FieldKind) {
    setFields([...t.fields, { key: newFieldKey(t.fields), label: newFieldLabel(kind), type: kind }]);
    setJustAdded(t.fields.length);
  }

  // Link fields of every template, for "Linked from".
  const linkLabels = useMemo(() => {
    const set = new Map<string, string>();
    for (const tpl of templates)
      for (const f of tpl.fields) if (f.type === "link" || f.type === "links") set.set(norm(f.label), f.label);
    return [...set.values()];
  }, [templates]);

  const preview = useMemo(
    () => infoboxHtml(instantiate(t), { project, title: "Page title", links, placeholders: true, frame: t.imageFrame ?? wiki.imageFrame }),
    [t, project, links, wiki.imageFrame],
  );

  return (
    <div className="template-editor">
      <div className="template-main">
        <div className="template-head">
          <h2>{t.name}</h2>
          <div className="spacer" />
          <button onClick={onRename}>Rename</button>
          <button onClick={onDuplicate}>Copy</button>
          <button className="danger-text" onClick={onDelete}>
            Delete
          </button>
        </div>

        <section className="template-section">
          <h3>Infobox colour</h3>
          <ColorPicker value={t.color} onChange={(color) => onChange({ ...t, color })} />
          <p className="hint">Colours the title bar and section headings. New pages start with it; each page can change its own.</p>
        </section>

        <section className="template-section">
          <h3>Infobox image size</h3>
          <p className="hint">
            Every image in the infobox sits in a frame of this size, filled and cropped to fit. Each Image field can choose which
            part of its image shows.
          </p>
          <div className="frame-choice">
            <label className="check">
              <input type="radio" name="frame" checked={!t.imageFrame} onChange={() => onChange({ ...t, imageFrame: undefined })} />
              <span>Project size</span>
            </label>
            <FrameInputs value={wiki.imageFrame} onChange={wiki.setImageFrame} label="Project image size" />
            <span className="muted small">for every template without its own size</span>
          </div>
          <div className="frame-choice">
            <label className="check">
              <input type="radio" name="frame" checked={!!t.imageFrame} onChange={() => onChange({ ...t, imageFrame: { ...wiki.imageFrame } })} />
              <span>Own size for this template</span>
            </label>
            {t.imageFrame && <FrameInputs value={t.imageFrame} onChange={(imageFrame) => onChange({ ...t, imageFrame })} label="Template image size" />}
          </div>
        </section>

        <section className="template-section">
          <h3>Fields</h3>
          <ul className="field-defs" ref={(el) => void (reorder.listRef.current = el)}>
            {t.fields.map((f, i) => (
              <li key={f.key ?? i} data-reorder className={`field-def ${isLayout(f.type) ? `is-${f.type}` : ""} ${reorder.rowClass(i, t.fields.length)}`}>
                <FieldDef
                  field={f}
                  autoFocus={justAdded === i}
                  linkLabels={linkLabels}
                  onChange={(nf) => setFields(t.fields.map((x, j) => (j === i ? nf : x)))}
                  onRemove={() => setFields(t.fields.filter((_, j) => j !== i))}
                  handle={<DragHandle label={`Move ${f.label}`} onPointerDown={(e) => reorder.start(e, i)} />}
                />
              </li>
            ))}
          </ul>
          {t.fields.length === 0 && <p className="empty small">No fields yet.</p>}
          <div className="row">
            <button onClick={() => addField("text")}>+ Add field</button>
            <button onClick={() => addField("heading")}>+ Add section heading</button>
            <button onClick={() => addField("divider")}>+ Add divider</button>
          </div>
        </section>

        <section className="template-section">
          <h3>Default categories</h3>
          <p className="hint">New pages from this template start in these categories (each page can change its own).</p>
          <Chips
            values={t.categories ?? []}
            onChange={(categories) => onChange({ ...t, categories: categories.length ? categories : undefined })}
            placeholder="Add a category"
            suggestions={wiki.categories.list.map((c) => c.name)}
            label="Default categories"
          />
        </section>

        <section className="template-section">
          <h3>Starter text</h3>
          <p className="hint">New pages from this template begin with this text (for example the usual section headings).</p>
          <MiniEditor
            multiline
            toolbar
            className="starter-text"
            label="Starter text"
            placeholder="Optional"
            value={t.starterText ?? ""}
            onChange={(starterText) => onChange({ ...t, starterText })}
          />
        </section>

        <section className="template-section">
          <h3>Pages using this template{using && ` (${using.length})`}</h3>
          {using && using.length === 0 && <p className="empty small">No page was created from this template yet.</p>}
          {using && using.length > 0 && (
            <ul className="using-list">
              {using.map((p) => (
                <li key={p.id}>
                  <button className="plain using-page" onClick={() => openPage(p.id)}>
                    <span>{p.title}</span>
                    {p.group && <span className="muted">{displayGroup(p.group)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Changes to the template don't change these pages by themselves.</p>
          <button disabled={!using?.length} onClick={() => setApplyOpen(true)}>
            Apply to existing pages…
          </button>
        </section>
        {applyOpen && (
          <ApplyDialog
            project={project}
            template={t}
            flush={flush}
            close={() => setApplyOpen(false)}
            onApplied={() => setApplied((n) => n + 1)}
          />
        )}
      </div>

      <aside className="template-preview" aria-label="Preview">
        <h3>Preview</h3>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: preview }} />
      </aside>
    </div>
  );
}

const FRAME_MIN = 40;
const FRAME_MAX = 1200;

/** Width × height boxes; only sizes between 40 and 1,200 px are passed on. */
function FrameInputs({ value, onChange, label }: { value: Frame; onChange: (f: Frame) => void; label: string }) {
  const [w, setW] = useState(String(value.width));
  const [h, setH] = useState(String(value.height));
  useEffect(() => {
    setW(String(value.width));
    setH(String(value.height));
  }, [value.width, value.height]);
  const ok = (t: string) => /^\d+$/.test(t.trim()) && Number(t) >= FRAME_MIN && Number(t) <= FRAME_MAX;
  const commit = (nw: string, nh: string) => {
    if (ok(nw) && ok(nh) && (Number(nw) !== value.width || Number(nh) !== value.height)) onChange({ width: Number(nw), height: Number(nh) });
  };
  const title = `${FRAME_MIN}–${FRAME_MAX} pixels`;
  return (
    <span className="frame-inputs" role="group" aria-label={label}>
      <input
        inputMode="numeric"
        aria-label={`${label}: width`}
        title={title}
        className={ok(w) ? "" : "invalid"}
        value={w}
        onChange={(e) => {
          setW(e.target.value);
          commit(e.target.value, h);
        }}
        onBlur={() => setW(String(value.width))}
      />
      <span>×</span>
      <input
        inputMode="numeric"
        aria-label={`${label}: height`}
        title={title}
        className={ok(h) ? "" : "invalid"}
        value={h}
        onChange={(e) => {
          setH(e.target.value);
          commit(w, e.target.value);
        }}
        onBlur={() => setH(String(value.height))}
      />
      <span className="muted">px</span>
    </span>
  );
}

export function FieldDef({
  field: f,
  autoFocus,
  linkLabels,
  onChange,
  onRemove,
  handle,
}: {
  field: Field;
  autoFocus?: boolean;
  linkLabels: string[];
  onChange: (f: Field) => void;
  onRemove: () => void;
  handle: React.ReactNode;
}) {
  const options = f.options ?? {};
  const setOptions = (o: Field["options"]) => {
    const clean = Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length)));
    onChange({ ...f, options: Object.keys(clean).length ? clean : undefined });
  };
  const kinds = KINDS.filter((k) => READY_KINDS.includes(k.kind) || k.kind === f.type);

  if (isLayout(f.type)) {
    const heading = f.type === "heading";
    const name = heading ? "Section heading" : "Divider label";
    return (
      <div className="field-def-row">
        {handle}
        <span className="field-def-kind">{heading ? "Section" : "Divider"}</span>
        <input
          className={`field-label ${f.type}-label`}
          autoFocus={autoFocus}
          onFocus={(e) => autoFocus && e.target.select()}
          value={f.label}
          aria-label={name}
          placeholder={heading ? "Section heading" : "Label (optional)"}
          onChange={(e) => onChange({ ...f, label: e.target.value })}
        />
        <button className="plain remove" title={`Remove ${heading ? "section heading" : "divider"}`} aria-label={`Remove ${heading ? "section heading" : "divider"}`} onClick={onRemove}>
          ×
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="field-def-row">
        {handle}
        <input
          className="field-label"
          autoFocus={autoFocus}
          onFocus={(e) => autoFocus && e.target.select()}
          value={f.label}
          aria-label="Field label"
          placeholder="Field label"
          onChange={(e) => onChange({ ...f, label: e.target.value })}
        />
        <select
          className="field-kind"
          aria-label="Field type"
          value={f.type}
          onChange={(e) => onChange({ ...f, type: e.target.value as FieldKind })}
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button className="plain remove" title="Remove field" aria-label={`Remove ${f.label}`} onClick={onRemove}>
          ×
        </button>
      </div>
      <div className="field-def-extra">
        {f.type === "choice" && (
          <label className="field-option">
            <span>Options</span>
            <Chips
              label="Options"
              values={options.choices ?? []}
              placeholder="Add option…"
              onChange={(choices) => setOptions({ ...options, choices })}
            />
          </label>
        )}
        {f.type === "linkedfrom" && (
          <label className="field-option">
            <span>Pages whose</span>
            <Chips
              label="Fields that point here"
              values={options.from ?? []}
              placeholder="Field name, e.g. a Page link field…"
              suggestions={linkLabels}
              onChange={(from) => setOptions({ ...options, from })}
            />
            <span className="muted">points to this page</span>
          </label>
        )}
        {f.type === "date" && (
          <label className="check">
            <input type="checkbox" checked={!!options.ranges} onChange={(e) => setOptions({ ...options, ranges: e.target.checked })} />
            <span>Allow ranges (start and end date)</span>
          </label>
        )}
        <input
          className="field-hint"
          value={f.hint ?? ""}
          aria-label="Hint"
          placeholder="Hint (optional help shown under the field)"
          onChange={(e) => onChange({ ...f, hint: e.target.value || undefined })}
        />
      </div>
    </>
  );
}
