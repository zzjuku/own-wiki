// In-app dialogs (the webview has no usable window.prompt/confirm).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { errorText } from "./api";

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel: string;
  /** Runs the action. If it throws, the message is shown and the dialog stays open. */
  submit: (value: string) => Promise<void>;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  submit: () => Promise<void>;
}

type Open = { id: number } & (
  ({ kind: "prompt" } & PromptOptions) | ({ kind: "confirm" } & ConfirmOptions)
);

let nextId = 0;

interface Dialogs {
  prompt: (o: PromptOptions) => void;
  confirm: (o: ConfirmOptions) => void;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      confirmRef.current?.focus();
    }
  }, []);

  async function submit() {
    if (busy) return;
    if (open.kind === "prompt" && !value.trim()) {
      setError("Name can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (open.kind === "prompt") await open.submit(value);
      else await open.submit();
      close();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <form
        className="dialog"
        role="dialog"
        aria-label={open.title}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && close()}
      >
        <h2>{open.title}</h2>
        {open.kind === "prompt" ? (
          <label className="field">
            <span>{open.label}</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
            />
          </label>
        ) : (
          <p>{open.message}</p>
        )}
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="submit"
            className={open.kind === "confirm" && open.danger ? "danger" : "primary"}
            disabled={busy}
          >
            {open.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
