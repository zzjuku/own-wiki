// The sample page beside the theme editor: a small piece of the app (sidebar,
// buttons, a tooltip) and a page with placeholder content (infobox, link, red
// link, table, quote box, spoiler, collapsible embed box), all drawn with the
// theme being edited. Every variable is set on the sample itself, so it shows
// that theme whatever theme the app is using.
import { useMemo, type CSSProperties } from "react";
import type { Infobox, PageInfo } from "../api";
import { renderWithEmbeds, type EmbedEnv } from "../embeds";
import { infoboxHtml } from "../infobox";
import type { LinkContext } from "../markdown";
import { scopeFonts, type Resolved, type ThemeFont } from "./engine";

const PAGE_B: PageInfo = { id: "Page B.md", title: "Page B", group: "", aliases: [] };

const SAMPLE_TEXT = [
  "Example text with a [[Page B|link]], a [[Page C|red link]] and a ||hidden spoiler||. Text runs beside the infobox.",
  "",
  "## Section heading",
  "",
  "More example text in the page font, with **bold** and *italic* words.",
  "",
  "<quote>",
  "An example quote in a quote box.",
  "<by>Example person</by>",
  "</quote>",
  "",
  "| Example | Table |",
  "|---|---|",
  "| Cell A | Cell B |",
  "",
  "{{Page B|collapsible}}",
].join("\n");

const SAMPLE_BOX: Infobox = {
  fields: [
    { label: "Example field", type: "text", value: "Example value" },
    { label: "Example section", type: "heading" },
    { label: "Other field", type: "text", value: "[[Page B]]" },
  ],
};

const links: LinkContext = {
  resolve: (name) => (name.trim().toLowerCase() === "page b" ? { page: PAGE_B } : null),
  category: () => false,
};

const env: EmbedEnv = {
  project: "",
  hostId: "Page A.md",
  sources: new Map([["Page B.md", { id: "Page B.md", title: "Page B", body: "Text of the embedded page in an embed box.", infobox: null }]]),
  frame: () => ({ width: 250, height: 300 }),
};

export function ThemeSample({ resolved, fonts, scope }: { resolved: Resolved; fonts: ThemeFont[]; scope: string }) {
  const style = useMemo(() => scopeFonts(resolved.all, fonts, scope) as CSSProperties, [resolved, fonts, scope]);
  const html = useMemo(
    () => infoboxHtml(SAMPLE_BOX, { project: "", title: "Page A", links }) + renderWithEmbeds(SAMPLE_TEXT, { tocBox: false, links }, env).html,
    [],
  );
  return (
    <div className="theme-sample" style={style} aria-label="Sample" role="figure">
      <div className="sample-app">
        <div className="sample-sidebar">
          <div className="sample-project">Project A</div>
          <div className="sample-row selected">Page A</div>
          <div className="sample-row">Page B</div>
          <div className="sample-buttons">
            <button type="button" className="primary" tabIndex={-1}>
              Button
            </button>
            <button type="button" tabIndex={-1}>
              Button
            </button>
          </div>
          <div className="app-tooltip visible sample-tooltip">Example tooltip</div>
        </div>
        <div className="sample-page">
          <div className="sample-head">
            <h1>Page A</h1>
          </div>
          <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
