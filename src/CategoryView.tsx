// Category pages (automatic): "Category: Name", its own text (optional,
// written with the normal editor), its subcategories, and its pages under
// letter headings. Also the list of all categories (sidebar → Categories).
import { useEffect, useMemo, useRef, useState } from "react";
import { PageWidthHandle } from "./PageWidthHandle";
import { NO_RELATIONS } from "./relations";
import { api, errorText, isChanged, type CategoryChange, type CategoryPage } from "./api";
import { useFilesChanged } from "./fileEvents";
import { Autosaver, registerFlusher, STATUS_TEXT, type SaveStatus } from "./autosave";
import { Backlinks } from "./Backlinks";
import { fileMembers } from "./categories";
import { CategoryChips } from "./CategoryChips";
import { useDialogs } from "./dialogs";
import { FindBar, useFindBar } from "./FindBar";
import { renderWithEmbeds, useEmbedEnv } from "./embeds";
import { useReportError } from "./notify";
import { IS_MAC } from "./QuickOpen";
import { SplitEditor } from "./SplitEditor";
import { useSpoilerReveal } from "./spoilers";
import { displayGroup } from "./tree";
import { useContentClick, useLinkContext, useWiki } from "./wiki";
import { usePageTrees } from "./family/PageTrees";

const SUB_KEY = "ownwiki.categorySubpages";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

function loadSub(): boolean {
  try {
    return localStorage.getItem(SUB_KEY) === "1";
  } catch {
    return false;
  }
}

/** "3 pages, 1 subcategory and 2 links" — what renaming or deleting touches. */
export function changeText(c: CategoryChange): string {
  const parts = [
    c.pages && plural(c.pages, "page"),
    c.subcategories && plural(c.subcategories, "subcategory", "subcategories"),
    c.links && `${plural(c.links, "link")} in ${plural(c.linkingPages, "page")}`,
    c.templates && plural(c.templates, "template"),
  ].filter(Boolean) as string[];
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

interface Props {
  name: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
  /** Opened from a search result: the find bar starts with this query. */
  find?: { query: string; key: number } | null;
}

export function CategoryView({ name, editing, setEditing, onRenamed, onDeleted, find }: Props) {
  const wiki = useWiki();
  const dialogs = useDialogs();
  const report = useReportError();
  const project = wiki.project;
  const [data, setData] = useState<CategoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeSub, setIncludeSub] = useState(loadSub);
  const [linking, setLinking] = useState<number | null>(null);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const latest = useRef<string | null>(null);
  // Re-read after the text was saved (it may have created the category's file).
  const [version, setVersion] = useState(0);
  // The file's version when the text in the editor was loaded (M10: a file changed on disk since isn't overwritten).
  const fileVersion = useRef<string | null>(null);
  // Bumped when the text was read again from disk: the editor starts over with it.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    let live = true;
    api.categoryPage(project, name, includeSub).then(
      (d) => {
        if (!live) return;
        setData(d);
        if (latest.current === null) {
          latest.current = d.text;
          fileVersion.current = d.version;
        }
      },
      (e) => live && setError(errorText(e)),
    );
    api.categoryBacklinks(project, name, false).then(
      (l) => live && setLinking(l.length),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [project, name, includeSub, wiki.names, wiki.categories, version]);

  const saver = useMemo(
    () =>
      new Autosaver(
        (text) => api.saveCategoryText(project, name, text, fileVersion.current),
        (s, e) => {
          setStatus(s);
          if (!e) return;
          if (!isChanged(e)) return report(`Couldn't save the category text: ${errorText(e)}`);
          // Changed on the other computer meanwhile: theirs is shown, yours goes to the Trash.
          const mine = latest.current ?? "";
          saver.discard();
          void api.trashText(project, `Category ${name}`, mine).catch(() => {});
          reloadText();
          report("This category's text was changed on another computer. It shows the new text now; yours is in the Trash.");
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, name, report],
  );
  /** Reads the text again from disk (the editor starts over with it). */
  function reloadText() {
    latest.current = null;
    setVersion((v) => v + 1);
    setEditorKey((k) => k + 1);
  }
  // Category files changed on disk: read again (an unsaved edit first tries to save, which notices).
  useFilesChanged(project, (c) => {
    if (!c.categories) return;
    if (saver.hasPending) void saver.flush();
    else reloadText();
  });
  useEffect(() => {
    const unregister = registerFlusher(() => saver.flush());
    return () => {
      unregister();
      void saver.flush();
    };
  }, [saver]);

  async function toggle() {
    if (editing) {
      await saver.flush();
      wiki.reloadCategories();
      setVersion((v) => v + 1);
    }
    setEditing(!editing);
  }
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

  const finder = useFindBar(editing);
  const bodyRef = useRef<HTMLDivElement>(null);
  const loaded = data !== null;
  const { show } = finder;
  useEffect(() => {
    if (find && loaded) show(find.query);
  }, [find, loaded, show]);

  const links = useLinkContext(undefined, data?.name ?? name);
  const onContentClick = useContentClick();
  const text = editing ? (latest.current ?? "") : (data?.text ?? "");
  const embedEnv = useEmbedEnv(editing ? "" : text, `category:${data?.name ?? name}`);
  const html = useMemo(() => (text.trim() ? renderWithEmbeds(text, { tocBox: false, links }, embedEnv).html : ""), [text, links, embedEnv]);
  const readRef = useRef<HTMLDivElement>(null);
  const { onClick: revealOne } = useSpoilerReveal(readRef);
  const textRef = useRef<HTMLDivElement>(null);
  usePageTrees(textRef, editing ? "" : html, wiki.revealAll);
  const groups = useMemo(() => fileMembers(data?.pages ?? []), [data]);

  async function saveParents(next: string[]) {
    const parents = await api.setCategoryParents(project, data?.name ?? name, next);
    setData((d) => (d ? { ...d, parents } : d));
    wiki.reloadCategories();
  }

  async function rename() {
    const current = data?.name ?? name;
    try {
      const counts = await api.changeCategory(project, current, null, true);
      const touches = changeText(counts);
      dialogs.prompt({
        title: "Rename category",
        label: "New name",
        initial: current,
        note: touches ? <>This updates {touches}.</> : <>Nothing uses this category yet.</>,
        confirmLabel: "Rename",
        submit: async (next) => {
          await saver.flush();
          const r = await api.changeCategory(project, current, next, false);
          if (r.failed.length) report(`Couldn't update: ${r.failed.join(", ")}`);
          onRenamed(next.trim().replace(/^category\s*:\s*/i, ""));
        },
      });
    } catch (e) {
      report(e);
    }
  }

  async function remove() {
    const current = data?.name ?? name;
    try {
      const c = await api.changeCategory(project, current, null, true);
      const parts = [
        c.pages && `It's removed from ${plural(c.pages, "page")}.`,
        c.subcategories && `${plural(c.subcategories, "subcategory", "subcategories")} lose it as parent.`,
        c.templates && `It's removed from ${plural(c.templates, "template")}.`,
        c.links && `${plural(c.links, "link")} to it ${c.links === 1 ? "turns" : "turn"} red.`,
      ].filter(Boolean);
      dialogs.confirm({
        title: "Delete category",
        message: (
          <>
            Delete the category <strong>{current}</strong>
            {data?.text.trim() ? " and its text" : ""}? {parts.join(" ")}
          </>
        ),
        confirmLabel: "Delete",
        danger: true,
        submit: async () => {
          await saver.flush();
          const r = await api.changeCategory(project, current, null, false);
          if (r.failed.length) report(`Couldn't update: ${r.failed.join(", ")}`);
          onDeleted();
        },
      });
    } catch (e) {
      report(e);
    }
  }

  if (error) return <p className="empty center">{error}</p>;
  if (!data) return null;
  const shown = data.name;

  return (
    <article className="page category-page">
      <header className="page-head">
        <div className="page-titles">
          <nav className="breadcrumb" aria-label="Category">
            <span className="crumb muted">Category</span>
          </nav>
          <h1 title={`Category: ${shown}`}>Category: {shown}</h1>
          {editing && <CategoryChips variant="line" values={data.parents} save={saveParents} exclude={shown} />}
        </div>
        <div className="spacer" />
        <button title="Pages that link to this category" onClick={() => setBacklinksOpen(true)}>
          Links here{linking !== null && <span className="count">{linking}</span>}
        </button>
        <button onClick={() => void rename()} disabled={!data.exists}>
          Rename
        </button>
        <button className="danger-text" onClick={() => void remove()} disabled={!data.exists}>
          Delete
        </button>
        <button className="primary" title={`${editing ? "Read" : "Edit text"} (${IS_MAC ? "⌘" : "Ctrl+"}E)`} onClick={() => void toggle()}>
          {editing ? "View" : "Edit"}
        </button>
      </header>

      {backlinksOpen && <Backlinks category={shown} title={`Category: ${shown}`} close={() => setBacklinksOpen(false)} />}

      {finder.find && (
        <FindBar key={finder.find.query} root={bodyRef} scroller={readRef} initial={finder.find.query} focusKey={finder.find.key} onClose={finder.close} />
      )}

      {editing ? (
        <SplitEditor
          key={editorKey}
          pageId={`category:${shown}`}
          title={`Category: ${shown}`}
          initial={latest.current ?? data.text}
          onChange={(t) => {
            latest.current = t;
            saver.change(t);
          }}
          infobox={null}
          infoboxError={null}
          relations={NO_RELATIONS}
          onRelationsChanged={() => {}}
          onInfoboxChange={() => {}}
          noInfobox
          currentCategory={shown}
          status={<span className={`save-status ${status}`}>{STATUS_TEXT[status]}</span>}
        />
      ) : (
        <div className="read-view" ref={readRef} onClickCapture={revealOne}>
          <div className="read-column">
            <PageWidthHandle />
            <div ref={bodyRef} className="markdown category-body" onClick={onContentClick}>
              {!data.exists && (
                <p className="notice">
                  This category doesn't exist yet. Add it to a page, or write its text with <strong>Edit</strong>.
                </p>
              )}
              {html && <div ref={textRef} dangerouslySetInnerHTML={{ __html: html }} />}
              {data.subcategories.length > 0 && (
                <section>
                  <h2>Subcategories</h2>
                  <p>
                    This category has {data.subcategories.length === 1 ? "the following subcategory" : `the following ${data.subcategories.length} subcategories`}.
                  </p>
                  <ul className="category-columns plain-list">
                    {data.subcategories.map((s) => (
                      <li key={s.name}>
                        <a
                          href="#"
                          className="wikilink catlink"
                          data-category={s.name}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            wiki.openCategory(s.name);
                          }}
                        >
                          {s.name}
                        </a>{" "}
                        <span className="muted small">
                          ({[s.subcategories && plural(s.subcategories, "subcategory", "subcategories"), plural(s.pages, "page")].filter(Boolean).join(", ")})
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h2>Pages in category “{shown}”</h2>
                <div className="category-pages-head">
                  <p>
                    {data.pages.length === 0
                      ? "No pages are in this category yet."
                      : `The following ${data.pages.length === 1 ? "page is" : `${data.pages.length.toLocaleString("en")} pages are`} in this category${includeSub ? " or its subcategories" : ""}.`}
                  </p>
                  {data.subcategories.length > 0 && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={includeSub}
                        onChange={(e) => {
                          setIncludeSub(e.target.checked);
                          try {
                            localStorage.setItem(SUB_KEY, e.target.checked ? "1" : "0");
                          } catch {
                            // Not remembering it is harmless.
                          }
                        }}
                      />
                      <span>Include pages of subcategories</span>
                    </label>
                  )}
                </div>
                <div className="category-columns">
                  {groups.map((g) => (
                    <div key={g.letter} className="category-letter">
                      <h3>{g.letter}</h3>
                      <ul className="plain-list">
                        {g.members.map((m) => (
                          <li key={m.id}>
                            <a
                              href="#"
                              className="wikilink"
                              data-page={m.id}
                              data-target={m.title}
                              title={m.group ? `${m.title} — ${displayGroup(m.group)}` : m.title}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                wiki.follow({ pageId: m.id });
                              }}
                            >
                              {m.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            {!wiki.settings.hideCategoryBox && <CategoryChips variant="box" values={data.parents} save={saveParents} exclude={shown} />}
          </div>
        </div>
      )}
    </article>
  );
}

/** Every category, with a filter box (sidebar → Categories). */
export function CategoriesList({ onOpen, onCreate }: { onOpen: (name: string) => void; onCreate: (name: string) => void }) {
  const wiki = useWiki();
  const dialogs = useDialogs();
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => (filter.trim() ? wiki.categories.search(filter, 100000) : wiki.categories.list), [filter, wiki.categories]);

  function create() {
    dialogs.prompt({
      title: "New category",
      label: "Category name",
      confirmLabel: "Create",
      submit: async (name) => {
        if (wiki.categories.resolve(name.trim().replace(/^category\s*:\s*/i, ""))) throw "A category with that name already exists.";
        onCreate(name);
      },
    });
  }

  return (
    <div className="page categories-list">
      <header className="page-head">
        <div className="page-titles">
          <h1>Categories</h1>
        </div>
        <div className="spacer" />
        <button className="primary" onClick={create}>
          New category
        </button>
      </header>
      <div className="categories-body">
        <input
          className="categories-filter"
          autoFocus
          placeholder="Filter categories…"
          aria-label="Filter categories"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {wiki.categories.list.length === 0 ? (
          <p className="empty small">No categories yet. Add one to a page: Edit → Categories → + Add, or the box at the bottom of a page.</p>
        ) : shown.length === 0 ? (
          <p className="empty small">No category matches.</p>
        ) : (
          <ul className="category-table">
            {shown.map((c) => (
              <li key={c.name}>
                <button className="plain category-row" onClick={() => onOpen(c.name)}>
                  <span className="category-row-name">{c.name}</span>
                  <span className="muted small">
                    {[plural(c.pages, "page"), c.subcategories ? plural(c.subcategories, "subcategory", "subcategories") : ""].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
