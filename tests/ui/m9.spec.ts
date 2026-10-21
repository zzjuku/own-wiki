// M9: relations — Linked from fields, two-way fields, typed-in entries,
// entering and removing from the reverse side, sort order, spoilers, field renames.
import { expect, test, type Page } from "@playwright/test";
import type { Field, Template } from "../../src/api";
import { oneProject, openProject, PROJECT, storedPage } from "./fixtures";
import type { MockPage } from "./mock/backend";

const PERSON: Template = {
  id: "template-p-k2j4",
  name: "Template P",
  color: "#d5e8d4",
  fields: [
    { key: "f-fa", label: "Father", type: "links" },
    { key: "f-mo", label: "Mother", type: "links" },
    { key: "f-sp", label: "Spouse", type: "links", options: { twoWay: true } },
    { key: "f-ch", label: "Children", type: "linkedfrom", options: { from: ["Father", "Mother"], sortBy: "Born" } },
    { key: "f-bo", label: "Born", type: "date" },
  ],
};
const OTHER: Template = { id: "template-q-m3n5", name: "Template Q", fields: [{ key: "f-lo", label: "Location", type: "links" }] };

/** A page from Template P with some values. */
function person(title: string, values: Record<string, unknown> = {}, spoilers: string[] = []): MockPage {
  return {
    id: `${title}.md`,
    title,
    body: `Text of ${title}.`,
    infobox: {
      template: PERSON.id,
      color: PERSON.color,
      fields: PERSON.fields.map(({ value: _, ...f }) => ({ ...f, value: values[f.label], ...(spoilers.includes(f.label) ? { spoiler: true } : {}) }) as Field),
    },
  };
}

const PAGES: MockPage[] = [
  person("Page A", { Children: ["Page Z"] }),
  person("Page B", { Father: ["Page A"], Born: { year: 30 } }),
  person("Page C", { Mother: ["Page A"], Born: { year: 10 } }, ["Mother"]),
  person("Page D", { Father: ["Page E"], Born: { year: 20 } }),
  person("Page E"),
  { id: "Page F.md", title: "Page F", infobox: { fields: [{ label: "Father", type: "text", value: "Someone" }] } },
  { id: "Page G.md", title: "Page G", body: "No infobox." },
  person("Page H", { Spouse: ["Page A"] }),
];

const data = () => oneProject(PAGES, { templates: [PERSON, OTHER], mainPage: "Page A" });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m9-${name}.png` });
const boxRow = (page: Page, label: string) => page.locator(".read-view .infobox tr").filter({ has: page.locator("th", { hasText: new RegExp(`^${label}$`) }) });
const formRow = (page: Page, label: string) => page.locator(".infobox-form .ib-row").filter({ has: page.locator(".ib-label", { hasText: new RegExp(`^${label}$`) }) });
const fieldValue = async (page: Page, id: string, label: string) =>
  (await storedPage(page, id))?.infobox?.fields.find((f: Field) => f.label === label)?.value;

async function infoboxTab(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
}

/** Opens Add… on a Linked from field and picks a page by name. */
async function addDialog(page: Page, field: string, name: string) {
  await formRow(page, field).getByRole("button", { name: "+ Add…" }).click();
  const dialog = page.getByRole("dialog", { name: `Add to ${field}` });
  await dialog.getByLabel("Page", { exact: true }).fill(name);
  await dialog.getByLabel("Page", { exact: true }).press("Tab");
  return dialog;
}

test("reverse field: children from other pages, sorted by born, spoiler hidden; two-way spouse", async ({ page }) => {
  await openProject(page, data());
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  const children = boxRow(page, "Children").locator("td");
  // Page C (born 10), Page B (born 30), then Page Z (typed in, no page, no date).
  await expect(children.locator("a")).toHaveText(["Page C", "Page B", "Page Z"]);
  await expect(children.locator("a", { hasText: "Page Z" })).toHaveClass(/\bnew\b/);
  // Page C comes from a spoiler field: hidden until clicked.
  const hiddenC = children.locator(".spoiler");
  await expect(hiddenC).toHaveCount(1);
  expect(await hiddenC.evaluate((el) => getComputedStyle(el).color)).toBe("rgba(0, 0, 0, 0)");
  // Two-way: Page H's Spouse shows here.
  await expect(boxRow(page, "Spouse").locator("a")).toHaveText(["Page H"]);
  await shot(page, "infobox-reverse");
  // Clicking the spoiler reveals it; a second click follows the link.
  await hiddenC.click();
  await expect(hiddenC).toHaveClass(/revealed/);
  await children.locator("a", { hasText: "Page C" }).click();
  await expect(page.getByRole("heading", { name: "Page C", level: 1 })).toBeVisible();
});

test("add from the reverse side writes the other page: empty, replace or add, wrong type, missing field", async ({ page }) => {
  await openProject(page, data());
  await infoboxTab(page);
  const before = JSON.stringify((await storedPage(page, "Page A.md")).infobox);

  // Page E: both fields empty, Father chosen first.
  let dialog = await addDialog(page, "Children", "Page E");
  await expect(dialog.getByText("Page A is Page E's:")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Father" })).toBeChecked();
  await expect(dialog).toContainText("Writes Page A into Page E's page");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => fieldValue(page, "Page E.md", "Father")).toEqual(["Page A"]);
  await expect(formRow(page, "Children").locator(".relation-list li", { hasText: "Page E" })).toContainText("from Page E's Father");

  // Page D's Father is already Page E: replace or add.
  dialog = await addDialog(page, "Children", "Page D");
  await expect(dialog.locator(".dialog-warning")).toHaveText("Page D's Father is already Page E.");
  await expect(dialog.getByRole("button", { name: "Replace Page E" })).toBeVisible();
  await dialog.getByRole("button", { name: "Add Page A too" }).click();
  await expect.poll(() => fieldValue(page, "Page D.md", "Father")).toEqual(["Page E", "Page A"]);

  // Page D again: Father already holds Page A, so Mother is chosen; Replace on a taken field.
  dialog = await addDialog(page, "Children", "Page D");
  await expect(dialog.getByRole("radio", { name: "Father" })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: "Mother" })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Page F's Father is a Text field: greyed out; Mother is added as a new field.
  dialog = await addDialog(page, "Children", "Page F");
  await expect(dialog.getByRole("radio", { name: "Father" })).toBeDisabled();
  await expect(dialog).toContainText("a Text field; change it to Page link to use it here");
  await expect(dialog.getByRole("radio", { name: "Mother" })).toBeChecked();
  await expect(dialog).toContainText("added to Page F's page as a new field");
  await shot(page, "add-dialog");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => fieldValue(page, "Page F.md", "Mother")).toEqual(["Page A"]);
  expect(await fieldValue(page, "Page F.md", "Father")).toBe("Someone");

  // Page G has no infobox: it gets one with the field.
  dialog = await addDialog(page, "Children", "Page G");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => fieldValue(page, "Page G.md", "Father")).toEqual(["Page A"]);

  // A page can't be its own child.
  dialog = await addDialog(page, "Children", "Page A");
  await expect(dialog.locator(".dialog-error")).toHaveText("A page can't be listed in its own field.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Nothing was stored on Page A's own page; the preview shows the new children.
  expect(JSON.stringify((await storedPage(page, "Page A.md")).infobox)).toBe(before);
  await expect(page.locator(".split-preview .infobox")).toContainText("Page G");
});

test("add from the reverse side: create the page, or keep a name only", async ({ page }) => {
  await openProject(page, data());
  await infoboxTab(page);
  let dialog = await addDialog(page, "Children", "Page N");
  await expect(dialog).toContainText("Page doesn't exist yet");
  await dialog.getByRole("button", { name: "Create page…" }).click();
  // The same Create page dialog as anywhere, with Page A's template suggested.
  const create = page.getByRole("dialog", { name: "Create page" });
  await expect(create.getByLabel("Page title")).toHaveValue("Page N");
  await expect(create.getByLabel("Template")).toHaveValue(PERSON.id);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create).toBeHidden();
  // Back in the Add dialog, now with the new page's fields to choose from.
  await expect(dialog.getByRole("radio", { name: "Father" })).toBeChecked();
  await expect(dialog).toContainText("Writes Page A into Page N's page");
  await shot(page, "add-dialog-create");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  const created = await storedPage(page, "Page N.md");
  expect(created.infobox.template).toBe(PERSON.id);
  expect(await fieldValue(page, "Page N.md", "Father")).toEqual(["Page A"]);
  await expect(page.locator(".sidebar")).toContainText("Page N");
  // Still on Page A.
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();

  dialog = await addDialog(page, "Children", "Page Y");
  await dialog.getByRole("button", { name: "Keep as name only" }).click();
  await expect.poll(() => fieldValue(page, "Page A.md", "Children")).toEqual(["Page Z", "Page Y"]);
  expect(await storedPage(page, "Page Y.md")).toBeNull();
});

test("removing from the reverse side writes back; typed-in names are removed here", async ({ page }) => {
  await openProject(page, data());
  await infoboxTab(page);
  const children = formRow(page, "Children");
  await expect(children.locator(".relation-list li")).toHaveCount(3);
  await children.getByRole("button", { name: "Remove Page B" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove relation" });
  await expect(confirm).toContainText("Remove Page A from Page B's Father? This changes Page B's page.");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect.poll(() => fieldValue(page, "Page B.md", "Father")).toBeUndefined();
  await expect(children.locator(".relation-list li")).toHaveCount(2);

  await children.getByRole("button", { name: "Remove Page Z" }).click();
  await expect.poll(() => fieldValue(page, "Page A.md", "Children")).toBeUndefined();

  // Two-way: Page H's Spouse shows on Page A's Spouse; removing it edits Page H.
  const spouse = formRow(page, "Spouse");
  await expect(spouse.locator(".relation-extras")).toContainText("from Page H's Spouse");
  await spouse.getByRole("button", { name: "Remove Page H" }).click();
  await page.getByRole("dialog", { name: "Remove relation" }).getByRole("button", { name: "Remove" }).click();
  await expect.poll(() => fieldValue(page, "Page H.md", "Spouse")).toBeUndefined();
  await expect(spouse.locator(".relation-extras")).toHaveCount(0);
});

test("What links here hides the names of spoiler fields", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: /Links here/ }).click();
  const dialog = page.getByRole("dialog", { name: "What links here" });
  const entry = (title: string) => dialog.locator("li").filter({ has: page.locator(".backlink-title", { hasText: new RegExp(`^${title}$`) }) });
  await expect(entry("Page B")).toContainText("via infobox: “Father”");
  await expect(entry("Page C")).toContainText("via infobox: a spoiler field");
  await expect(entry("Page C")).not.toContainText("Mother");
});

test("templates: Linked from settings, two-way, and renaming a field updates Linked from fields", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("navigation", { name: "Templates" }).getByRole("button", { name: /Template P/ }).click();
  const defs = page.locator(".field-defs > li");
  const children = defs.filter({ has: page.locator('input[aria-label="Field label"][value="Children"]') });
  await expect(children.getByRole("group", { name: "Fields that point here" })).toContainText("Father");
  await expect(children.getByLabel("Sort by")).toHaveValue("Born");
  await expect(children.getByRole("checkbox", { name: "Any template" })).toBeChecked();
  const spouse = defs.filter({ has: page.locator('input[aria-label="Field label"][value="Spouse"]') });
  await expect(spouse.getByRole("checkbox", { name: /Two-way/ })).toBeChecked();
  await children.scrollIntoViewIfNeeded();
  await shot(page, "template-linked-from");

  // Only pages from Template Q.
  await children.getByRole("checkbox", { name: "Template Q" }).check();
  await expect(children.getByRole("checkbox", { name: "Any template" })).not.toBeChecked();

  // Rename Father -> Sire: Children reads Sire from now on.
  const father = defs.locator('input[aria-label="Field label"]').first();
  await father.fill("Sire");
  await father.blur();
  const stored = () =>
    page.evaluate((p) => JSON.parse(JSON.stringify((window as any).__mock.projects.get(p).templates)), PROJECT) as Promise<Template[]>;
  await expect.poll(async () => (await stored())[0].fields[3].options).toEqual({
    from: ["Sire", "Mother"],
    sortBy: "Born",
    templates: [OTHER.id],
  });
  await expect(children.getByRole("group", { name: "Fields that point here" })).toContainText("Sire");
});

test("a page's Page link field changed to Linked from keeps its values as typed-in entries", async ({ page }) => {
  const own: MockPage = { id: "Page K.md", title: "Page K", infobox: { fields: [{ label: "Kids", type: "links", value: ["Page B", "Page Q"] }] } };
  await openProject(page, oneProject([...PAGES, own], { templates: [PERSON], mainPage: "Page K" }));
  await infoboxTab(page);
  await page.getByRole("button", { name: "Settings for Kids" }).click();
  await page.locator(".ib-settings").getByLabel("Field type").selectOption("linkedfrom");
  const row = formRow(page, "Kids");
  await expect(row.locator(".relation-list li")).toHaveText([/Page B.*typed in/, /Page Q.*typed in/]);
  await expect.poll(async () => (await storedPage(page, "Page K.md")).infobox.fields[0]).toMatchObject({ type: "linkedfrom", value: ["Page B", "Page Q"] });
});

test("Father and Children both Linked from: warned in the template and the Infobox tab, greyed out in Add", async ({ page }) => {
  const circular: Template = {
    ...PERSON,
    fields: PERSON.fields.map((f) => (f.label === "Father" ? { ...f, type: "linkedfrom" as const, options: { from: ["Children"] } } : f)),
  };
  const pages: MockPage[] = [
    { id: "Page A.md", title: "Page A", infobox: { template: PERSON.id, fields: circular.fields.map((f) => ({ ...f })) } },
    { id: "Page E.md", title: "Page E", infobox: { template: PERSON.id, fields: circular.fields.map((f) => ({ ...f })) } },
  ];
  await openProject(page, oneProject(pages, { templates: [circular], mainPage: "Page A" }));
  await infoboxTab(page);
  await expect(formRow(page, "Children").locator(".field-warning")).toContainText("“Father” is a Linked from field too");
  const dialog = await addDialog(page, "Children", "Page E");
  await expect(dialog.getByRole("radio", { name: "Father" })).toBeDisabled();
  await expect(dialog).toContainText("a Linked from field (it fills itself)");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Templates" }).click();
  const children = page.locator(".field-defs > li").filter({ has: page.locator('input[aria-label="Field label"][value="Children"]') });
  await expect(children.locator(".field-warning")).toContainText("Make “Father” a Page link field");
  await children.scrollIntoViewIfNeeded();
  await shot(page, "template-circular-warning");
});

// ---- page lists and the Relations table ----

const PLACE: Template = {
  id: "template-pl-a1b2",
  name: "Template Place",
  fields: [{ key: "f-ch", label: "Chapters", type: "linkedfrom", options: { from: ["Location"], show: "list", listHeading: "Chapters set here", sortBy: "Chapter no." } }],
};
const CHAPTER: Template = {
  id: "template-ch-c3d4",
  name: "Template Chapter",
  fields: [
    { key: "f-lo", label: "Location", type: "links" },
    { key: "f-no", label: "Chapter no.", type: "number" },
  ],
};
const chapter = (title: string, no: number, location: string): MockPage => ({
  id: `${title}.md`,
  title,
  body: "Chapter text.",
  infobox: { template: CHAPTER.id, fields: [{ ...CHAPTER.fields[0], value: [location] }, { ...CHAPTER.fields[1], value: no }] },
});
const listPages = (): MockPage[] => [
  { id: "Place A.md", title: "Place A", body: "## Section A\n\nText of the place.\n\n## Section B\n\nMore text.", infobox: { template: PLACE.id, fields: PLACE.fields.map((f) => ({ ...f })) } },
  chapter("Chapter Two", 2, "Place A"),
  chapter("Chapter One", 1, "Place A"),
  chapter("Chapter Three", 3, "Place B"),
  { id: "Page H.md", title: "Page H", body: "Host text.\n\n{{Place A}}\n" },
];
const listData = () => oneProject(listPages(), { templates: [PLACE, CHAPTER], mainPage: "Place A" });

test("page list at the bottom of the page: heading in Contents, sorted, not in the infobox", async ({ page }) => {
  await openProject(page, listData());
  const text = page.locator(".read-view .markdown");
  await expect(text.locator("h2", { hasText: "Chapters set here" })).toBeVisible();
  await expect(text.locator("ul.page-list li")).toHaveText(["Chapter One", "Chapter Two"]);
  await expect(page.locator(".toc-left")).toContainText("Chapters set here");
  await expect(page.locator(".read-view .infobox")).toHaveCount(0);
  await shot(page, "page-list-bottom");
  // Embedded: the list belongs to the embedded page.
  await page.locator(".sidebar .tree-row", { hasText: "Page H" }).locator(".tree-main").click();
  await expect(page.locator(".read-view .embed ul.page-list li")).toHaveText(["Chapter One", "Chapter Two"]);
});

test("page list as a line in the text: Page list dialog, reopen by clicking the line, remove", async ({ page }) => {
  await openProject(page, listData());
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.getByRole("button", { name: /Page list/ }).click();
  const dialog = page.getByRole("dialog", { name: "Page list" });
  await dialog.getByRole("group", { name: "Fields that point here" }).getByRole("combobox").fill("Location");
  await dialog.getByRole("group", { name: "Fields that point here" }).getByRole("combobox").press("Enter");
  await dialog.getByRole("checkbox", { name: "Template Chapter" }).check();
  await dialog.getByLabel("Sort by").selectOption("Chapter no.");
  await shot(page, "page-list-dialog");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect.poll(async () => (await storedPage(page, "Place A.md"))?.body).toContain('<pagelist from="Location" templates="Template Chapter" sort="Chapter no.">');
  await expect(page.locator(".split-preview ul.page-list").last().locator("li")).toHaveText(["Chapter One", "Chapter Two"]);
  // Clicking the line reopens the dialog with its settings.
  await page.locator(".cm-line", { hasText: "<pagelist" }).click();
  await expect(dialog.getByLabel("Sort by")).toHaveValue("Chapter no.");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(async () => (await storedPage(page, "Place A.md"))?.body).not.toContain("<pagelist");
});

test("template: Show as a list at the bottom, with a heading", async ({ page }) => {
  await openProject(page, listData());
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("navigation", { name: "Templates" }).getByRole("button", { name: /Template Place/ }).click();
  const def = page.locator(".field-defs > li").first();
  await expect(def.getByLabel("Show")).toHaveValue("list");
  await expect(def.getByLabel("List heading")).toHaveValue("Chapters set here");
  await def.getByLabel("Show").selectOption("");
  await expect(def.getByLabel("List heading")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((p) => (window as any).__mock.projects.get(p).templates[0].fields[0].options, PROJECT))
    .toEqual({ from: ["Location"], listHeading: "Chapters set here", sortBy: "Chapter no." });
});

test("Relations table: rows, where they show up, problems, filter", async ({ page }) => {
  const pages = [...listPages(), chapter("Chapter Four", 4, "Place Missing"), { id: "Place B.md", title: "Place B" }];
  pages.push({ id: "Page Z.md", title: "Page Z", infobox: { fields: [{ label: "Members", type: "linkedfrom", options: { from: ["Nowhere"] } }] } });
  await openProject(page, oneProject(pages, { templates: [PLACE, CHAPTER], mainPage: "Place A" }));
  await page.getByRole("button", { name: "Relations" }).click();
  await expect(page.getByRole("heading", { name: "Relations", level: 1 })).toBeVisible();
  const table = page.locator(".relations-table");
  const row = (title: string) => table.locator("tbody tr").filter({ has: page.locator("td:first-child", { hasText: title }) });
  await expect(row("Chapter One")).toContainText("Place A → Chapters (list)");
  await expect(row("Chapter Three")).toContainText("Doesn't show on Place B");
  await expect(row("Chapter Four")).toContainText("No page “Place Missing” yet");
  await expect(page.locator(".relations-field-problems")).toContainText("Members reads “Nowhere”");
  await shot(page, "relations-table");
  await page.getByLabel("Only problems").check();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).not.toContainText("Chapter One");
  await page.getByLabel("Only problems").uncheck();
  await page.getByLabel("Filter relations").fill("chapter two");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await row("Chapter Two").getByRole("button", { name: "Place A" }).click();
  await expect(page.getByRole("heading", { name: "Place A", level: 1 })).toBeVisible();
});
