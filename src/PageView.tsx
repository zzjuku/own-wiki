import { useEffect, useMemo, useRef, useState } from "react";
import { PageWidthHandle } from "./PageWidthHandle";
import { api, errorText, type Infobox, type Page, type Relations } from "./api";
import { Autosaver, registerFlusher, STATUS_TEXT, type SaveStatus } from "./autosave";
import { renderWithEmbeds, useEmbedEnv } from "./embeds";
import { useReportError } from "./notify";
import { IS_MAC } from "./QuickOpen";
import { AliasEditor } from "./AliasEditor";
import { infoboxHtml } from "./infobox";
import { NO_RELATIONS, typedNames } from "./relations";
import { Backlinks } from "./Backlinks";
import { SplitEditor } from "./SplitEditor";
import { TocPanel } from "./TocPanel";
import { groupChain } from "./tree";
import { frameFor, scrollToSection, useContentClick, useLinkContext, useWiki } from "./wiki";
import { LINK_CHARS } from "./wikilinks";
import { isReservedName } from "./categories";
import { CategoryChips } from "./CategoryChips";
import { hasSpoilers, useSpoilerReveal } from "./spoilers";

interface Props {
  project: string;
  pageId: string;
  /** Current title from the tree (it can change without the id changing). */
  title?: string;
  aliases: string[];
  /** This is the project's main page. */
  isMain: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onSetMain: () => void;
  /** Aliases changed: the page list needs reloading. */
  onNamesChanged: () => void;
  /** Opens a group of the breadcrumb in the sidebar. */
  onReveal: (group: string) => void;
  /** How the page was reached: a section to scroll to, an alias it was linked by. */
  arrival: { section: string | null; via: string | null; key: number };
}

const STATUS_ORDER: SaveStatus[] = ["saved", "unsaved", "saving", "error"];
/** The save state to show when text and infobox save separately. */
const worst = (a: SaveStatus, b: SaveStatus) => (STATUS_ORDER.indexOf(a) >= STATUS_ORDER.indexOf(b) ? a : b);

export function PageView(props: Props) {
  const { project, pageId, editing, setEditing } = props;
  const report = useReportError();
  const [page, setPage] = useState<Page | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [boxStatus, setBoxStatus] = useState<SaveStatus>("saved");
  const [infobox, setInfobox] = useState<Infobox | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  // What other pages' infobox fields add to this one (Linked from, two-way fields).
  const [relations, setRelations] = useState<Relations>(NO_RELATIONS);
  // Bumped after this page wrote a relation into another page.
  const [relationsVersion, setRelationsVersion] = useState(0);
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
  const boxSaver = useMemo(
    () =>
      new Autosaver(
        (json) => api.saveInfobox(project, pageId, JSON.parse(json) as Infobox | null),
        (s, e) => {
          setBoxStatus(s);
          if (e) report(`Couldn't save the infobox: ${errorText(e)}`);
        },
        400,
      ),
    [project, pageId, report],
  );

  useEffect(() => {
    const unregister = [registerFlusher(() => saver.flush()), registerFlusher(() => boxSaver.flush())];
    return () => {
      unregister.forEach((u) => u());
      void saver.flush();
      void boxSaver.flush();
    };
  }, [saver, boxSaver]);

  useEffect(() => {
    api.readPage(project, pageId).then(
      (p) => {
        setPage(p);
        setBody(p.body);
        setInfobox(p.infobox);
        setCategories(p.categories ?? []);
        latest.current = p.body;
      },
      (e) => setLoadError(errorText(e)),
    );
  }, [project, pageId]);

  function changeInfobox(next: Infobox | null) {
    setInfobox(next);
    boxSaver.change(JSON.stringify(next));
  }

  const wiki = useWiki();
  // Pages created from this one (red links, infobox fields) start with its template.
  const template = infobox?.template ?? null;
  useEffect(() => wiki.noteTemplate(pageId, template), [wiki, pageId, template]);
  const links = useLinkContext(pageId);
  // How many pages link here (refreshed when pages change).
  const [linkingPages, setLinkingPages] = useState<number | null>(null);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let live = true;
    api.backlinks(project, pageId, false).then(
      (l) => live && setLinkingPages(l.length),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [project, pageId, wiki.names]);
  // Names typed into Linked from fields: their sort values come with the relations.
  const typed = useMemo(() => typedNames(infobox).join("\n"), [infobox]);
  useEffect(() => {
    let live = true;
    api.relations(project, pageId, typed ? typed.split("\n") : []).then(
      (r) => live && setRelations(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [project, pageId, wiki.names, typed, relationsVersion]);
  const onContentClick = useContentClick(pageId);
  // The read view shows the contents in the left panel, not in the text.
  const embedEnv = useEmbedEnv(editing ? "" : body, pageId);
  const rendered = useMemo(() => renderWithEmbeds(body, { tocBox: false, links }, embedEnv), [body, links, embedEnv]);
  const shownTitle = props.title ?? page?.title ?? "";
  const boxHtml = useMemo(
    () => infoboxHtml(infobox, { project, title: shownTitle, links, relations, presentDay: wiki.settings.presentDay, frame: frameFor(wiki, infobox?.template) }),
    [infobox, project, shownTitle, links, relations, wiki],
  );
  const readRef = useRef<HTMLDivElement>(null);
  const spoilers = useSpoilerReveal(readRef);
  // "Reveal spoilers" in the header: all of this page's, until the page is left.
  const [revealAll, setRevealAll] = useState(false);
  const pageHasSpoilers = useMemo(() => hasSpoilers(boxHtml) || hasSpoilers(rendered.html), [boxHtml, rendered.html]);

  // Arriving through a link: scroll to its section (or the top).
  const { arrival } = props;
  const loaded = page !== null;
  useEffect(() => {
    if (!loaded || editing) return;
    const view = readRef.current;
    if (view) scrollToSection(view.querySelector(".markdown") ?? view, arrival.section);
    // Only when a new arrival happens (or the page finished loading).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival.key, loaded]);

  async function toggle() {
    if (editing) {
      setBody(latest.current);
      await Promise.all([saver.flush(), boxSaver.flush()]);
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

  async function saveCategories(next: string[]) {
    const saved = await api.setPageCategories(project, pageId, next);
    setCategories(saved);
    wiki.reloadCategories();
  }

  if (loadError) return <p className="empty center">{loadError}</p>;
  if (!page) return null;
  const shownName = props.title ?? page.title;

  return (
    <article className={`page ${revealAll ? "reveal-spoilers" : ""}`}>
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
          {arrival.via && <p className="redirect-note">(Redirected from {arrival.via})</p>}
          {editing && (
            <>
              <AliasEditor project={project} pageId={pageId} aliases={props.aliases} onChanged={props.onNamesChanged} />
              <CategoryChips variant="line" values={categories} save={saveCategories} />
              <SortEditor project={project} pageId={pageId} initial={page.sort} />
            </>
          )}
        </div>
        <div className="spacer" />
        {!editing && pageHasSpoilers && (
          <button
            className={`reveal-button ${revealAll ? "active" : ""}`}
            aria-pressed={revealAll}
            title={revealAll ? "Hide this page's spoilers again" : "Show all spoilers on this page (until you leave it)"}
            onClick={() => {
              // Hiding also hides the spoilers revealed one by one.
              if (revealAll) spoilers.hideAll();
              setRevealAll(!revealAll);
            }}
          >
            {revealAll ? "Hide spoilers" : "Reveal spoilers"}
          </button>
        )}
        <button title="Pages that link to this page" onClick={() => setBacklinksOpen(true)}>
          Links here{linkingPages !== null && <span className="count">{linkingPages}</span>}
        </button>
        <button onClick={props.onRename}>Rename</button>
        <button onClick={props.onMove}>Move…</button>
        <button className="danger-text" onClick={props.onDelete}>
          Delete
        </button>
        <div className="more-wrap">
          <button className="more" aria-label="More" title="More" onClick={() => setMenuOpen((o) => !o)}>
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="menu-catcher" onMouseDown={() => setMenuOpen(false)} />
              <div className="menu page-menu" role="menu">
                <button
                  role="menuitem"
                  disabled={props.isMain}
                  onClick={() => {
                    setMenuOpen(false);
                    props.onSetMain();
                  }}
                >
                  {props.isMain ? "This is the main page" : "Set as main page"}
                </button>
              </div>
            </>
          )}
        </div>
        <button className="primary" title={`${editing ? "Read" : "Edit"} (${IS_MAC ? "⌘" : "Ctrl+"}E)`} onClick={toggle}>
          {editing ? "View" : "Edit"}
        </button>
      </header>

      {backlinksOpen && (
        <Backlinks pageId={pageId} title={props.title ?? page.title} close={() => setBacklinksOpen(false)} />
      )}

      {LINK_CHARS.test(shownName) && (
        <p className="notice title-notice">
          This title contains <code>[</code> <code>]</code> <code>|</code> or <code>#</code>, which links can't use.
          Rename the page so other pages can link to it.
        </p>
      )}
      {isReservedName(shownName) && (
        <p className="notice title-notice">
          This title starts with <code>Category:</code> or <code>File:</code>; links starting so go to categories and images.
          Rename the page so other pages can link to it.
        </p>
      )}

      {editing ? (
        <SplitEditor
          pageId={pageId}
          title={shownTitle}
          initial={latest.current}
          onChange={(text) => {
            latest.current = text;
            saver.change(text);
          }}
          infobox={infobox}
          infoboxError={page.infoboxError}
          relations={relations}
          onRelationsChanged={() => setRelationsVersion((v) => v + 1)}
          onInfoboxChange={changeInfobox}
          status={
            <span className={`save-status ${worst(status, boxStatus)}`} aria-live="polite">
              {STATUS_TEXT[worst(status, boxStatus)]}
            </span>
          }
        />
      ) : body.trim() || boxHtml ? (
        <div className="read-view" ref={readRef} onClickCapture={spoilers.onClick}>
          {rendered.toc.length > 0 && (
            <TocPanel toc={rendered.toc} scrollRef={readRef} storageKey={`ownwiki.tocFolded.${project}/${pageId}`} />
          )}
          <div className="read-column">
            <PageWidthHandle />
            <div className="markdown" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: boxHtml + rendered.html }} />
            {!wiki.settings.hideCategoryBox && <CategoryChips variant="box" values={categories} save={saveCategories} />}
          </div>
        </div>
      ) : (
        <div className="read-view empty-page">
          <div className="read-column">
            <PageWidthHandle />
            <p className="empty">This page is empty. Click Edit to write.</p>
            {!wiki.settings.hideCategoryBox && <CategoryChips variant="box" values={categories} save={saveCategories} />}
          </div>
        </div>
      )}
    </article>
  );
}

/** "Sort as" under the title in edit mode: how category pages sort and file the page. */
function SortEditor({ project, pageId, initial }: { project: string; pageId: string; initial: string | null }) {
  const report = useReportError();
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  function commit() {
    const v = value.trim();
    if (v === saved.trim()) return;
    api.setPageSort(project, pageId, v || null).then(() => setSaved(v), report);
  }
  return (
    <div className="aliases sort-line">
      <span className="aliases-label" title="How category pages sort this page (the sidebar keeps sorting by title)">
        Sort as:
      </span>
      <input
        className="alias-input sort-input"
        value={value}
        placeholder="Title"
        spellCheck={false}
        aria-label="Sort as"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}
