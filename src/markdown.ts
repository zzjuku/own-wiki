import DOMPurify from "dompurify";
import { marked } from "marked";

/** Markdown -> safe HTML for the page view. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html);
}
