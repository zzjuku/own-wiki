import { describe, expect, it } from "vitest";
import { entryPage, hasWords, joinLinkEntry, parseLinkEntry } from "./linkEntry";

describe("Page link entries with words around the link", () => {
  it("reads and writes plain names and names with words", () => {
    expect(parseLinkEntry("Page A")).toEqual({ before: "", page: "Page A", after: "" });
    expect(parseLinkEntry("Lord [[Page A#Early life]] (supposedly)")).toEqual({ before: "Lord", page: "Page A#Early life", after: "(supposedly)" });
    expect(joinLinkEntry({ before: " Lord ", page: "Page A", after: "" })).toBe("Lord [[Page A]]");
    expect(joinLinkEntry({ before: "", page: "Page A", after: ", the Elder" })).toBe("[[Page A]], the Elder");
    expect(joinLinkEntry({ before: "", page: "Page A", after: " " })).toBe("Page A");
    expect(entryPage("Lord [[Page A#S]]")).toBe("Page A");
    expect(entryPage("Page B#S")).toBe("Page B");
    expect(hasWords("Page A")).toBe(false);
  });
});
