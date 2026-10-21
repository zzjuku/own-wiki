import { describe, expect, it } from "vitest";
import cases from "../shared-tests/search.json";
import { findInText, fold, matchesAll, parseQuery } from "./search";

describe("search matching (shared with Rust)", () => {
  it("folds", () => {
    for (const [a, b] of cases.fold) expect(fold(a), a).toBe(b);
  });
  it("parses queries", () => {
    for (const c of cases.queries) expect(parseQuery(c.query), c.query).toEqual(c.terms);
  });
  it("matches word starts", () => {
    for (const c of cases.matches) {
      const terms = parseQuery(c.query);
      // Rust lists matches term by term; compare as sets of found pieces in order of terms.
      const found = terms.flatMap((t) => findInText(c.text, [t]).map(([a, b]) => c.text.slice(a, b)));
      expect(found, c.name).toEqual(c.found);
    }
  });
  it("needs every word", () => {
    expect(matchesAll("Page Alpha", parseQuery("al pa"))).toBe(true);
    expect(matchesAll("Page Alpha", parseQuery("al x"))).toBe(false);
  });
});
