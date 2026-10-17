import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  activeFormats,
  indentListItem,
  insertDivider,
  toggleHeading,
  toggleInline,
  toggleList,
  toggleQuote,
} from "./formatting";

/** Runs a command on text where `|` marks the cursor or `[`…`]` a selection,
 * and returns the result in the same notation. */
function run(command: StateCommand, input: string): string {
  let state = make(input);
  command({ state, dispatch: (tr: Transaction) => (state = tr.state) });
  return show(state);
}

function make(input: string) {
  const ext = markdown({ base: markdownLanguage });
  if (input.includes("[")) {
    const from = input.indexOf("[");
    const to = input.indexOf("]") - 1;
    return EditorState.create({
      doc: input.replace("[", "").replace("]", ""),
      selection: EditorSelection.range(from, to),
      extensions: ext,
    });
  }
  const at = input.indexOf("|");
  return EditorState.create({ doc: input.replace("|", ""), selection: EditorSelection.cursor(at), extensions: ext });
}

function show(state: EditorState) {
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  if (from === to) return doc.slice(0, from) + "|" + doc.slice(from);
  return doc.slice(0, from) + "[" + doc.slice(from, to) + "]" + doc.slice(to);
}

describe("inline formatting", () => {
  it("wraps a selection", () => {
    expect(run(toggleInline("bold"), "a [word] b")).toBe("a **[word]** b");
    expect(run(toggleInline("italic"), "a [word] b")).toBe("a *[word]* b");
    expect(run(toggleInline("strike"), "a [word] b")).toBe("a ~~[word]~~ b");
  });

  it("leaves spaces at the selection edges outside", () => {
    expect(run(toggleInline("bold"), "a[ word ]b")).toBe("a **[word]** b");
  });

  it("formats the word under the cursor", () => {
    expect(run(toggleInline("bold"), "one tw|o three")).toBe("one **tw|o** three");
  });

  it("inserts empty markers away from a word", () => {
    expect(run(toggleInline("bold"), "one |")).toBe("one **|**");
  });

  it("removes formatting when the cursor is inside it", () => {
    expect(run(toggleInline("bold"), "a **wo|rd** b")).toBe("a wo|rd b");
    expect(run(toggleInline("italic"), "a *wo|rd* b")).toBe("a wo|rd b");
    expect(run(toggleInline("strike"), "a ~~wo|rd~~ b")).toBe("a wo|rd b");
  });

  it("removes formatting from a selection inside it", () => {
    expect(run(toggleInline("bold"), "a **[word]** b")).toBe("a [word] b");
  });

  it("wraps each line of a multi-line selection, after list markers", () => {
    expect(run(toggleInline("bold"), "- [one\n- two]")).toBe("- **[one**\n- **two]**");
  });

  it("bold and italic stack", () => {
    expect(run(toggleInline("italic"), "**[word]**")).toBe("***[word]***");
  });
});

describe("headings", () => {
  it("adds, switches and removes heading levels", () => {
    expect(run(toggleHeading(2), "Ti|tle")).toBe("## Ti|tle");
    expect(run(toggleHeading(3), "## Ti|tle")).toBe("### Ti|tle");
    expect(run(toggleHeading(2), "## Ti|tle")).toBe("Ti|tle");
  });

  it("replaces a list marker", () => {
    expect(run(toggleHeading(2), "- Ite|m")).toBe("## Ite|m");
  });
});

describe("lists and quotes", () => {
  it("toggles bullets on several lines", () => {
    expect(run(toggleList(false), "[a\nb]")).toBe("- [a\n- b]");
    expect(run(toggleList(false), "[- a\n- b]")).toBe("[a\nb]");
  });

  it("numbers lines and converts bullets", () => {
    expect(run(toggleList(true), "[- a\n- b]")).toBe("[1. a\n2. b]");
  });

  it("continues the numbering of the item above", () => {
    expect(run(toggleList(true), "1. a\nb|")).toBe("1. a\n2. b|");
  });

  it("skips blank lines in a multi-line selection", () => {
    expect(run(toggleList(false), "[a\n\nb]")).toBe("- [a\n\n- b]");
  });

  it("starts a list on an empty line", () => {
    expect(run(toggleList(false), "|")).toBe("- |");
  });

  it("toggles quotes", () => {
    expect(run(toggleQuote(), "[a\nb]")).toBe("> [a\n> b]");
    expect(run(toggleQuote(), "[> a\n> b]")).toBe("[a\nb]");
  });
});

describe("divider", () => {
  it("goes on its own line with blank lines around it", () => {
    expect(run(insertDivider, "Text|")).toBe("Text\n\n---\n\n|");
    expect(run(insertDivider, "Text\n\n|")).toBe("Text\n\n---\n\n|");
  });
});

describe("list indent", () => {
  it("nests under the item above, by its marker width", () => {
    expect(run(indentListItem(false), "- a\n- b|")).toBe("- a\n  - b|");
    expect(run(indentListItem(false), "1. a\n2. b|")).toBe("1. a\n   2. b|");
  });

  it("can't nest the first item", () => {
    expect(run(indentListItem(false), "- a|")).toBe("- a|");
  });

  it("outdents to the parent", () => {
    expect(run(indentListItem(true), "- a\n  - b|")).toBe("- a\n- b|");
  });

  it("does nothing outside a list", () => {
    let handled = true;
    const state = make("text|");
    handled = indentListItem(false)({ state, dispatch: () => {} });
    expect(handled).toBe(false);
  });
});

describe("active formats", () => {
  it("reports the formatting at the cursor", () => {
    const f = activeFormats(make("## a **b|c** d"));
    expect(f.heading).toBe(2);
    expect(f.bold).toBe(true);
    expect(f.italic).toBe(false);
    expect(activeFormats(make("1. it|em")).ordered).toBe(true);
    expect(activeFormats(make("- it|em")).bullet).toBe(true);
    expect(activeFormats(make("> qu|ote")).quote).toBe(true);
  });
});
