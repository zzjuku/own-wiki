// In-app dialogs (the webview has no usable window.prompt/confirm).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errorText, isLongPath } from "./api";

// Every submit gets `allowLong`: false at first; if the action is refused
// because a file path would be too long for Windows, the dialog shows the
// warning and a second click retries with true.

export interface PromptExtra {
  /** The drop-down's choice. */
  selected: string;
  /** The checkbox's state. */
  checked: boolean;
}

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  /** Extra text under the input. */
  note?: ReactNode;
  /** A drop-down under the input. */
  select?: { label: string; options: { id: string; label: string }[]; initial: string };
  /** A checkbox under the input. */
  checkbox?: { label: string; initial?: boolean };
  confirmLabel: string;
  /** Runs the action. If it throws, the message is shown and the dialog stays open. */
  submit: (value: string, allowLong: boolean, extra: PromptExtra) => Promise<void>;
}

interface AlertOptions {
  title: string;
  message: ReactNode;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  submit: (allowLong: boolean) => Promise<void>;
}

export interface PickOption {
  id: string;
  label: string;
  /** Shown instead of `label` while filtering, e.g. the full group path. */
  fullLabel: string;
  depth: number;
  /** Shown but not selectable, with this reason. */
  note?: string;
}

interface PickOptions {
  title: string;
  message?: ReactNode;
  options: PickOption[];
  confirmLabel: string;
  submit: (id: string, allowLong: boolean) => Promise<void>;
}

type Open = { id: number } & (
  | ({ kind: "prompt" } & PromptOptions)
  | ({ kind: "confirm" } & ConfirmOptions)
  | ({ kind: "pick" } & PickOptions)
  | ({ kind: "alert" } & AlertOptions)
);

let nextId = 0;

interface Dialogs {
  prompt: (o: PromptOptions) => void;
  confirm: (o: ConfirmOptions) => void;
  pick: (o: PickOptions) => void;
  alert: (o: AlertOptions) => void;
}

const DialogContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs outside DialogProvider");
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const api = useRef<Dialogs>({
    prompt: (o) => setOpen({ id: nextId++, kind: "prompt", ...o }),
    confirm: (o) => setOpen({ id: nextId++, kind: "confirm", ...o }),
    pick: (o) => setOpen({ id: nextId++, kind: "pick", ...o }),
    alert: (o) => setOpen({ id: nextId++, kind: "alert", ...o }),
  });
  return (
    <DialogContext.Provider value={api.current}>
      {children}
      {open && <Dialog key={open.id} open={open} close={() => setOpen(null)} />}
    </DialogContext.Provider>
  );
}

function Dialog({ open, close }: { open: Open; close: () => void }) {
  const [value, setValue] = useState(open.kind === "prompt" ? (open.initial ?? "") : "");
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState(open.kind === "prompt" ? (open.select?.initial ?? "") : "");
  const [checked, setChecked] = useState(open.kind === "prompt" ? (open.checkbox?.initial ?? false) : false);
  const [error, setError] = useState<string | null>(null);
  const [longWarning, setLongWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (open.kind === "prompt") inputRef.current.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [open.kind]);

  async function submit(pickedNow = picked) {
    if (busy) return;
    if (open.kind === "alert") return close();
    if (open.kind === "prompt" && !value.trim()) {
      setError("Name can't be empty.");
      return;
    }
    if (open.kind === "pick" && pickedNow === null) {
      setError("Choose where to move it.");
      return;
    }
    const allowLong = longWarning !== null;
    setBusy(true);
    setError(null);
    try {
      if (open.kind === "prompt") await open.submit(value, allowLong, { selected, checked });
      else if (open.kind === "pick") await open.submit(pickedNow!, allowLong);
      else await open.submit(allowLong);
      close();
    } catch (e) {
      if (isLongPath(e)) setLongWarning(errorText(e));
      else setError(errorText(e));
      setBusy(false);
    }
  }

  // A changed input or choice needs a fresh check.
  function edited() {
    setLongWarning(null);
    setError(null);
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <form
        className={`dialog ${open.kind === "pick" ? "wide" : ""}`}
        role="dialog"
        aria-label={open.title}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && close()}
      >
        <h2>{open.title}</h2>
        {open.kind === "prompt" && (
          <label className="field">
            <span>{open.label}</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                edited();
              }}
              spellCheck={false}
            />
          </label>
        )}
        {open.kind === "prompt" && open.select && (
          <label className="field">
            <span>{open.select.label}</span>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                edited();
              }}
            >
              {open.select.options.map((o) => (
                <option key={o.id || "(top)"} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {open.kind === "prompt" && open.note && <p className="dialog-note">{open.note}</p>}
        {open.kind === "prompt" && open.checkbox && (
          <label className="check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{open.checkbox.label}</span>
          </label>
        )}
        {(open.kind === "confirm" || open.kind === "alert") && <p>{open.message}</p>}
        {open.kind === "pick" && (
          <Picker
            open={open}
            inputRef={inputRef}
            picked={picked}
            setPicked={(id) => {
              setPicked(id);
              edited();
            }}
            onChoose={(id) => void submit(id)}
          />
        )}
        {longWarning && <p className="dialog-warning">{longWarning}</p>}
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          {open.kind !== "alert" && (
            <button type="button" onClick={close} disabled={busy}>
              Cancel
            </button>
          )}
          <button
            ref={confirmRef}
            type="submit"
            className={open.kind === "confirm" && open.danger ? "danger" : "primary"}
            disabled={busy}
          >
            {longWarning ? "Continue anyway" : open.kind === "alert" ? "OK" : open.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function Picker({
  open,
  inputRef,
  picked,
  setPicked,
  onChoose,
}: {
  open: PickOptions;
  inputRef: React.RefObject<HTMLInputElement | null>;
  picked: string | null;
  setPicked: (id: string) => void;
  onChoose: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return open.options;
    return open.options.filter((o) => {
      const label = o.fullLabel.toLowerCase();
      return words.every((w) => label.includes(w));
    });
  }, [filter, open.options]);
  return (
    <>
      {open.message && <p>{open.message}</p>}
      <input
        ref={inputRef}
        className="picker-filter"
        placeholder="Filter groups…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        spellCheck={false}
        aria-label="Filter groups"
      />
      <ul className="picker" role="listbox" aria-label="Groups">
        {shown.map((o) => (
          <li key={o.id || "(top)"}>
            <button
              type="button"
              role="option"
              aria-selected={picked === o.id}
              className={picked === o.id ? "selected" : ""}
              disabled={o.note !== undefined}
              style={{ paddingLeft: 10 + (filter ? 0 : o.depth * 16) }}
              onClick={() => setPicked(o.id)}
              onDoubleClick={() => onChoose(o.id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onChoose(o.id);
              }}
            >
              <span className="picker-label">{filter ? o.fullLabel : o.label}</span>
              {o.note && <span className="picker-note">{o.note}</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="empty small">No matching group.</li>}
      </ul>
    </>
  );
}
