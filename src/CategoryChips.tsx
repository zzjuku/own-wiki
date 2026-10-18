// The categories of a page (or the parents of a category): a "Categories:"
// line under the title in edit mode, and the AWOIAF-style box at the bottom
// of the read view. Categories are added with suggestions (a new name makes a
// new category) and removed with ×; each change is saved straight away.
import { useMemo, useState } from "react";
import { errorText } from "./api";
import { useWiki } from "./wiki";
import { norm } from "./wikilinks";

interface Props {
  values: string[];
  /** Saves the new list (throws a message if it can't). */
  save: (next: string[]) => Promise<void>;
  /** "box": the read view's box at the bottom; "line": the edit-mode line. */
  variant: "box" | "line";
  label?: string;
  /** Names that can't be added (a category's own name). */
  exclude?: string;
}

export function CategoryChips({ values, save, variant, label = "Categories", exclude }: Props) {
  const wiki = useWiki();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => new Set([...values, ...(exclude ? [exclude] : [])].map(norm)), [values, exclude]);
  const suggestions = useMemo(
    () => (adding ? wiki.categories.search(text, 8).filter((c) => !taken.has(norm(c.name))) : []),
    [adding, text, wiki.categories, taken],
  );
  const typed = text.trim().replace(/^category\s*:\s*/i, "");
  const isNew = typed !== "" && !wiki.categories.resolve(typed) && !taken.has(norm(typed));

  async function run(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      await save(next);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(name: string) {
    const n = name.trim().replace(/^category\s*:\s*/i, "");
    if (!n) return setAdding(false);
    if (taken.has(norm(n))) {
      setText("");
      return;
    }
    if (await run([...values, n])) {
      setText("");
      setActive(0);
    }
  }

  const close = () => {
    setAdding(false);
    setText("");
    setError(null);
  };

  return (
    <div className={variant === "box" ? "catlinks" : "aliases category-line"}>
      <span className={variant === "box" ? "catlinks-label" : "aliases-label"}>{label}:</span>
      {values.length === 0 && variant === "box" && !adding && <span className="muted">none</span>}
      {values.map((c, i) => (
        <span key={c} className={variant === "box" ? "catlink-item" : "alias-chip"}>
          {variant === "box" ? (
            <a
              href="#"
              className={`wikilink catlink ${wiki.categories.resolve(c) ? "" : "new"}`}
              data-category={c}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                wiki.openCategory(c);
              }}
            >
              {c}
            </a>
          ) : (
            c
          )}
          <button
            className="plain chip-remove"
            aria-label={`Remove category ${c}`}
            title="Remove"
            disabled={busy}
            onClick={() => void run(values.filter((x) => x !== c))}
          >
            ×
          </button>
          {variant === "box" && i < values.length - 1 && <span className="catlinks-sep"> · </span>}
        </span>
      ))}
      {adding ? (
        <span className="category-add">
          <input
            className="alias-input"
            autoFocus
            value={text}
            placeholder="Category"
            spellCheck={false}
            aria-label="Add category"
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setError(null);
            }}
            onKeyDown={(e) => {
              const count = suggestions.length + (isNew ? 1 : 0);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (count) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
              } else if (e.key === "Enter") {
                e.preventDefault();
                void add(active < suggestions.length && text.trim() ? suggestions[active].name : text);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            onBlur={() => setTimeout(() => !text.trim() && close(), 150)}
          />
          {(suggestions.length > 0 || isNew) && text.trim() && (
            <ul className="link-suggest category-suggest" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={s.name}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void add(s.name);
                  }}
                >
                  <span>{s.name}</span>
                  <span className="muted">{s.pages === 1 ? "1 page" : `${s.pages} pages`}</span>
                </li>
              ))}
              {isNew && (
                <li
                  role="option"
                  aria-selected={active === suggestions.length}
                  className={active === suggestions.length ? "active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void add(typed);
                  }}
                >
                  <span>{typed}</span>
                  <span className="muted">new category</span>
                </li>
              )}
            </ul>
          )}
        </span>
      ) : (
        <button className="plain alias-add" title={`Add a ${label === "Categories" ? "category" : "parent category"}`} onClick={() => setAdding(true)}>
          + Add
        </button>
      )}
      {error && <span className="alias-error">{error}</span>}
    </div>
  );
}
