// The sidebar's way to the project's screens: the search box, Find page…,
// Templates, Categories, Relations, Themes and (when there are any) Conflicts.
import { QUICK_OPEN_KEYS } from "./QuickOpen";
import { SEARCH_KEYS } from "./SearchView";

/** Screens shown instead of a page. */
export type Panel = "categories" | "templates" | "themes" | "relations" | "search" | "conflicts" | "graph";

export function SidebarScreens({
  panel,
  categoryOpen,
  query,
  onQuery,
  onSearch,
  onFind,
  onPanel,
  templates,
  categories,
  conflicts,
}: {
  panel: Panel | null;
  /** A category page is open (Categories shows as selected). */
  categoryOpen: boolean;
  query: string;
  /** The search box was typed in. */
  onQuery: (query: string) => void;
  /** Go to the Search screen with the current query. */
  onSearch: () => void;
  onFind: () => void;
  onPanel: (which: Panel) => void;
  templates: number;
  categories: number;
  conflicts: number;
}) {
  const screen = (which: Panel, label: string, count = 0, selected = panel === which) => (
    <button className={`plain templates-button ${selected ? "selected" : ""}`} onClick={() => onPanel(which)}>
      {label}
      {count > 0 && <span className="count">{count}</span>}
    </button>
  );
  return (
    <>
      <div className={`sidebar-search ${panel === "search" ? "selected" : ""}`}>
        <input
          type="search"
          value={query}
          placeholder="Search…"
          aria-label="Search the project"
          title={`Search page text, infoboxes and more (${SEARCH_KEYS})`}
          spellCheck={false}
          onFocus={() => panel !== "search" && query && onSearch()}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              onSearch();
            }
          }}
        />
        <kbd>{SEARCH_KEYS}</kbd>
      </div>
      <button className="find" onClick={onFind}>
        <span>Find page…</span>
        <kbd>{QUICK_OPEN_KEYS}</kbd>
      </button>
      {screen("templates", "Templates", templates)}
      {screen("categories", "Categories", categories, panel === "categories" || categoryOpen)}
      {screen("relations", "Relations")}
      {screen("themes", "Themes")}
      {conflicts > 0 && (
        <button
          className={`plain templates-button conflicts-button ${panel === "conflicts" ? "selected" : ""}`}
          title="Files Google Drive kept twice: choose which version to keep"
          onClick={() => onPanel("conflicts")}
        >
          Conflicts
          <span className="count warn">{conflicts}</span>
        </button>
      )}
    </>
  );
}
