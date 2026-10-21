// The top of a project's sidebar: back to the projects, main page, back and
// forward, the project name (click: add new pages at the top level), the
// global spoiler switch and Project settings.
import { Icon } from "./editorTheme";
import { GraphIcon } from "./graph/GraphIcon";
import { GRAPH_KEYS } from "./graph/GraphView";
import { IS_MAC } from "./QuickOpen";
import { ROOT } from "./tree";

const BACK_KEYS = IS_MAC ? "⌘[" : "Alt+←";
const FORWARD_KEYS = IS_MAC ? "⌘]" : "Alt+→";
const HIDE_KEYS = IS_MAC ? "⌘\\" : "Ctrl+\\";

/** A window with a side panel (hide or show the sidebar). */
export function SidebarIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" className="stroke" />
      <path d="M6 3v10" className="stroke" />
    </svg>
  );
}

export function SidebarHeader({
  projectName,
  mainPageTitle,
  canBack,
  canForward,
  onProjects,
  onHome,
  onGo,
  topSelected,
  onSelectTop,
  revealAll,
  setRevealAll,
  onSettings,
  onHideSidebar,
  graphOpen,
  onGraph,
}: {
  projectName: string;
  mainPageTitle: string | null;
  canBack: boolean;
  canForward: boolean;
  onProjects: () => void;
  onHome: () => void;
  onGo: (step: -1 | 1) => void;
  /** The project name is selected: new pages go to the top level. */
  topSelected: boolean;
  onSelectTop: () => void;
  revealAll: boolean;
  setRevealAll: (on: boolean) => void;
  onSettings: () => void;
  onHideSidebar: () => void;
  graphOpen: boolean;
  onGraph: () => void;
}) {
  return (
    <>
      <div className="sidebar-top">
        <button className="plain back" onClick={onProjects}>
          ← Projects
        </button>
        <div className="spacer" />
        <div className="nav-buttons">
          <button
            className="plain nav"
            title={mainPageTitle ? `Main page: ${mainPageTitle}` : "Main page (none set yet)"}
            aria-label="Main page"
            onClick={onHome}
          >
            <NavIcon name="home" />
          </button>
          <button
            className="plain nav"
            title={`Back (${BACK_KEYS})`}
            aria-label="Back"
            disabled={!canBack}
            onClick={() => onGo(-1)}
          >
            <NavIcon name="back" />
          </button>
          <button
            className="plain nav"
            title={`Forward (${FORWARD_KEYS})`}
            aria-label="Forward"
            disabled={!canForward}
            onClick={() => onGo(1)}
          >
            <NavIcon name="forward" />
          </button>
          <button
            className={`plain nav ${graphOpen ? "active" : ""}`}
            title={`Graph of pages and links (${GRAPH_KEYS})`}
            aria-label="Graph"
            aria-pressed={graphOpen}
            onClick={onGraph}
          >
            <GraphIcon />
          </button>
          <button className="plain nav" title={`Hide the sidebar (${HIDE_KEYS})`} aria-label="Hide the sidebar" onClick={onHideSidebar}>
            <SidebarIcon />
          </button>
        </div>
      </div>
      <div className="project-name-row">
        <h1
          className={`project-name ${topSelected ? "selected" : ""}`}
          title={`${projectName} — click to add new pages at the top level`}
          data-drop={ROOT}
          onClick={onSelectTop}
        >
          {projectName}
        </h1>
        <button
          className={`plain nav spoiler-switch ${revealAll ? "active" : ""}`}
          title={revealAll ? "Spoilers are shown everywhere. Click to hide them again." : "Show all spoilers everywhere (remembered on this computer)"}
          aria-label="Show all spoilers"
          aria-pressed={revealAll}
          onClick={() => setRevealAll(!revealAll)}
        >
          <Icon name={revealAll ? "eye" : "spoiler"} />
        </button>
        <button className="plain nav" title="Project settings" aria-label="Project settings" onClick={onSettings}>
          <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" className="stroke" />
            <path
              d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
              className="stroke"
            />
          </svg>
        </button>
      </div>
      {revealAll && (
        <button className="spoilers-shown" title="Click to hide spoilers again" onClick={() => setRevealAll(false)}>
          Spoilers shown everywhere · Hide
        </button>
      )}
    </>
  );
}

const NAV_ICONS: Record<string, string> = {
  home: "M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5",
  back: "M10 3.5 5.5 8l4.5 4.5",
  forward: "M6 3.5 10.5 8 6 12.5",
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={NAV_ICONS[name]} className="stroke" />
    </svg>
  );
}
