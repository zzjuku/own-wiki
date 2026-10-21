// Inputs for the infobox field types that aren't plain text: page links,
// dates and images.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type Frame } from "./api";
import { useFileDrop } from "./dropFiles";
import { FIELD_IMAGE_EXTENSIONS, hasExtension } from "./images";
import { AdjustPicture, styleObject } from "./AdjustPicture";
import { cleanValue, dateEntries, imageUrl, isRange, pictureStyle, type Crop, type DateEntry, type DatePoint, type DateRange, type ImageValue, type Qualifier } from "./infobox";
import { MiniEditor } from "./MiniEditor";
import { MultiPagePicker } from "./MultiPagePicker";
import { entryPage, hasWords, joinLinkEntry, parseLinkEntry } from "./linkEntry";
import { displayGroup } from "./tree";
import { DEFAULT_FRAME, useWiki } from "./wiki";

// ---- page links ----

/** A page name with suggestions; names of missing pages show red. */
export function PageNameInput({
  value,
  onChange,
  label,
  autoFocus,
  fromPage,
  onEnter,
}: {
  value: string;
  onChange: (name: string) => void;
  label: string;
  autoFocus?: boolean;
  /** The page being edited: a missing page can then be created from here (staying on it). */
  fromPage?: string;
  /** Enter while no suggestion list is open (e.g. start the next entry). */
  onEnter?: () => void;
}) {
  const wiki = useWiki();
  const [text, setText] = useState(value);
  const [suggest, setSuggest] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => setText(value), [value]);
  const suggestions = useMemo(() => (suggest && text.trim() ? wiki.names.search(text, 8) : []), [suggest, text, wiki.names]);
  const missing = text.trim() !== "" && !wiki.names.resolve(text);

  function set(name: string) {
    // Link characters can't be part of a page name.
    const clean = name.replace(/[[\]|\n]/g, "");
    setText(clean);
    onChange(clean);
  }

  return (
    <div className="page-name-input">
      <input
        className={missing ? "missing" : ""}
        value={text}
        aria-label={label}
        placeholder="Page name"
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => {
          set(e.target.value);
          setSuggest(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setSuggest(false), 150)}
        onKeyDown={(e) => {
          if (!suggestions.length) {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter();
            }
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            set(suggestions[active].name);
            setSuggest(false);
          } else if (e.key === "Escape") {
            // Closes the suggestions only, not a dialog around the input.
            e.stopPropagation();
            setSuggest(false);
          }
        }}
      />
      {suggestions.length > 0 && (
        <ul className="link-suggest name-suggest" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={`${s.page.id}\n${s.name}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                set(s.name);
                setSuggest(false);
              }}
            >
              <span>{s.name}</span>
              <span className="muted">{s.alias ? `→ ${s.page.title}` : displayGroup(s.page.group)}</span>
            </li>
          ))}
        </ul>
      )}
      {missing && !suggestions.length && (
        <span className="ib-note missing-note">
          Page doesn't exist yet (red link)
          {fromPage !== undefined && (
            <button
              type="button"
              className="plain create-missing"
              onClick={() => wiki.createFromLink(text.trim(), fromPage, { stay: true, onCreated: (p) => set(p.title) })}
            >
              Create page…
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** One Page link entry: the page, and optionally words before and after the
 * link ("Lord [[Page A]]") that show only in this infobox. */
export function LinkEntryInput({
  value,
  onChange,
  label,
  autoFocus,
  fromPage,
  onEnter,
}: {
  value: string;
  onChange: (entry: string) => void;
  label: string;
  autoFocus?: boolean;
  fromPage?: string;
  onEnter?: () => void;
}) {
  const parsed = parseLinkEntry(value);
  // The words are kept as typed (spaces included) and saved trimmed.
  const [words, setWords] = useState<{ before: string; after: string } | null>(() =>
    hasWords(value) ? { before: parsed.before, after: parsed.after } : null,
  );
  const [page, setPage] = useState(parsed.page);
  const emit = (p: string, w: { before: string; after: string } | null) =>
    onChange(p.trim() ? joinLinkEntry({ page: p, before: w?.before ?? "", after: w?.after ?? "" }) : "");
  return (
    <div className="link-entry">
      <div className="link-entry-main">
        <PageNameInput
          label={label}
          value={page}
          autoFocus={autoFocus}
          fromPage={fromPage}
          onEnter={onEnter}
          onChange={(p) => {
            setPage(p);
            emit(p, words);
          }}
        />
        <button
          type="button"
          className={`plain link-words-toggle ${words ? "active" : ""}`}
          title={words ? "Remove the words around the link" : "Add words before or after the link (shown only in this infobox)"}
          aria-label={`Words around ${label}`}
          aria-pressed={!!words}
          onClick={() => {
            const next = words ? null : { before: "", after: "" };
            setWords(next);
            emit(page, next);
          }}
        >
          Aa
        </button>
      </div>
      {words && (
        <div className="link-words">
          <input
            aria-label={`${label}: words before`}
            placeholder="Before (e.g. Lord)"
            value={words.before}
            onChange={(e) => {
              const next = { ...words, before: e.target.value };
              setWords(next);
              emit(page, next);
            }}
          />
          <span className="link-words-page">{page.trim() || "…"}</span>
          <input
            aria-label={`${label}: words after`}
            placeholder="After"
            value={words.after}
            onChange={(e) => {
              const next = { ...words, after: e.target.value };
              setWords(next);
              emit(page, next);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Rows of a list input (List and Page link fields) with stable keys, so a
 * row inserted in the middle gets its own, focused input. An empty row stays
 * while it's being typed. */
export function useListRows(value: string[], onChange: (v: unknown) => void) {
  const nextId = useRef(0);
  const [rows, setRows] = useState(() => (value.length ? value : [""]).map((item) => ({ item, id: nextId.current++ })));
  const [focus, setFocus] = useState<number | null>(null);
  const update = (next: { item: string; id: number }[], save = true) => {
    setRows(next);
    if (save) onChange(next.map((r) => r.item));
  };
  /** A new empty row after row `i`, focused. */
  const insert = (i: number) => {
    const id = nextId.current++;
    update([...rows.slice(0, i + 1), { item: "", id }, ...rows.slice(i + 1)], false);
    setFocus(id);
  };
  return {
    rows: rows.map((r) => ({ ...r, focus: r.id === focus })),
    set: (i: number, item: string) => update(rows.map((r, j) => (j === i ? { ...r, item } : r))),
    remove: (i: number) => update(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ item: "", id: rows[0].id }]),
    add: () => insert(rows.length - 1),
    /** Adds several entries at the end (an empty last row is filled first). */
    append: (items: string[]) => {
      const kept = rows.filter((r, i) => r.item.trim() || i < rows.length - 1);
      update([...kept, ...items.map((item) => ({ item, id: nextId.current++ }))]);
    },
    /** Enter in row `i`: the next row starts (not after an empty one). */
    enter: (i: number) => void (rows[i].item.trim() && insert(i)),
  };
}

/** Several page names (Page links fields). */
export function PageLinksInput({ value, onChange, label, fromPage }: { value: string[]; onChange: (v: unknown) => void; label: string; fromPage?: string }) {
  const wiki = useWiki();
  const list = useListRows(value, onChange);
  const [picking, setPicking] = useState(false);
  const here = new Set(list.rows.map((r) => wiki.names.resolve(entryPage(r.item))?.page.id).filter(Boolean));
  return (
    <div className="ib-list">
      {list.rows.map((r, i) => (
        <div key={r.id} className="ib-list-item">
          <LinkEntryInput
            label={`${label} ${i + 1}`}
            value={r.item}
            autoFocus={r.focus}
            fromPage={fromPage}
            onEnter={() => list.enter(i)}
            onChange={(t) => list.set(i, t)}
          />
          <button type="button" className="plain remove" title="Remove page" aria-label="Remove page" onClick={() => list.remove(i)}>
            ×
          </button>
        </div>
      ))}
      <div className="row add-entries">
        <button type="button" className="plain add-entry" onClick={() => list.add()}>
          + Add page
        </button>
        <button type="button" className="plain add-entry" onClick={() => setPicking(true)}>
          + Add several…
        </button>
      </div>
      {picking && (
        <MultiPagePicker
          title={`Add pages to ${label}`}
          confirmLabel={(n) => (n === 1 ? "Add 1 page" : `Add ${n} pages`)}
          unavailable={(p) => (p.id === fromPage ? "this page" : here.has(p.id) ? "already here" : null)}
          onPick={(pages) => list.append(pages.map((p) => p.title))}
          close={() => setPicking(false)}
        />
      )}
    </div>
  );
}

// ---- dates ----

/** A whole-number box; text that isn't a whole number stays local and shows red. */
function IntInput({
  value,
  onChange,
  placeholder,
  className,
  label,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder: string;
  className: string;
  label: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    setText((t) => (Number(t.trim().replace("−", "-")) === value ? t : value === undefined ? (t.trim() ? t : "") : String(value)));
  }, [value]);
  const t = text.trim().replace("−", "-");
  const bad = t !== "" && !/^-?\d+$/.test(t);
  return (
    <input
      className={`${className} ${bad ? "invalid" : ""}`}
      inputMode="numeric"
      placeholder={placeholder}
      aria-label={label}
      title={bad ? "Whole numbers only" : label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim().replace("−", "-");
        if (v === "") onChange(undefined);
        else if (/^-?\d+$/.test(v)) onChange(Number(v));
      }}
    />
  );
}

function DatePointInput({ value, onChange, label }: { value: DatePoint; onChange: (p: DatePoint) => void; label: string }) {
  const set = (patch: Partial<DatePoint>) => onChange({ ...value, ...patch });
  return (
    <div className="date-point">
      <select
        aria-label={`${label}: exact or approximate`}
        value={value.qualifier ?? ""}
        onChange={(e) => set({ qualifier: (e.target.value || undefined) as Qualifier | undefined })}
      >
        <option value="">exact</option>
        <option value="c">c.</option>
        <option value="before">before</option>
        <option value="after">after</option>
      </select>
      <IntInput className="date-day" placeholder="Day" label={`${label}: day`} value={value.day} onChange={(day) => set({ day })} />
      <IntInput className="date-month" placeholder="Month" label={`${label}: month`} value={value.month} onChange={(month) => set({ month })} />
      <IntInput className="date-year" placeholder="Year" label={`${label}: year`} value={value.year} onChange={(year) => set({ year })} />
      <input
        className="date-era"
        placeholder="Era"
        aria-label={`${label}: era`}
        value={value.era ?? ""}
        onChange={(e) => set({ era: e.target.value || undefined })}
      />
    </div>
  );
}

/** Drops empty parts, so an untouched date is stored as nothing. */
function cleanPoint(p: DatePoint | undefined): DatePoint | undefined {
  if (!p) return undefined;
  const out = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as DatePoint;
  // A qualifier alone is no date.
  return Object.keys(out).some((k) => k !== "qualifier") ? out : undefined;
}

export function DateInput({
  value,
  ranges,
  onChange,
  label,
}: {
  value: unknown;
  ranges: boolean;
  onChange: (v: unknown) => void;
  label: string;
}) {
  const asRange = ranges || isRange(value);
  const range: DateRange = isRange(value) ? value : { start: (value as DatePoint) ?? undefined };
  const [draft, setDraft] = useState<DateRange>(range);
  const point: DatePoint = draft.start ?? {};

  function emit(next: DateRange) {
    setDraft(next);
    if (!asRange) return onChange(cleanValue(cleanPoint(next.start)));
    const start = cleanPoint(next.start);
    const end = next.end === "present" ? "present" : cleanPoint(next.end);
    onChange(start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined);
  }

  if (!asRange) return <DatePointInput label={label} value={point} onChange={(start) => emit({ start })} />;
  const present = draft.end === "present";
  return (
    <div className="date-range">
      <div className="date-row">
        <span className="date-label">From</span>
        <DatePointInput label={`${label} from`} value={point} onChange={(start) => emit({ ...draft, start })} />
      </div>
      <div className="date-row">
        <span className="date-label">To</span>
        {!present && (
          <DatePointInput
            label={`${label} to`}
            value={draft.end && draft.end !== "present" ? draft.end : {}}
            onChange={(end) => emit({ ...draft, end })}
          />
        )}
        <label className="check date-present">
          <input type="checkbox" checked={present} onChange={(e) => emit({ ...draft, end: e.target.checked ? "present" : undefined })} />
          <span>present</span>
        </label>
      </div>
    </div>
  );
}

/** Date, place / Date, text fields: a date (or range) and a text after it;
 * with `multiple`, a list of such entries. */
export function DateTextInput({
  pageId,
  value,
  ranges,
  multiple,
  place,
  onChange,
  label,
}: {
  pageId: string;
  value: unknown;
  ranges: boolean;
  multiple: boolean;
  /** Date, place (else Date, text). */
  place: boolean;
  onChange: (v: unknown) => void;
  label: string;
}) {
  const initial = dateEntries(value);
  // A list stays a list even if the field was switched back to one entry, so nothing is dropped.
  const several = multiple || initial.length > 1;
  const nextId = useRef(0);
  const [rows, setRows] = useState(() => (initial.length ? initial : [{}]).map((e) => ({ e, id: nextId.current++ })));
  const save = (next: { e: DateEntry; id: number }[]) => {
    setRows(next);
    const entries = next.map((r) => r.e).filter((e) => cleanValue(e.date) !== undefined || e.text?.trim());
    onChange(several ? entries : entries[0]);
  };
  const set = (i: number, e: DateEntry) => save(rows.map((r, j) => (j === i ? { ...r, e: { ...(cleanValue(e.date) !== undefined ? { date: e.date } : {}), ...(e.text?.trim() ? { text: e.text } : {}) } } : r)));
  return (
    <div className="ib-list date-text-list">
      {rows.map((r, i) => (
        <div key={r.id} className="date-text-entry">
          <div className="date-text-fields">
            <DateInput label={several ? `${label} ${i + 1}` : label} value={r.e.date} ranges={ranges} onChange={(date) => set(i, { ...r.e, date })} />
            <MiniEditor
              pageId={pageId}
              label={`${label}${several ? ` ${i + 1}` : ""}: ${place ? "place" : "text"}`}
              placeholder={place ? "Place" : "Text"}
              value={r.e.text ?? ""}
              onChange={(text) => set(i, { ...r.e, text })}
            />
          </div>
          {several && (
            <button
              type="button"
              className="plain remove"
              title="Remove entry"
              aria-label="Remove entry"
              onClick={() => save(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ e: {}, id: nextId.current++ }])}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {several && (
        <button type="button" className="plain add-entry" onClick={() => setRows([...rows, { e: {}, id: nextId.current++ }])}>
          + Add entry
        </button>
      )}
    </div>
  );
}

// ---- images ----

/** The frame size infobox images on this page sit in (set by the Infobox tab). */
export const ImageFrameContext = createContext<Frame>(DEFAULT_FRAME);

const PREVIEW_MAX = 200;

/** The image in its infobox frame, small; clicking it opens Adjust picture. */
function CropFrame({ project, value, onChange }: { project: string; value: ImageValue; onChange: (crop: Crop) => void }) {
  const frame = useContext(ImageFrameContext);
  const k = Math.min(1, PREVIEW_MAX / frame.width, PREVIEW_MAX / frame.height);
  const pw = Math.round(frame.width * k);
  const ph = Math.round(frame.height * k);
  const [adjusting, setAdjusting] = useState(false);

  return (
    <div className="crop-wrap">
      <button
        type="button"
        className="plain crop-frame"
        style={{ width: pw, height: ph }}
        title="Adjust which part of the picture shows, and how large"
        onClick={() => setAdjusting(true)}
      >
        <img src={imageUrl(project, value.file!, frame.width)} alt="" draggable={false} style={styleObject(pictureStyle(value.crop, frame))} />
      </button>
      <button type="button" onClick={() => setAdjusting(true)}>
        Adjust picture…
      </button>
      {adjusting && (
        <AdjustPicture
          project={project}
          file={value.file!}
          crop={value.crop}
          frame={frame}
          close={() => setAdjusting(false)}
          save={(crop) => {
            setAdjusting(false);
            onChange(crop);
          }}
        />
      )}
    </div>
  );
}

export function ImageInput({
  pageId,
  value,
  onChange,
  label,
}: {
  pageId: string;
  value: ImageValue | undefined;
  onChange: (v: unknown) => void;
  label: string;
}) {
  const wiki = useWiki();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const img = value ?? {};
  const boxRef = useRef<HTMLDivElement>(null);

  async function use(path: () => Promise<string | null>) {
    setError(null);
    try {
      const p = await path();
      if (!p) return;
      setBusy(true);
      const file = await api.importImage(wiki.project, p, false);
      // A new picture starts centred in the frame.
      onChange({ ...img, file, crop: undefined });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const choose = () =>
    use(async () => {
      const path = await open({
        multiple: false,
        directory: false,
        title: "Choose an image",
        filters: [{ name: "Images", extensions: FIELD_IMAGE_EXTENSIONS }],
      });
      return typeof path === "string" ? path : null;
    });

  useFileDrop(boxRef, (paths) => {
    const p = paths.find((x) => hasExtension(x, FIELD_IMAGE_EXTENSIONS));
    if (!p) return setError("Only PNG, JPG, GIF and WebP images can be used in infobox fields.");
    void use(async () => p);
  });

  return (
    <div className="image-input" ref={boxRef}>
      {img.file ? (
        <div className="image-chosen">
          <CropFrame project={wiki.project} value={img} onChange={(crop) => onChange({ ...img, crop })} />
          <div className="image-meta">
            <span className="image-file" title={`assets/${img.file}`}>
              {img.file}
            </span>
            <div className="row">
              <button type="button" onClick={() => void choose()} disabled={busy}>
                Replace…
              </button>
              <button
                type="button"
                title="Takes the image out of this field. The file stays in the project's assets folder."
                onClick={() => onChange(cleanValue({ ...img, file: undefined, crop: undefined }) as ImageValue | undefined)}
              >
                Remove
              </button>
            </div>
            {img.crop && (
              <button type="button" className="plain small" title="Fill the frame, centred" onClick={() => onChange({ ...img, crop: undefined })}>
                Reset picture
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="image-empty">
          <button type="button" onClick={() => void choose()} disabled={busy}>
            {busy ? "Copying…" : "Choose image…"}
          </button>
          <span className="muted small">or drop an image file here</span>
        </div>
      )}
      {error && <span className="ib-invalid">{error}</span>}
      <MiniEditor
        pageId={pageId}
        label={`${label} caption`}
        placeholder="Caption (optional)"
        value={img.caption ?? ""}
        onChange={(caption) => onChange(cleanValue({ ...img, caption: caption || undefined }))}
      />
    </div>
  );
}
