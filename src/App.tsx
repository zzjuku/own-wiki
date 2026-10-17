import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type ProjectInfo, type Settings } from "./api";
import { flushAll } from "./autosave";
import { DialogProvider } from "./dialogs";
import { NotifyProvider, useReportError } from "./notify";
import { Library } from "./Library";
import { ProjectView } from "./ProjectView";

export default function App() {
  return (
    <NotifyProvider>
      <DialogProvider>
        <Main />
      </DialogProvider>
    </NotifyProvider>
  );
}

function Main() {
  const report = useReportError();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings, report);
    // Save any open edit before the window closes.
    const unlisten = getCurrentWindow().onCloseRequested(() => flushAll());
    return () => void unlisten.then((fn) => fn());
  }, [report]);

  async function chooseLibrary() {
    try {
      const path = await open({ directory: true, multiple: false, title: "Choose library folder" });
      if (typeof path !== "string") return;
      setSettings(await api.setLibraryPath(path));
      setProject(null);
    } catch (e) {
      report(e);
    }
  }

  if (!settings) return null;

  if (!settings.libraryPath) {
    return (
      <div className="welcome">
        <h1>Own WIKI</h1>
        <p>Choose a library folder. All your projects are stored there as plain files.</p>
        <p className="muted">
          To use the same library on another computer, put the folder inside Google Drive.
        </p>
        <button className="primary" onClick={chooseLibrary}>
          Choose folder…
        </button>
      </div>
    );
  }

  if (project) {
    return <ProjectView project={project} onBack={() => setProject(null)} />;
  }

  return (
    <Library
      libraryPath={settings.libraryPath}
      onOpen={setProject}
      onChooseLibrary={chooseLibrary}
    />
  );
}
