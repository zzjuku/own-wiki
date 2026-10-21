// The Page list dialog: writes a `<pagelist …>` line (src/pageLists.ts) that
// lists the pages whose fields point to the page it's on. Opened from the
// toolbar, or by clicking such a line in the source.
import { useState } from "react";
import type { Field } from "./api";
import type { PageListCall } from "./pageLists";
import { LinkedFromOptions } from "./TemplatesView";
import { useWiki } from "./wiki";
import { norm } from "./wikilinks";

export function PageListDialog({
  initial,
  save,
  remove,
  close,
}: {
  initial: PageListCall | null;
  save: (call: PageListCall) => void;
  remove?: () => void;
  close: () => void;
}) {
  const wiki = useWiki();
  // The line names templates; the settings work with their ids (unknown names stay as they are).
  const [options, setOptions] = useState<NonNullable<Field["options"]>>(() => ({
    from: initial?.from ?? [],
    templates: (initial?.templates ?? []).map((n) => wiki.templates.find((t) => norm(t.name) === norm(n))?.id ?? n),
    sortBy: initial?.sortBy,
  }));
  const from = options.from ?? [];
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide page-list-dialog" role="dialog" aria-label="Page list" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Page list</h2>
        <p className="dialog-note">
          Lists the pages whose fields point to this page, e.g. the chapters whose “Location” is this place. It's always up to date;
          an empty list shows nothing.
        </p>
        <LinkedFromOptions options={options} setOptions={(o) => setOptions(o ?? {})} templates={wiki.templates} pageList />
        <div className="dialog-actions">
          {remove && (
            <button type="button" className="danger-text" onClick={remove}>
              Remove
            </button>
          )}
          <div className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!from.length}
            onClick={() =>
              save({
                from,
                templates: (options.templates ?? []).map((id) => wiki.templates.find((t) => t.id === id)?.name ?? id),
                sortBy: options.sortBy,
              })
            }
          >
            {initial ? "Save" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
