import { openUrl } from "@tauri-apps/plugin-opener";

/** Click handler for rendered page HTML: web addresses open in the default
 * browser, `#…` links jump within the page, anything else is ignored (page
 * links come in M4). */
export function handleContentClick(e: React.MouseEvent<HTMLElement>) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (/^(https?:|mailto:)/i.test(href)) {
    void openUrl(href).catch(() => {});
  } else if (href.startsWith("#")) {
    const target = e.currentTarget.ownerDocument.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}
