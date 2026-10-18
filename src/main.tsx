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
import "./styles/images.css";
import "./styles/categories.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
