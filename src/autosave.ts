// Debounced autosave for the page editor.

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export const AUTOSAVE_DELAY_MS = 700;

/** What the save status line says. */
export const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Editing…",
  saving: "Saving…",
  error: "Not saved",
};

export class Autosaver {
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  /** While paused (the file changed on disk, the user decides), edits wait. */
  private paused = false;

  constructor(
    private save: (body: string) => Promise<void>,
    private onStatus: (status: SaveStatus, error?: unknown) => void,
    private delay = AUTOSAVE_DELAY_MS,
  ) {}

  /** Call on every edit. Saves once typing pauses. */
  change(body: string) {
    this.pending = body;
    this.onStatus("unsaved");
    clearTimeout(this.timer);
    if (!this.paused) this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Stops saving (edits are kept) until `resume`. */
  pause() {
    this.paused = true;
    clearTimeout(this.timer);
  }

  resume() {
    this.paused = false;
    if (this.pending !== null) void this.flush();
  }

  /** Forgets the unsaved edit (it was saved another way, or dropped on purpose). */
  discard() {
    clearTimeout(this.timer);
    this.pending = null;
    this.onStatus("saved");
  }

  /** Saves any pending edit now. Resolves when every save has finished. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    const body = this.pending;
    if (body !== null && !this.paused) {
      this.pending = null;
      this.onStatus("saving");
      // Saves run one after another so an older body can never overwrite a newer one.
      this.chain = this.chain.then(() =>
        this.save(body).then(
          () => {
            if (this.pending === null) this.onStatus("saved");
          },
          (e) => {
            // Keep the unsaved text so the next flush retries it.
            this.pending ??= body;
            this.onStatus("error", e);
          },
        ),
      );
    }
    return this.chain;
  }

  get hasPending() {
    return this.pending !== null;
  }
}

// Navigation (switching pages, leaving a project, closing the window) awaits
// every live editor's flush first, so no edit is lost.
const flushers = new Set<() => Promise<void>>();

export function registerFlusher(fn: () => Promise<void>): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((fn) => fn()));
}
