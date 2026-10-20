import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme.css";
// App styles by area. Order matters: later files may override earlier ones.
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/page.css";
import "./styles/dialogs.css";
import "./styles/editor.css";
import "./styles/links.css";
import "./styles/infobox.css";
import "./styles/templates.css";
import "./styles/relations.css";
import "./styles/layoutPrefs.css";
import "./styles/images.css";
import "./styles/categories.css";
import "./styles/spoilers.css";
import "./styles/embeds.css";
import "./styles/tooltips.css";
import "./styles/themes.css";
import "./styles/look.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
