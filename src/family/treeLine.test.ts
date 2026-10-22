// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPage } from "../markdown";
import { parseTreeAttrs, treeLineSource, treeOnLine } from "./treeLine";

describe("family tree lines", () => {
  it("round-trip and render as a slot", () => {
    const line = treeLineSource({ root: 'Page "A"', up: 2, down: 4 });
    expect(line).toBe('<familytree root="Page &quot;A&quot;" up="2" down="4">');
    expect(treeOnLine(line)).toEqual({ root: 'Page "A"', up: 2, down: 4 });
    expect(parseTreeAttrs('root="Page B"')).toEqual({ root: "Page B", up: 1, down: 3 });
    expect(treeOnLine("text <familytree>")).toBeNull();
    const html = renderPage(`Text.\n\n${line}\n\nMore.`, {}).html;
    expect(html).toContain('class="familytree-slot"');
    expect(html).toContain('data-root="Page &quot;A&quot;"');
    expect(html).toContain('data-up="2"');
  });
});
