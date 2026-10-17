// Edit link popup: clicking a [[link]] in the source editor shows where it
// points and the text it shows on the page, both editable, so nobody has to
// edit the [[Page|text]] syntax by hand.
import { useEffect, useMemo, useRef, useState } from "react";
import type { NameIndex } from "./names";
import { displayGroup } from "./tree";
import { linkTarget, shownText, type WikiLink } from "./wikilinks";

interface Props {
  link: WikiLink;
  names: NameIndex;
  /** Where to show it (screen coordinates of the link's start and bottom). */
  at: { left: number; top: number };
  apply: (target: string, shown: string) => void;
  unlink: () => void;
  open: (target: string) => void;
  close: () => void;
}

export function LinkPopup({ link, names, at, apply, unlink, open, close }: Props) {
  const [target, setTarget] = useState(linkTarget(link));
  const [shown, setShown] = useState(link.label ?? "");
  const [suggest, setSuggest] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  const page = target.split("#")[0].trim();
  const exists = page === "" || names.resolve(page) !== null;
  const bad = /[[\]\n]/.test(target + shown) || target.includes("|") ? "Links can't contain [ ] or | here." : null;
  const suggestions = useMemo(
    () => (suggest && !target.includes("#") ? names.search(target, 6) : []),
    [suggest, target, names],
  );
  // What the page will show if the text box is left empty.
  const defaultText = shownText({ page, section: target.includes("#") ? target.slice(target.indexOf("#") + 1).trim() || null : null, label: link.label === "" ? "" : null, suffix: link.suffix });

  // Keep the popup inside the window.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const left = Math.max(8, Math.min(at.left, window.innerWidth - el.offsetWidth - 8));
    const top = at.top + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, at.top - el.offsetHeight - 28) : at.top;
    setPos({ left, top });
  }, [at]);

  function submit() {
    if (bad || !target.trim()) return;
    apply(target, shown);
  }

  return (
    <div
      ref={boxRef}
      className="link-popup"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Edit link"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <label className="link-field">
        <span>Links to</span>
        <input
          value={target}
          spellCheck={false}
          onChange={(e) => {
            setTarget(e.target.value);
            setSuggest(true);
            setActive(0);
          }}
          onBlur={() => setTimeout(() => setSuggest(false), 150)}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length) {
                setTarget(suggestions[active].name);
                setSuggest(false);
              } else submit();
            }
          }}
        />
      </label>
      {suggestions.length > 0 && (
        <ul className="link-suggest" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={`${s.page.id}\n${s.name}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                setTarget(s.name);
                setSuggest(false);
              }}
            >
              <span>{s.name}</span>
              <span className="muted">{s.alias ? `→ ${s.page.title}` : displayGroup(s.page.group)}</span>
            </li>
          ))}
        </ul>
      )}
      {!exists && suggestions.length === 0 && <p className="link-missing">“{page}” doesn't exist yet (red link).</p>}
      <label className="link-field">
        <span>Text shown on the page</span>
        <input
          value={shown}
          placeholder={defaultText}
          spellCheck
          onChange={(e) => setShown(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      {bad && <p className="link-missing">{bad}</p>}
      <div className="link-actions">
        <button type="button" className="plain" title="Keep the text, remove the link" onClick={unlink}>
          Unlink
        </button>
        <button type="button" className="plain" disabled={!page || !exists} onClick={() => open(target)}>
          Open page
        </button>
        <div className="spacer" />
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!!bad || !target.trim()} onClick={submit}>
          Apply
        </button>
      </div>
    </div>
  );
}
