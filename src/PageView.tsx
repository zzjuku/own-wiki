import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type Page } from "./api";
import { Autosaver, registerFlusher, type SaveStatus } from "./autosave";
import { handleContentClick } from "./links";
import { renderMarkdown } from "./markdown";
import { useReportError } from "./notify";
import { IS_MAC } from "./QuickOpen";
import { SplitEditor } from "./SplitEditor";
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
  // While editing, the latest text lives here (not in state) so typing
  // doesn't re-render the whole page.
  const latest = useRef("");

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
        latest.current = p.body;
      },
      (e) => setLoadError(errorText(e)),
    );
  }, [project, pageId]);

  const html = useMemo(() => renderMarkdown(body), [body]);

  async function toggle() {
    if (editing) {
      setBody(latest.current);
      await saver.flush();
    }
    setEditing(!editing);
  }

  // Cmd+E / Ctrl+E switches between reading and editing.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (!document.querySelector(".backdrop")) void toggleRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

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
        <button onClick={props.onRename}>Rename</button>
        <button onClick={props.onMove}>Move…</button>
        <button className="danger-text" onClick={props.onDelete}>
          Delete
        </button>
        <button className="primary" title={`${editing ? "Read" : "Edit"} (${IS_MAC ? "⌘" : "Ctrl+"}E)`} onClick={toggle}>
          {editing ? "View" : "Edit"}
        </button>
      </header>

      {editing ? (
        <SplitEditor
          initial={latest.current}
          onChange={(text) => {
            latest.current = text;
            saver.change(text);
          }}
          status={
            <span className={`save-status ${status}`} aria-live="polite">
              {STATUS_TEXT[status]}
            </span>
          }
        />
      ) : body.trim() ? (
        <div className="read-view">
          <div className="markdown" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : (
        <p className="empty">This page is empty. Click Edit to write.</p>
      )}
    </article>
  );
}
