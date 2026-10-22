// Project settings (stored in project.json, so the same on every computer):
// the categories box at the bottom of pages, the project's theme, the
// present day and which fields make family trees.
import { useEffect, useRef, useState } from "react";
import { FamilyTreeSettings } from "./family/FamilySettings";
import { api, type ProjectSettings, type ThemeInfo } from "./api";
import { BUILTIN_PREFIX, BUILTIN_THEMES } from "./themes/builtin";
import { DateInput } from "./FieldInputs";

export function ProjectSettingsDialog({
  project,
  settings,
  change,
  focus = "top",
  close,
}: {
  project: string;
  settings: ProjectSettings;
  change: (next: ProjectSettings) => void;
  /** "family": opened from the Family tree screen, scrolled to its settings. */
  focus?: "top" | "family";
  close: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === "family") box.current?.querySelector("#family-tree-settings")?.scrollIntoView({ block: "start" });
  }, [focus]);
  const [projectThemes, setProjectThemes] = useState<ThemeInfo[]>([]);
  useEffect(() => {
    api.listThemes(project).then(setProjectThemes, () => setProjectThemes([]));
  }, [project]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={box} className="dialog project-settings" role="dialog" aria-label="Project settings" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Project settings</h2>
        <p className="muted small-note">These settings are stored in the project, so they're the same on every computer.</p>
        <label className="check settings-check">
          <input
            type="checkbox"
            checked={!settings.hideCategoryBox}
            onChange={(e) => change({ ...settings, hideCategoryBox: !e.target.checked })}
          />
          <span>Show the categories box at the bottom of pages</span>
        </label>
        <p className="hint">
          When it's off, categories still work: add them in edit mode (the Categories line under the title), and category pages
          and the Categories list stay as they are.
        </p>
        <label className="settings-field">
          <span>Theme</span>
          <select
            aria-label="Project theme"
            value={settings.theme ?? ""}
            onChange={(e) => change({ ...settings, theme: e.target.value || null })}
          >
            <option value="">App theme</option>
            {BUILTIN_THEMES.map((t) => (
              <option key={t.id} value={BUILTIN_PREFIX + t.id}>
                {t.data.name} (built-in)
              </option>
            ))}
            {projectThemes.map((t) => (
              <option key={t.id} value={`project:${t.id}`}>
                {t.name} (this project)
              </option>
            ))}
            {settings.theme && !settings.theme.startsWith(BUILTIN_PREFIX) && !projectThemes.some((t) => `project:${t.id}` === settings.theme) && (
              <option value={settings.theme}>{settings.theme.slice(settings.theme.indexOf(":") + 1)} (missing)</option>
            )}
          </select>
        </label>
        <p className="hint">
          A project can use its own theme instead of the app theme. Make and edit themes under <strong>Themes</strong> in the
          sidebar.
        </p>
        <div className="settings-field present-day">
          <span>Present day</span>
          <DateInput
            label="Present day"
            value={settings.presentDay ?? undefined}
            ranges={false}
            onChange={(v) => change({ ...settings, presentDay: (v as Record<string, unknown> | undefined) ?? null })}
          />
        </div>
        <p className="hint">
          The story's "today": a birth date set as such in its field settings shows the age, e.g. "(age 9)", while no death date is
          filled in. Leave it empty for no ages.
        </p>
        <FamilyTreeSettings settings={settings} change={change} />
        <div className="dialog-actions">
          <button type="button" className="primary" autoFocus onClick={() => close()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
