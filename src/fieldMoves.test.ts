import { describe, expect, it } from "vitest";
import type { Field } from "./api";
import { blockSize, dragOrder, headingDrops, inOrder, sectionOf, sectionOrder } from "./fieldMoves";

const f = (label: string, type: Field["type"] = "text"): Field => ({ label, type });
// a, b | H1: c, d | H2: e
const FIELDS = [f("a"), f("b"), f("H1", "heading"), f("c"), f("d"), f("H2", "heading"), f("e")];
const labels = (order: number[] | null) => (order ? inOrder(FIELDS, order).map((x) => x.label).join(" ") : null);

describe("moving infobox fields", () => {
  it("a heading's block reaches the next heading", () => {
    expect(blockSize(FIELDS, 2)).toBe(3);
    expect(blockSize(FIELDS, 5)).toBe(2);
    expect(blockSize(FIELDS, 3)).toBe(1);
    expect(headingDrops(FIELDS)).toEqual([2, 5, 7]);
  });

  it("dragging moves one field, or a heading with its fields", () => {
    expect(labels(dragOrder(7, 0, 1, 4))).toBe("b H1 c a d H2 e");
    expect(labels(dragOrder(7, 5, 2, 2))).toBe("a b H2 e H1 c d");
    expect(labels(dragOrder(7, 2, 3, 7))).toBe("a b H2 e H1 c d");
    expect(dragOrder(7, 2, 3, 4)).toBeNull();
  });

  it("Move to section puts a field at the end of the section", () => {
    expect(labels(sectionOrder(FIELDS, 0, 2))).toBe("b H1 c d a H2 e");
    expect(labels(sectionOrder(FIELDS, 6, -1))).toBe("a b e H1 c d H2");
    expect(labels(sectionOrder(FIELDS, 3, 5))).toBe("a b H1 d H2 e c");
    expect(sectionOrder(FIELDS, 4, 2)).toBeNull();
  });

  it("Move to section moves a heading with its fields after another section", () => {
    expect(labels(sectionOrder(FIELDS, 2, 5))).toBe("a b H2 e H1 c d");
    expect(labels(sectionOrder(FIELDS, 5, -1))).toBe("a b H2 e H1 c d");
    expect(sectionOrder(FIELDS, 2, -1)).toBeNull();
  });

  it("knows which section a field is in", () => {
    expect(sectionOf(FIELDS, 1)).toBe(-1);
    expect(sectionOf(FIELDS, 4)).toBe(2);
    expect(sectionOf(FIELDS, 6)).toBe(5);
  });
});
