// Pasting from Word, Google Docs or web pages: HTML -> Markdown. Keeps bold,
// italics, strikethrough, headings, lists, quotes, tables and web links; drops
// colours, fonts and images.
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  br: "",
});

turndown.remove(["style", "script", "meta", "title", "link", "img", "picture", "video", "audio", "iframe", "object"]);

turndown.addRule("noImages", { filter: "img", replacement: () => "" });
turndown.addRule("noSvg", { filter: (node) => node.nodeName.toLowerCase() === "svg", replacement: () => "" });

// List items with a single space after the marker, as the editor writes them.
turndown.addRule("listItem", {
  filter: "li",
  replacement: (content, node) => {
    const parent = node.parentNode as HTMLElement;
    let prefix = "- ";
    if (parent.nodeName === "OL") {
      const start = Number(parent.getAttribute("start") ?? "1") || 1;
      prefix = `${start + [...parent.children].indexOf(node as Element)}. `;
    }
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "\n")
      .replace(/\n/gm, "\n" + " ".repeat(prefix.length));
    return prefix + body + (node.nextSibling && !body.endsWith("\n") ? "\n" : "");
  },
});

turndown.addRule("strikethrough", {
  filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
  replacement: (content) => (content.trim() ? `~~${content}~~` : content),
});

// Only web addresses stay links; anything else keeps just its text.
turndown.addRule("nonWebLink", {
  filter: (node) => node.nodeName === "A" && !/^(https?:|mailto:)/i.test(node.getAttribute("href") ?? ""),
  replacement: (content) => content,
});

// Tables: the first row becomes the header row.
turndown.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content) => ` ${content.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim() || " "} |`,
});
turndown.addRule("tableRow", {
  filter: "tr",
  replacement: (content, node) => {
    const row = node as HTMLTableRowElement;
    const table = row.closest("table");
    let line = `|${content}\n`;
    if (table && table.rows[0] === row) line += `|${" --- |".repeat(row.cells.length)}\n`;
    return line;
  },
});
turndown.addRule("tableSection", {
  filter: ["thead", "tbody", "tfoot"],
  replacement: (content) => content,
});
turndown.addRule("table", {
  filter: "table",
  replacement: (content) => `\n\n${content.trim()}\n\n`,
});

/** Converts pasted HTML, or returns null when it carries no formatting worth
 * keeping (then the plain text is pasted as it is, without escaping). */
export function htmlToMarkdown(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  clean(doc);
  const formatted =
    doc.body.querySelector("strong, b, em, i, del, s, strike, h2, h3, h4, h5, h6, ul, ol, blockquote, table, a[href], hr") ||
    doc.body.querySelectorAll("p").length > 1;
  if (!formatted) return null;
  return turndown
    .turndown(doc.body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clean(doc: Document) {
  const body = doc.body;
  // Office namespace tags like <o:p>.
  for (const el of [...body.querySelectorAll("*")]) {
    if (el.tagName.includes(":")) unwrap(el);
  }

  // Google Docs wraps everything in <b style="font-weight:normal">.
  for (const b of [...body.querySelectorAll("b")]) {
    if (/font-weight:\s*(normal|[1-5]00)\b/.test(b.getAttribute("style") ?? "")) unwrap(b);
  }

  // Formatting given as inline styles (Google Docs, many web pages).
  for (const el of [...body.querySelectorAll<HTMLElement>("span, font")]) {
    const style = el.getAttribute("style") ?? "";
    let wrap = el as Element;
    const add = (tag: string) => {
      const w = doc.createElement(tag);
      while (wrap.firstChild) w.appendChild(wrap.firstChild);
      wrap.appendChild(w);
      wrap = w;
    };
    if (/font-weight:\s*(bold|[6-9]00)\b/.test(style)) add("strong");
    if (/font-style:\s*italic/.test(style)) add("em");
    if (/text-decoration[^;]*line-through/.test(style)) add("del");
  }

  // A page's own title is its top heading, so pasted headings move one level down.
  for (const h of [...body.querySelectorAll("h1, h2, h3, h4, h5")]) {
    rename(h, `h${Number(h.tagName[1]) + 1}`);
  }

  wordLists(doc);
  googleDocsLists(doc);

  // A list item holding one paragraph is just that text (else lists get loose).
  for (const li of [...body.querySelectorAll("li")]) {
    const ps = li.querySelectorAll(":scope > p");
    if (ps.length === 1) unwrap(ps[0]);
  }
}

function unwrap(el: Element) {
  el.replaceWith(...el.childNodes);
}

function rename(el: Element, tag: string) {
  const n = el.ownerDocument.createElement(tag);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}

interface ListItem {
  level: number;
  ordered: boolean;
  li: HTMLLIElement;
}

/** Builds properly nested lists from a flat run of items with levels. */
function buildNested(doc: Document, items: ListItem[]): HTMLElement {
  const root = doc.createElement(items[0].ordered ? "ol" : "ul");
  const stack: { level: number; list: HTMLElement }[] = [{ level: items[0].level, list: root }];
  for (const item of items) {
    while (stack.length > 1 && item.level < stack[stack.length - 1].level) stack.pop();
    let top = stack[stack.length - 1];
    if (item.level > top.level) {
      const parentLi = top.list.lastElementChild ?? top.list.appendChild(doc.createElement("li"));
      const list = doc.createElement(item.ordered ? "ol" : "ul");
      parentLi.appendChild(list);
      top = { level: item.level, list };
      stack.push(top);
    }
    top.list.appendChild(item.li);
  }
  return root;
}

/** Word pastes list items as <p style="mso-list:l0 level1 …"> with the
 * bullet or number as text in a span marked mso-list:Ignore. */
function wordLists(doc: Document) {
  const isItem = (el: Element | null): el is HTMLElement =>
    !!el && el.tagName === "P" && /mso-list:\s*l\d+\s+level\d+/i.test(el.getAttribute("style") ?? "");
  for (const p of [...doc.body.querySelectorAll("p")]) {
    if (!p.isConnected || !isItem(p) || isItem(p.previousElementSibling)) continue;
    const run: HTMLElement[] = [];
    for (let el: Element | null = p; isItem(el); el = el.nextElementSibling) run.push(el);
    const items = run.map((el) => {
      const level = Number(/level(\d+)/i.exec(el.getAttribute("style") ?? "")![1]);
      const marker = el.querySelector('span[style*="mso-list:Ignore" i], span[style*="mso-list: Ignore" i]');
      const ordered = /^\s*[\da-z]{1,4}[.)]/i.test(marker?.textContent ?? "");
      marker?.remove();
      const li = doc.createElement("li");
      while (el.firstChild) li.appendChild(el.firstChild);
      return { level, ordered, li };
    });
    const list = buildNested(doc, items);
    run[0].replaceWith(list);
    run.slice(1).forEach((el) => el.remove());
  }
}

/** Google Docs pastes nested lists as flat sibling lists whose items carry
 * aria-level. */
function googleDocsLists(doc: Document) {
  const isList = (el: Element | null): el is HTMLElement =>
    !!el && (el.tagName === "UL" || el.tagName === "OL") && !!el.querySelector(":scope > li[aria-level]");
  for (const first of [...doc.body.querySelectorAll("ul, ol")]) {
    if (!first.isConnected || !isList(first) || isList(first.previousElementSibling)) continue;
    const run: HTMLElement[] = [];
    for (let el: Element | null = first; isList(el); el = el.nextElementSibling) run.push(el);
    const items = run.flatMap((list) =>
      [...list.querySelectorAll<HTMLLIElement>(":scope > li")].map((li) => ({
        level: Number(li.getAttribute("aria-level") ?? "1"),
        ordered: list.tagName === "OL",
        li,
      })),
    );
    const nested = buildNested(doc, items);
    run[0].replaceWith(nested);
    run.slice(1).forEach((el) => el.remove());
  }
}
