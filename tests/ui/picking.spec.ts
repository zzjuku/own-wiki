// Several pages at once: picking pages in the sidebar (move, category,
// delete), Add several… in Page link fields and in Linked from fields.
import { expect, test, type Page } from "@playwright/test";
import type { Field, Template } from "../../src/api";
import { oneProject, openProject, storedPage } from "./fixtures";
import type { MockPage } from "./mock/backend";

const PERSON: Template = {
  id: "template-p-k2j4",
  name: "Template P",
  fields: [
    { key: "f-fa", label: "Father", type: "links" },
    { key: "f-mo", label: "Mother", type: "links" },
    { key: "f-al", label: "Allies", type: "links" },
    { key: "f-ch", label: "Children", type: "linkedfrom", options: { from: ["Father", "Mother"] } },
  ],
};
const person = (title: string, values: Record<string, unknown> = {}): MockPage => ({
  id: `${title}.md`,
  title,
  infobox: { template: PERSON.id, fields: PERSON.fields.map((f) => ({ ...f, value: values[f.label] }) as Field) },
});
const PAGES = [person("Page A"), person("Page B"), person("Page C"), person("Page D", { Father: ["Page E"] }), person("Page E")];
const data = () => oneProject(PAGES, { templates: [PERSON], groups: ["Group A"], mainPage: "Page A" });
const row = (page: Page, title: string) => page.locator(".sidebar .tree-row").filter({ hasText: new RegExp(`^${title}`) }).locator(".tree-main");
const formRow = (page: Page, label: string) =>
  page.locator(".infobox-form .ib-row").filter({ has: page.locator(".ib-label", { hasText: new RegExp(`^${label}$`) }) });
const fieldValue = async (page: Page, id: string, label: string) =>
  (await storedPage(page, id))?.infobox?.fields.find((f: Field) => f.label === label)?.value;

test("sidebar: ⌘/Ctrl-click and Shift-click pick pages; move, add a category, delete them together", async ({ page }) => {
  await openProject(page, data());
  await row(page, "Page B").click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("toolbar", { name: "Picked pages" });
  // The open page counts as picked.
  await expect(bar).toContainText("2 pages");
  await row(page, "Page D").click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("4 pages");
  // ⌘/Ctrl-click a picked page: it's let go again.
  await row(page, "Page A").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toContainText("3 pages");
  await expect(page.locator(".sidebar .tree-row.picked")).toHaveCount(3);
  await page.screenshot({ path: "test-results/picking-sidebar.png" });

  await bar.getByRole("button", { name: "Category…" }).click();
  const cat = page.getByRole("dialog", { name: /Add a category/ });
  await cat.getByLabel("Category").fill("Category X");
  await cat.getByRole("button", { name: "Add" }).click();
  await expect.poll(async () => (await storedPage(page, "Page C.md"))?.categories).toEqual(["Category X"]);
  expect((await storedPage(page, "Page B.md")).categories).toEqual(["Category X"]);
  expect((await storedPage(page, "Page A.md")).categories).toEqual([]);

  await bar.getByRole("button", { name: "Move to…" }).click();
  const move = page.getByRole("dialog", { name: /Move 3 pages/ });
  await move.getByText("Group A", { exact: true }).click();
  await move.getByRole("button", { name: "Move" }).click();
  await expect.poll(() => storedPage(page, "Group A/Page C.md")).not.toBeNull();
  expect(await storedPage(page, "Group A/Page B.md")).not.toBeNull();
  expect(await storedPage(page, "Group A/Page D.md")).not.toBeNull();
  await expect(bar).toContainText("3 pages");

  await bar.getByRole("button", { name: "Delete…" }).click();
  const del = page.getByRole("dialog", { name: "Delete pages" });
  await expect(del).toContainText("Move 3 pages to the Trash?");
  await del.getByRole("button", { name: "Move to Trash" }).click();
  await expect.poll(() => storedPage(page, "Group A/Page C.md")).toBeNull();
  await expect(bar).toBeHidden();
  expect(await storedPage(page, "Page E.md")).not.toBeNull();

  // A plain click opens a page and lets go of the picked ones; Escape too.
  await row(page, "Page E").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
});

test("Page link field: Add several… with tick boxes", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  await formRow(page, "Allies").getByRole("button", { name: "+ Add several…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add pages to Allies" });
  await expect(dialog.getByRole("checkbox", { name: /Page A/ })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /Page B/ }).check();
  // Enter in the search box ticks the best match.
  await dialog.getByLabel("Find pages").fill("Page D");
  await dialog.getByLabel("Find pages").press("Enter");
  await expect(dialog.getByLabel("Find pages")).toHaveValue("");
  await page.screenshot({ path: "test-results/picking-picker.png" });
  await dialog.getByRole("button", { name: "Add 2 pages" }).click();
  await expect.poll(() => fieldValue(page, "Page A.md", "Allies")).toEqual(["Page B", "Page D"]);
});

test("Linked from field: Add several… with one choice for all", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  await formRow(page, "Children").getByRole("button", { name: "+ Add several…" }).click();
  const picker = page.getByRole("dialog", { name: "Add pages to Children" });
  for (const t of ["Page B", "Page C", "Page D"]) await picker.getByRole("checkbox", { name: new RegExp(t) }).check();
  await picker.getByRole("button", { name: "Next: 3 pages" }).click();
  const dialog = page.getByRole("dialog", { name: "Add several to Children" });
  await expect(dialog.getByRole("radio", { name: "Father" })).toBeChecked();
  const plan = dialog.getByRole("list", { name: "What happens on each page" });
  await expect(plan).toContainText("Page D");
  await expect(plan).toContainText("Page A added next to Page E");
  await dialog.getByLabel(/already holds another page/).selectOption("skip");
  await expect(plan).toContainText("already Page E: skipped");
  await page.screenshot({ path: "test-results/picking-several-children.png" });
  await dialog.getByRole("button", { name: "Add to 2 pages" }).click();
  await expect(dialog).toBeHidden();
  expect(await fieldValue(page, "Page B.md", "Father")).toEqual(["Page A"]);
  expect(await fieldValue(page, "Page C.md", "Father")).toEqual(["Page A"]);
  expect(await fieldValue(page, "Page D.md", "Father")).toEqual(["Page E"]);
  await expect(formRow(page, "Children").locator(".relation-list li")).toHaveCount(2);
});
