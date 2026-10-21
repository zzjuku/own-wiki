import { describe, expect, it } from "vitest";
import type { Infobox } from "./api";
import { diffFields, diffLines } from "./diff";

describe("differences", () => {
  it("aligns equal lines and pairs changed ones", () => {
    const rows = diffLines("A\nB\nC\nD\n", "A\nX\nC\nD\nE");
    expect(rows).toEqual([
      { left: "A", right: "A", changed: false },
      { left: "B", right: "X", changed: true },
      { left: "C", right: "C", changed: false },
      { left: "D", right: "D", changed: false },
      { left: null, right: "E", changed: true },
    ]);
    expect(diffLines("same", "same").every((r) => !r.changed)).toBe(true);
  });

  it("compares infobox fields by name", () => {
    const a: Infobox = { fields: [{ label: "Born", type: "date", value: { year: 250 } }, { label: "Note", type: "text", value: "x" }] };
    const b: Infobox = { fields: [{ label: "born", type: "date", value: { year: 251 } }, { label: "Note", type: "text", value: "x" }, { label: "New", type: "text", value: "y" }] };
    expect(diffFields(a, b)).toEqual([
      { label: "Born", left: "250", right: "251", changed: true },
      { label: "Note", left: "x", right: "x", changed: false },
      { label: "New", left: null, right: "y", changed: true },
    ]);
  });
});
