// The gallery dialog: add images (button or dropping files), give them
// captions, drag them into order, remove them. Opened by the Gallery button
// (new gallery) or by clicking a gallery in the source editor.
import { useRef, useState } from "react";
import { api, errorText } from "./api";
import { DragHandle, moveItem, useReorder } from "./controls";
import { useFileDrop } from "./dropFiles";
import { chooseTextImages } from "./ImagePopup";
import { hasExtension, TEXT_IMAGE_EXTENSIONS, type GalleryItem } from "./images";
import { imageUrl } from "./infobox";
import { MiniEditor } from "./MiniEditor";
import { useWiki } from "./wiki";

interface Props {
  pageId: string;
  /** The gallery being edited; absent for a new one. */
  initial?: GalleryItem[];
  initialSpoiler?: boolean;
  save: (items: GalleryItem[], spoiler: boolean) => void;
  /** Deletes the gallery being edited. */
  remove?: () => void;
  close: () => void;
}

interface Row extends GalleryItem {
  /** Stable React key. */
  id: number;
}

let nextId = 1;
const withIds = (items: GalleryItem[]): Row[] => items.map((i) => ({ ...i, id: nextId++ }));

export function GalleryDialog({ pageId, initial, initialSpoiler, save, remove, close }: Props) {
  const wiki = useWiki();
  const [rows, setRows] = useState<Row[]>(() => withIds(initial ?? []));
  const [spoiler, setSpoiler] = useState(!!initialSpoiler);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reorder = useReorder((from, to) => setRows((r) => moveItem(r, from, to)));
  const boxRef = useRef<HTMLFormElement>(null);

  async function add(files: () => Promise<string[]>) {
    setError(null);
    setBusy(true);
    try {
      const added = await files();
      setRows((r) => [...r, ...withIds(added.map((file) => ({ file, caption: "" })))]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  useFileDrop(boxRef, (paths) => {
    const images = paths.filter((p) => hasExtension(p, TEXT_IMAGE_EXTENSIONS));
    if (images.length < paths.length) setError("Only PNG, JPG, GIF, WebP and SVG images can be added.");
    if (images.length) void add(() => Promise.all(images.map((p) => api.importImage(wiki.project, p, true))));
  });

  const update = (id: number, patch: Partial<GalleryItem>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        ref={boxRef}
        className="dialog gallery-dialog"
        role="dialog"
        aria-label={initial ? "Edit gallery" : "New gallery"}
        onSubmit={(e) => {
          e.preventDefault();
          if (rows.length) save(rows.map(({ file, caption }) => ({ file, caption })), spoiler);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !(e.target as HTMLElement).closest(".cm-tooltip, .link-popup")) close();
        }}
      >
        <h2>{initial ? "Gallery" : "New gallery"}</h2>
        {rows.length === 0 ? (
          <p className="gallery-empty muted">Add images with the button below, or drop image files here.</p>
        ) : (
          <ul className="gallery-rows" ref={(el) => void (reorder.listRef.current = el)}>
            {rows.map((r, i) => (
              <li key={r.id} data-reorder className={`gallery-row ${reorder.rowClass(i, rows.length)}`}>
                <DragHandle label={`Move ${r.file}`} onPointerDown={(e) => reorder.start(e, i)} />
                <img src={imageUrl(wiki.project, r.file, 64)} alt="" />
                <div className="gallery-row-main">
                  <span className="image-file" title={`assets/${r.file}`}>
                    {r.file}
                  </span>
                  <MiniEditor pageId={pageId} label={`Caption of ${r.file}`} placeholder="Caption (optional)" value={r.caption} onChange={(caption) => update(r.id, { caption })} />
                </div>
                <button type="button" className="plain remove" title="Remove from the gallery" aria-label={`Remove ${r.file}`} onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void add(() => chooseTextImages(wiki.project, true))}>
            {busy ? "Copying…" : "Add images…"}
          </button>
          <div className="spacer" />
          <label className="check">
            <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
            <span>Spoiler: blurred until clicked</span>
          </label>
        </div>
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          {remove && (
            <button type="button" className="danger-text" title="Takes the gallery out of the text. The files stay in the project's assets folder." onClick={remove}>
              Remove gallery
            </button>
          )}
          <div className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!rows.length}>
            {initial ? "Save" : "Insert"}
          </button>
        </div>
      </form>
    </div>
  );
}
