import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type Page, type PageInfo } from "./api";
import { Autosaver, flushAll, registerFlusher, type SaveStatus } from "./autosave";
import { useDialogs } from "./dialogs";
import { renderMarkdown } from "./markdown";
import { useReportError } from "./notify";

interface Props {
  project: string;
  pageId: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onRenamed: (page: PageInfo) => Promise<void>;
  onDeleted: () => Promise<void>;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Editing…",
  saving: "Saving…",
  error: "Not saved",
};

export function PageView({ project, pageId, editing, setEditing, onRenamed, onDeleted }: Props) {
  const dialogs = useDialogs();
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

  function rename() {
    if (!page) return;
    dialogs.prompt({
      title: "Rename page",
      label: "Page title",
      initial: page.title,
      confirmLabel: "Rename",
      submit: async (title) => {
        await flushAll();
        const info = await api.renamePage(project, pageId, title);
        await onRenamed(info);
      },
    });
  }

  function remove() {
    if (!page) return;
    dialogs.confirm({
      title: "Delete page",
      message: (
        <>
          Move <strong>{page.title}</strong> to the Trash?
        </>
      ),
      confirmLabel: "Move to Trash",
      danger: true,
      submit: async () => {
        await flushAll();
        await api.deletePage(project, pageId);
        await onDeleted();
      },
    });
  }

  if (loadError) return <p className="empty center">{loadError}</p>;
  if (!page) return null;

  return (
    <article className="page">
      <header className="page-head">
        <h1>{page.title}</h1>
        <div className="spacer" />
        {editing && (
          <span className={`save-status ${status}`} aria-live="polite">
            {STATUS_TEXT[status]}
          </span>
        )}
        <button onClick={rename}>Rename</button>
        <button className="danger-text" onClick={remove}>
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
