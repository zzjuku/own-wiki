// Inputs for the infobox field types that aren't plain text: page links,
// dates and images.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type Frame } from "./api";
import { useFileDrop } from "./dropFiles";
import { FIELD_IMAGE_EXTENSIONS, hasExtension } from "./images";
import { cleanValue, imageUrl, isRange, type DatePoint, type DateRange, type ImageValue, type Qualifier } from "./infobox";
import { MiniEditor } from "./MiniEditor";
import { displayGroup } from "./tree";
import { DEFAULT_FRAME, useWiki } from "./wiki";

// ---- page links ----

/** A page name with suggestions; names of missing pages show red. */
export function PageNameInput({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (name: string) => void;
  label: string;
  autoFocus?: boolean;
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
          if (!suggestions.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            set(suggestions[active].name);
            setSuggest(false);
          } else if (e.key === "Escape") {
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
      {missing && !suggestions.length && <span className="ib-note missing-note">Page doesn't exist yet (red link)</span>}
    </div>
  );
}

/** Several page names (Page links fields). */
export function PageLinksInput({ value, onChange, label }: { value: string[]; onChange: (v: unknown) => void; label: string }) {
  const [items, setItems] = useState<string[]>(value.length ? value : [""]);
  const [focusLast, setFocusLast] = useState(false);
  const update = (next: string[]) => {
    setItems(next);
    onChange(next);
  };
  return (
    <div className="ib-list">
      {items.map((item, i) => (
        <div key={i} className="ib-list-item">
          <PageNameInput
            label={`${label} ${i + 1}`}
            value={item}
            autoFocus={focusLast && i === items.length - 1}
            onChange={(t) => update(items.map((x, j) => (j === i ? t : x)))}
          />
          <button
            type="button"
            className="plain remove"
            title="Remove page"
            aria-label="Remove page"
            onClick={() => update(items.length > 1 ? items.filter((_, j) => j !== i) : [""])}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="plain add-entry"
        onClick={() => {
          setItems([...items, ""]);
          setFocusLast(true);
        }}
      >
        + Add page
      </button>
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

// ---- images ----

/** The frame size infobox images on this page sit in (set by the Infobox tab). */
export const ImageFrameContext = createContext<Frame>(DEFAULT_FRAME);

const PREVIEW_MAX = 200;

/** The image in its infobox frame, small; dragging it chooses which part shows. */
function CropFrame({ project, value, onChange }: { project: string; value: ImageValue; onChange: (crop: { x: number; y: number }) => void }) {
  const frame = useContext(ImageFrameContext);
  const k = Math.min(1, PREVIEW_MAX / frame.width, PREVIEW_MAX / frame.height);
  const pw = Math.round(frame.width * k);
  const ph = Math.round(frame.height * k);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const crop = live ?? { x: value.crop?.x ?? 50, y: value.crop?.y ?? 50 };
  // How far the (cover-scaled) image sticks out of the frame.
  const s = natural ? Math.max(pw / natural.w, ph / natural.h) : 1;
  const over = natural ? { x: natural.w * s - pw, y: natural.h * s - ph } : { x: 0, y: 0 };
  const movable = over.x > 1 || over.y > 1;

  function drag(e: React.PointerEvent) {
    if (!movable || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
    let last = crop;
    const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    const move = (ev: PointerEvent) => {
      last = {
        x: over.x > 1 ? clamp(start.cx - ((ev.clientX - start.x) / over.x) * 100) : start.cx,
        y: over.y > 1 ? clamp(start.cy - ((ev.clientY - start.y) / over.y) * 100) : start.cy,
      };
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("reordering");
      setLive(null);
      if (last.x !== crop.x || last.y !== crop.y) onChange(last);
    };
    document.body.classList.add("reordering");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="crop-wrap">
      <div
        className={`crop-frame ${movable ? "movable" : ""}`}
        style={{ width: pw, height: ph }}
        title={movable ? "Drag to choose which part of the image shows" : undefined}
        onPointerDown={drag}
      >
        <img
          src={imageUrl(project, value.file!, frame.width)}
          alt=""
          draggable={false}
          style={{ objectPosition: `${crop.x}% ${crop.y}%` }}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      </div>
      {movable && <span className="muted small">Drag the picture to choose what the frame shows.</span>}
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
            {img.crop && (img.crop.x !== 50 || img.crop.y !== 50) && (
              <button type="button" className="plain small" onClick={() => onChange({ ...img, crop: undefined })}>
                Centre the picture again
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
