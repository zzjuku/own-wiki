import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type Page } from "./api";
import { Autosaver, registerFlusher, type SaveStatus } from "./autosave";
import { renderMarkdown } from "./markdown";
import { useReportError } from "./notify";
import { groupChain } from "./tree";

interface Props {
  project: string;
  pageId: string;
  /** Current title from the tree (it can change without the id changing). */
  title?: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  /** Opens a group of the breadcrumb in the sidebar. */
  onReveal: (group: string) => void;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Editing…",
  saving: "Saving…",
  error: "Not saved",
};

export function PageView(props: Props) {
  const { project, pageId, editing, setEditing } = props;
  const report = useReportError();
  const [page, setPage] = useState<Page | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const textRef = useRef<HTMLTextAreaElement>(null);

  const saver = useMemo(
    () =>
      new Autosaver(
        (text) => api.savePage(project, pageId, text),
        (s, e) => {
          setStatus(s);
          if (e) report(`Couldn't save the page: ${errorText(e)}`);
        },
      ),
    [project, pageId, report],
  );

  useEffect(() => {
    const unregister = registerFlusher(() => saver.flush());
    return () => {
      unregister();
      void saver.flush();
    };
  }, [saver]);

  useEffect(() => {
    api.readPage(project, pageId).then(
      (p) => {
        setPage(p);
        setBody(p.body);
      },
      (e) => setLoadError(errorText(e)),
    );
  }, [project, pageId]);

  useEffect(() => {
    if (editing && page) textRef.current?.focus();
  }, [editing, page]);

  const html = useMemo(() => renderMarkdown(body), [body]);

  async function toggle() {
    if (editing) await saver.flush();
    setEditing(!editing);
  }

  if (loadError) return <p className="empty center">{loadError}</p>;
  if (!page) return null;

  return (
    <article className="page">
      <header className="page-head">
        <div className="page-titles">
          {page.group && (
            <nav className="breadcrumb" aria-label="Group">
              {groupChain(page.group).map((g) => (
                <button key={g} className="plain crumb" onClick={() => props.onReveal(g)}>
                  {g.slice(g.lastIndexOf("/") + 1)}
                </button>
              ))}
            </nav>
          )}
          <h1 title={props.title ?? page.title}>{props.title ?? page.title}</h1>
        </div>
        <div className="spacer" />
        {editing && (
          <span className={`save-status ${status}`} aria-live="polite">
            {STATUS_TEXT[status]}
          </span>
        )}
        <button onClick={props.onRename}>Rename</button>
        <button onClick={props.onMove}>Move…</button>
        <button className="danger-text" onClick={props.onDelete}>
          Delete
        </button>
        <button className="primary" onClick={toggle}>
          {editing ? "View" : "Edit"}
        </button>
      </header>

      {editing ? (
        <textarea
          ref={textRef}
          className="editor"
          value={body}
          spellCheck
          placeholder="Write in Markdown…"
          onChange={(e) => {
            setBody(e.target.value);
            saver.change(e.target.value);
          }}
        />
      ) : body.trim() ? (
        <div
          className="markdown"
          // Links between pages come in a later milestone; for now don't let a
          // click navigate the app window away.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) e.preventDefault();
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="empty">This page is empty. Click Edit to write.</p>
      )}
    </article>
  );
}
