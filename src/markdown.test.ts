// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic Markdown", () => {
    const html = renderMarkdown("# Heading\n\nSome **bold** text.\n\n- item");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>item</li>");
  });

  it("strips scripts and event handlers", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
});
