// The settings of one theme: the main settings up front (colours, embed
// boxes, fonts and sizes), every colour under "All colours", and the sample
// page beside them. Built-in themes show their settings read-only.
import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "../api";
import { useReportError } from "../notify";
import { toHex6 } from "./color";
import { effectiveValue, firstFamily, followsWhat, fontStack, resolveVars, scopedFamily, type ThemeData, type ThemeFont } from "./engine";
import { fontScope, loadFonts, parseRef, storeOf, type ThemeRef } from "./runtime";
import { ThemeSample } from "./ThemeSample";
import { ALL_COLORS, DEFAULTS, MAIN_SETTINGS, STANDARD_FONTS, type Setting } from "./vars";

/** Every variable's label, for "follows …" hints. */
const LABELS: Record<string, string> = Object.fromEntries([
  ...ALL_COLORS.flatMap((g) => g.vars),
  ...MAIN_SETTINGS.flatMap((g) => g.settings.map((s) => [s.name, s.label] as [string, string])),
]);

interface Props {
  themeRef: ThemeRef;
  project: string | null;
  data: ThemeData;
  readOnly: boolean;
  onChange: (data: ThemeData) => void;
}

export function ThemeEditor({ themeRef, project, data, readOnly, onChange }: Props) {
  const resolved = useMemo(() => resolveVars(data.vars), [data.vars]);
  const scope = fontScope(themeRef, project);
  const fonts = useMemo(() => data.fonts ?? [], [data.fonts]);
  useEffect(() => void loadFonts(themeRef, project, fonts), [themeRef, project, fonts]);

  const set = (name: string, value: string | null) => {
    const vars = { ...data.vars };
    if (value === null || value === "") delete vars[name];
    else vars[name] = value;
    onChange(withUsedFonts({ ...data, vars }));
  };
  const addFonts = (name: string, added: ThemeFont[]) => {
    if (!added.length) return;
    const known = new Set(fonts.map((f) => f.file));
    const all = [...fonts, ...added.filter((f) => !known.has(f.file))];
    onChange(withUsedFonts({ ...data, fonts: all, vars: { ...data.vars, [name]: fontStack(added[0].family, name) } }));
  };

  const field = (s: Setting) => (
    <SettingRow key={s.name} setting={s} vars={data.vars} value={effectiveValue(resolved, s.name)} set={set}>
      {s.type.kind === "font" && (
        <FontPicker
          name={s.name}
          label={s.label}
          value={resolved.all[s.name]}
          effective={effectiveValue(resolved, s.name)}
          fonts={fonts}
          scope={scope}
          themeRef={themeRef}
          project={project}
          disabled={readOnly}
          set={set}
          addFonts={addFonts}
        />
      )}
    </SettingRow>
  );

  return (
    <div className="theme-editor">
      <fieldset className="theme-settings" disabled={readOnly}>
        {MAIN_SETTINGS.map((group) => (
          <section key={group.title} className="theme-group">
            <h3>{group.title}</h3>
            {group.settings.map(field)}
          </section>
        ))}
        <details className="theme-group all-colours">
          <summary>
            <h3>All colours</h3>
            <span className="hint">Every colour on its own. Unset ones follow the settings above.</span>
          </summary>
          {ALL_COLORS.map((group) => (
            <section key={group.title}>
              <h4>{group.title}</h4>
              {group.vars.map(([name, label]) => field({ name, label, type: { kind: "color" } }))}
            </section>
          ))}
        </details>
      </fieldset>
      <div className="theme-preview">
        <ThemeSample resolved={resolved} fonts={fonts} scope={scope} />
      </div>
    </div>
  );
}

/** Drops font files no font setting uses any more. */
function withUsedFonts(data: ThemeData): ThemeData {
  if (!data.fonts?.length) return data;
  const used = new Set(Object.entries(data.vars).filter(([k]) => k.startsWith("--font-")).map(([, v]) => firstFamily(v)));
  return { ...data, fonts: data.fonts.filter((f) => used.has(f.family)) };
}

function SettingRow({
  setting,
  vars,
  value,
  set,
  children,
}: {
  setting: Setting;
  vars: Record<string, string>;
  value: string;
  set: (name: string, value: string | null) => void;
  children?: React.ReactNode;
}) {
  const { name, label, hint, type } = setting;
  const own = name in vars;
  const follows = followsWhat(name);
  const id = `theme-${name.slice(2)}`;
  const followText = !own && follows ? `Follows ${LABELS[follows] ?? follows}` : null;
  return (
    <div className={`theme-row ${own ? "own" : ""}`} data-var={name}>
      <label htmlFor={id} className="theme-label">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </label>
      <div className="theme-control">
        {type.kind === "color" && <ColorInput id={id} label={label} value={value} onChange={(v) => set(name, v)} />}
        {type.kind === "size" && (
          <>
            <input
              id={id}
              type="range"
              min={type.min}
              max={type.max}
              step={type.step}
              value={parseFloat(value) || type.min}
              aria-label={label}
              onChange={(e) => set(name, `${e.target.value}${type.unit}`)}
            />
            <span className="theme-number">{value}</span>
          </>
        )}
        {type.kind === "select" && (
          <select id={id} value={value} aria-label={label} onChange={(e) => set(name, e.target.value)}>
            {type.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {children}
        {own ? (
          <button
            type="button"
            className="plain theme-reset"
            title={follows ? `Reset: follow ${LABELS[follows] ?? follows} again` : `Reset to ${DEFAULTS[name]}`}
            aria-label={`Reset ${label}`}
            onClick={() => set(name, null)}
          >
            ↺
          </button>
        ) : (
          <span className="theme-reset-space" title={followText ?? undefined}>
            {followText ? "↳" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** A colour swatch (system colour picker) plus the value as text (any CSS colour, transparency allowed). */
function ColorInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const hex = toHex6(value);
  return (
    <>
      <label className="theme-swatch" style={{ background: value }} title={`Choose ${label.toLowerCase()}…`}>
        <input type="color" value={hex ?? "#000000"} aria-label={`${label} colour`} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        id={id}
        className="theme-color-text"
        value={text}
        spellCheck={false}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && text.trim() && onChange(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </>
  );
}

function FontPicker({
  name,
  label,
  value,
  effective,
  fonts,
  scope,
  themeRef,
  project,
  disabled,
  set,
  addFonts,
}: {
  name: string;
  label: string;
  /** As the theme has it: a font stack, or "var(--font-…)" when it follows another font. */
  value: string;
  /** The font stack in the end. */
  effective: string;
  fonts: ThemeFont[];
  scope: string;
  themeRef: ThemeRef;
  project: string | null;
  disabled: boolean;
  set: (name: string, value: string | null) => void;
  addFonts: (name: string, fonts: ThemeFont[]) => void;
}) {
  const report = useReportError();
  const [installedOpen, setInstalledOpen] = useState(false);
  const place = parseRef(themeRef);
  const store = storeOf(place, project);
  const families = [...new Set(fonts.map((f) => f.family))];
  const follows = DEFAULTS[name]?.startsWith("var(") ? followsWhat(name) : null;
  const following = follows !== null && value.startsWith("var(");
  const standard = following ? undefined : STANDARD_FONTS.find((f) => f.value === value);
  const family = firstFamily(following ? effective : value);
  const current = following ? "follow" : standard ? `std:${standard.value}` : families.includes(family) ? `own:${family}` : `std:${value}`;
  const previewFamily = (f: string) => `"${scopedFamily(f, scope)}", "${f}"`;
  const preview = standard ? standard.value : families.includes(family) ? previewFamily(family) : effective;

  async function importFile() {
    try {
      const path = await open({ multiple: false, title: "Import font", filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }] });
      if (typeof path !== "string") return;
      addFonts(name, [await api.importFont(store, place.id, path)]);
    } catch (e) {
      report(e);
    }
  }

  return (
    <>
      <select
        className="theme-font"
        aria-label={label}
        value={current}
        disabled={disabled}
        style={{ fontFamily: preview }}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "follow") set(name, null);
          else if (v === "installed") setInstalledOpen(true);
          else if (v === "import") void importFile();
          else if (v.startsWith("std:")) set(name, v.slice(4) === DEFAULTS[name] ? null : v.slice(4));
          else set(name, fontStack(v.slice(4), name));
        }}
      >
        {follows && <option value="follow">Same as {(LABELS[follows] ?? follows).toLowerCase()}</option>}
        <optgroup label="Standard (Mac and Windows)">
          {STANDARD_FONTS.map((f) => (
            <option key={f.label} value={`std:${f.value}`} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
          {current === `std:${value}` && <option value={`std:${value}`}>{family}</option>}
        </optgroup>
        {families.length > 0 && (
          <optgroup label="In this theme">
            {families.map((f) => (
              <option key={f} value={`own:${f}`} style={{ fontFamily: previewFamily(f) }}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
        {place.kind !== "builtin" && (
          <optgroup label="Add a font">
            <option value="installed">Installed font…</option>
            <option value="import">Import font file…</option>
          </optgroup>
        )}
      </select>
      {installedOpen && (
        <InstalledFontsDialog
          close={() => setInstalledOpen(false)}
          pick={async (f) => {
            addFonts(name, await api.copyInstalledFont(store, place.id, f));
          }}
        />
      )}
    </>
  );
}

/** Pick one of the fonts installed on this computer; it's copied into the theme. */
function InstalledFontsDialog({ close, pick }: { close: () => void; pick: (family: string) => Promise<void> }) {
  const [list, setList] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.installedFonts().then(setList, () => setList([]));
  }, []);
  const shown = (list ?? []).filter((f) => f.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog installed-fonts" role="dialog" aria-label="Installed fonts" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Installed fonts</h2>
        <p className="hint">The font (regular, bold, italic…) is copied into the theme, so it looks the same on your other computer.</p>
        <input autoFocus placeholder="Filter fonts" aria-label="Filter fonts" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="font-list">
          {list === null && <li className="muted">Reading fonts…</li>}
          {list !== null && shown.length === 0 && <li className="muted">No font found.</li>}
          {shown.slice(0, 400).map((f) => (
            <li key={f}>
              <button
                type="button"
                className="plain"
                disabled={busy !== null}
                style={{ fontFamily: `"${f}"` }}
                onClick={async () => {
                  setBusy(f);
                  try {
                    await pick(f);
                    close();
                  } catch (e) {
                    setError(errorText(e));
                    setBusy(null);
                  }
                }}
              >
                {f}
                {busy === f && <span className="muted"> — copying…</span>}
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
