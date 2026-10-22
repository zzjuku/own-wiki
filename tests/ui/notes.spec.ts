// M13: field notes — a short note before or after an entry, on every field type,
// with formatting, links and spoilers.
import { expect, test, type Page } from "@playwright/test";
import type { Field } from "../../src/api";
import { oneProject, openProject, storedPage } from "./fixtures";
import type { MockPage } from "./mock/backend";

const FIELDS: Field[] = [
  { label: "House", type: "links", value: ["Page B", "Page C"] },
  { label: "Titles", type: "list", value: ["Lord of X", "Knight"] },
  { label: "Motto", type: "text", value: "Example motto" },
  { label: "Born", type: "date", value: { year: 283 } },
  { label: "Battles", type: "datetext", options: { multiple: true }, value: [{ date: { year: 290 }, text: "Battle A" }] },
  { label: "Secret", type: "text", value: "Hidden value", spoiler: true, notes: [{ i: 0, text: "(note)" }] },
];

const PAGES: MockPage[] = [
  { id: "Page A.md", title: "Page A", body: "Text.", infobox: { fields: FIELDS } },
  { id: "Page B.md", title: "Page B", body: "B." },
  { id: "Page C.md", title: "Page C", body: "C." },
];

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/notes-${name}.png` });
const formRow = (page: Page, label: string) => page.locator(".infobox-form .ib-row").filter({ has: page.locator(".ib-label", { hasText: new RegExp(`^${label}$`) }) });
const fields = async (page: Page) => (await storedPage(page, "Page A.md")).infobox.fields as Field[];
const notesOf = async (page: Page, label: string) => (await fields(page)).find((f) => f.label === label)?.notes;

async function typeNote(page: Page, label: string, text: string) {
  const box = page.getByLabel(`${label}: note`, { exact: true });
  await box.click();
  await page.keyboard.type(text);
}

test("notes before and after entries of every kind of field show in the infobox", async ({ page }) => {
  await openProject(page, oneProject(PAGES));
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();

  // A Page link entry: after (the default), with italics.
  await formRow(page, "House").getByRole("button", { name: "Note for House 2" }).click();
  await typeNote(page, "House 2", "*(by marriage)*");
  // A List item: before.
  await formRow(page, "Titles").getByRole("button", { name: "Note for Titles 1" }).click();
  await typeNote(page, "Titles 1", "(claimed)");
  await page.getByRole("button", { name: "Titles 1: note after the entry" }).click();
  await expect(page.getByRole("button", { name: "Titles 1: note before the entry" })).toBeVisible();
  // A Text field (one value): a link in the note.
  await formRow(page, "Motto").getByRole("button", { name: "Note for Motto" }).click();
  await typeNote(page, "Motto", "see [[Page C]]");
  // A Date and a Date, text entry; a spoiler in a note.
  await formRow(page, "Born").getByRole("button", { name: "Note for Born" }).click();
  await typeNote(page, "Born", "(||secret||)");
  await formRow(page, "Battles").getByRole("button", { name: "Note for Battles 1" }).click();
  await typeNote(page, "Battles 1", "(won)");
  await shot(page, "editor");

  await expect.poll(() => notesOf(page, "House")).toEqual([{ i: 1, text: "*(by marriage)*" }]);
  expect(await notesOf(page, "Titles")).toEqual([{ i: 0, text: "(claimed)", before: true }]);
  expect(await notesOf(page, "Motto")).toEqual([{ i: 0, text: "see [[Page C]]" }]);
  expect(await notesOf(page, "Born")).toEqual([{ i: 0, text: "(||secret||)" }]);
  expect(await notesOf(page, "Battles")).toEqual([{ i: 0, text: "(won)" }]);
  // The values themselves are unchanged.
  expect((await fields(page)).find((f) => f.label === "House")?.value).toEqual(["Page B", "Page C"]);

  await page.getByRole("button", { name: "View", exact: true }).click();
  const box = page.locator(".read-view .infobox");
  const cell = (label: string) => box.locator("tr").filter({ has: page.locator("th", { hasText: label }) }).locator("td");
  await expect(cell("House")).toContainText("Page C (by marriage)");
  await expect(cell("House").locator(".infobox-note em")).toHaveText("(by marriage)");
  await expect(cell("Titles")).toContainText("(claimed) Lord of X");
  await expect(cell("Motto").locator(".infobox-note a.wikilink")).toHaveText("Page C");
  await expect(cell("Born").locator(".infobox-note .spoiler")).toHaveCount(1);
  await expect(cell("Battles")).toContainText("(won)");
  // A note in a spoiler field is hidden with the value.
  await expect(cell("Secret").locator(".spoiler .infobox-note")).toHaveCount(1);
  await shot(page, "infobox");
});

test("a list entry's note moves with it and goes when it's removed", async ({ page }) => {
  const pages = [{ ...PAGES[0], infobox: { fields: [{ label: "Titles", type: "list" as const, value: ["A", "B", "C"], notes: [{ i: 2, text: "(note C)" }] }] } }];
  await openProject(page, oneProject(pages));
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  // Removing the first entry: C's note is now on entry 1.
  await formRow(page, "Titles").getByRole("button", { name: "Remove entry" }).first().click();
  await expect.poll(() => notesOf(page, "Titles")).toEqual([{ i: 1, text: "(note C)" }]);
  // Removing C removes its note.
  await formRow(page, "Titles").getByRole("button", { name: "Remove entry" }).nth(1).click();
  await expect.poll(() => notesOf(page, "Titles")).toBeUndefined();
  // The note's own × removes only the note.
  await formRow(page, "Titles").getByRole("button", { name: "Note for Titles 1" }).click();
  await typeNote(page, "Titles 1", "(x)");
  await expect.poll(() => notesOf(page, "Titles")).toEqual([{ i: 0, text: "(x)" }]);
  await page.getByRole("button", { name: "Remove the note of Titles 1" }).click();
  await expect.poll(() => notesOf(page, "Titles")).toBeUndefined();
  expect((await fields(page))[0].value).toEqual(["B"]);
});

test("links in notes are links: red links create pages; search finds notes", async ({ page }) => {
  const pages: MockPage[] = [
    { ...PAGES[0], infobox: { fields: [{ label: "House", type: "links", value: ["Page B"], notes: [{ i: 0, text: "(by marriage, see [[Missing X]])" }] }] } },
    PAGES[1],
  ];
  await openProject(page, oneProject(pages));
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  const red = page.locator(".read-view .infobox .infobox-note a.wikilink.new");
  await expect(red).toHaveText("Missing X");
  await red.click();
  await expect(page.getByRole("dialog")).toContainText("Create page");
  await page.getByRole("button", { name: "Cancel" }).click();
  // Search finds the note's words.
  await page.getByLabel("Search the project").fill("marriage");
  await page.keyboard.press("Enter");
  await expect(page.locator(".search-result").first()).toContainText("Page A");
});

test("removing a relation from the other page removes only that entry's note", async ({ page }) => {
  const pages: MockPage[] = [
    { id: "Page A.md", title: "Page A", body: "A.", infobox: { fields: [{ label: "Children", type: "linkedfrom", options: { from: ["Father"] } }] } },
    {
      id: "Page B.md",
      title: "Page B",
      body: "B.",
      infobox: { fields: [{ label: "Father", type: "links", value: ["Page Z", "Page A"], notes: [{ i: 0, text: "(note Z)" }, { i: 1, text: "(note A)" }] }] },
    },
  ];
  await openProject(page, oneProject(pages));
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  await formRow(page, "Children").getByRole("button", { name: "Remove Page B" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(async () => (await storedPage(page, "Page B.md")).infobox.fields[0]).toMatchObject({ value: ["Page Z"], notes: [{ i: 0, text: "(note Z)" }] });
});

test("notes in the built-in themes", async ({ page }) => {
  test.setTimeout(60_000);
  const fields: Field[] = [
    { label: "House", type: "links", value: ["Page B", "Page C"], notes: [{ i: 1, text: "*(by marriage)*" }] },
    { label: "Titles", type: "list", value: ["Lord of X"], notes: [{ i: 0, text: "(claimed)", before: true }] },
  ];
  for (const id of ["default", "parchment", "awoiaf", "folio", "midnight"]) {
    await openProject(page, { ...oneProject([{ ...PAGES[0], infobox: { fields } }, PAGES[1], PAGES[2]]), appTheme: `builtin:${id}` });
    await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
    await expect(page.locator(".read-view .infobox .infobox-note")).toHaveCount(2);
    await page.locator(".read-view .infobox").screenshot({ path: `test-results/notes-theme-${id}.png` });
  }
});
