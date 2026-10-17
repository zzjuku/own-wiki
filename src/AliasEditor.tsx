// The Aliases line under the title in edit mode: other names that link to
// the page. Each is saved straight away.
import { useState } from "react";
import { api, errorText } from "./api";
import { useDialogs } from "./dialogs";
import { useReportError } from "./notify";

interface Props {
  project: string;
  pageId: string;
  aliases: string[];
  /** The page's names changed (the tree needs reloading). */
  onChanged: () => void;
}

export function AliasEditor({ project, pageId, aliases, onChanged }: Props) {
  const dialogs = useDialogs();
  const report = useReportError();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const name = value.trim();
    if (!name) return setAdding(false);
    try {
      await api.setAliases(project, pageId, [...aliases, name]);
      setValue("");
      setError(null);
      setAdding(false);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove(alias: string) {
    const doRemove = async () => {
      await api.setAliases(project, pageId, aliases.filter((a) => a !== alias));
      onChanged();
    };
    try {
      const { links, pages } = await api.linkCount(project, alias);
      if (!links) return await doRemove();
      dialogs.confirm({
        title: "Remove alias",
        message: (
          <>
            {links} {links === 1 ? "link" : "links"} in {pages} {pages === 1 ? "page" : "pages"} use{" "}
            <strong>{alias}</strong>. {links === 1 ? "It" : "They"} will turn red.
          </>
        ),
        confirmLabel: "Remove",
        danger: true,
        submit: doRemove,
      });
    } catch (e) {
      report(e);
    }
  }

  return (
    <div className="aliases">
      <span className="aliases-label" title="Other names that link to this page">
        Aliases:
      </span>
      {aliases.map((a) => (
        <span key={a} className="alias-chip">
          {a}
          <button className="plain" aria-label={`Remove alias ${a}`} title="Remove" onClick={() => void remove(a)}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="alias-input"
          autoFocus
          value={value}
          placeholder="New alias"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            } else if (e.key === "Escape") {
              setAdding(false);
              setValue("");
              setError(null);
            }
          }}
          onBlur={() => !value.trim() && setAdding(false)}
        />
      ) : (
        <button className="plain alias-add" onClick={() => setAdding(true)}>
          + Add
        </button>
      )}
      {error && <span className="alias-error">{error}</span>}
    </div>
  );
}
