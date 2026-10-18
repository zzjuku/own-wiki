// Edit image popup: clicking an image in the source editor shows its caption,
// position and size, plus Replace and Remove, so nobody edits
// [[File:…|right|medium|Caption]] by hand. Changes apply at once.
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "./api";
import { POSITIONS, SIZES, TEXT_IMAGE_EXTENSIONS, type TextImage } from "./images";
import { imageUrl } from "./infobox";
import { MiniEditor } from "./MiniEditor";
import { useWiki } from "./wiki";

interface Props {
  image: TextImage;
  pageId: string;
  /** Where to show it (screen coordinates under the image's source). */
  at: { left: number; top: number };
  change: (img: TextImage) => void;
  remove: () => void;
  close: () => void;
}

/** Asks for image files (SVG allowed) and copies them into the project. */
export async function chooseTextImages(project: string, multiple: boolean): Promise<string[]> {
  const picked = await open({
    multiple,
    directory: false,
    title: multiple ? "Choose images" : "Choose an image",
    filters: [{ name: "Images", extensions: TEXT_IMAGE_EXTENSIONS }],
  });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const files: string[] = [];
  for (const p of paths) files.push(await api.importImage(project, p, true));
  return files;
}

export function ImagePopup({ image, pageId, at, change, remove, close }: Props) {
  const wiki = useWiki();
  const [img, setImg] = useState(image);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  // Keep the popup inside the window.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const left = Math.max(8, Math.min(at.left, window.innerWidth - el.offsetWidth - 8));
    const top = at.top + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, at.top - el.offsetHeight - 28) : at.top;
    setPos({ left, top });
  }, [at]);

  function set(patch: Partial<TextImage>) {
    const next = { ...img, ...patch };
    setImg(next);
    change(next);
  }

  async function replace() {
    setError(null);
    try {
      const [file] = await chooseTextImages(wiki.project, false);
      if (file) set({ file });
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div
      ref={boxRef}
      className="link-popup image-popup"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Edit image"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target as HTMLElement).closest(".cm-tooltip")) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="image-popup-head">
        <img src={imageUrl(wiki.project, img.file, 80)} alt="" />
        <span className="image-file" title={`assets/${img.file}`}>
          {img.file}
        </span>
      </div>
      <div className="link-field">
        <span>Caption</span>
        <MiniEditor pageId={pageId} label="Caption" placeholder="Caption (optional)" value={img.caption} onChange={(caption) => set({ caption })} />
      </div>
      <div className="link-field">
        <span>Position</span>
        <div className="segmented" role="group" aria-label="Position">
          {POSITIONS.map((p) => (
            <button key={p.value} type="button" aria-pressed={img.pos === p.value} className={img.pos === p.value ? "active" : ""} onClick={() => set({ pos: p.value })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="link-field">
        <span>Size</span>
        <div className="segmented" role="group" aria-label="Size">
          {SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={img.pos === "full"}
              title={img.pos === "full" ? "Full-width images use the whole page width" : undefined}
              aria-pressed={img.size === s.value}
              className={img.size === s.value && img.pos !== "full" ? "active" : ""}
              onClick={() => set({ size: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="link-missing">{error}</p>}
      <div className="link-actions">
        <button type="button" onClick={() => void replace()}>
          Replace…
        </button>
        <button type="button" className="danger-text" title="Takes the image out of the text. The file stays in the project's assets folder." onClick={remove}>
          Remove
        </button>
        <div className="spacer" />
        <button type="button" className="primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
