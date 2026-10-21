// Small additions from the M9 checkpoint review: creating a missing page from
// an infobox field, the open page's template suggested for new pages, Enter
// for the next list entry, hiding the sidebar, dragging the page width.
import { expect, test, type Page } from "@playwright/test";
import type { Field } from "../../src/api";
import { oneProject, openProject, storedPage } from "./fixtures";
import { TEMPLATE } from "./fixtures-data";
import type { MockPage } from "./mock/backend";

const OTHER = { id: "template-b-z9y8", name: "Template B", fields: [{ key: "f-b", label: "Field B", type: "text" as const }] };
const PAGE_A: MockPage = {
  id: "Page A.md",
  title: "Page A",
  body: "Text with a [[Missing page]].",
  infobox: {
    template: TEMPLATE.id,
    fields: [
      { key: "f-lnk", label: "Linked page", type: "links", value: ["Page N"] },
      { key: "f-ls", label: "Example list", type: "list", value: ["First"] },
    ],
  },
};
const data = () => oneProject([PAGE_A, { id: "Page B.md", title: "Page B" }], { templates: [TEMPLATE, OTHER], mainPage: "Page A" });
const formRow = (page: Page, label: string) =>
  page.locator(".infobox-form .ib-row").filter({ has: page.locator(".ib-label", { hasText: new RegExp(`^${label}$`) }) });
const fieldValue = async (page: Page, id: string, label: string) =>
  (await storedPage(page, id))?.infobox?.fields.find((f: Field) => f.label === label)?.value;

test("a missing page in a Page link field can be created there, with this page's template", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  const row = formRow(page, "Linked page");
  await expect(row.locator(".missing-note")).toContainText("Page doesn't exist yet");
  await row.getByRole("button", { name: "Create page…" }).click();
  const dialog = page.getByRole("dialog", { name: "Create page" });
  await expect(dialog.getByLabel("Page title")).toHaveValue("Page N");
  await expect(dialog.getByLabel("Template")).toHaveValue(TEMPLATE.id);
  await expect(dialog).toContainText("You stay on this page.");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  expect((await storedPage(page, "Page N.md")).infobox.template).toBe(TEMPLATE.id);
  // Still editing Page A's infobox; the name is no longer red.
  await expect(page.getByRole("tab", { name: "Infobox" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  await expect(row.locator(".missing-note")).toHaveCount(0);
  await expect(page.locator(".split-preview .infobox a", { hasText: "Page N" })).not.toHaveClass(/\bnew\b/);
});

test("a red link suggests the template of the page it's on, and waits for Create", async ({ page }) => {
  await openProject(page, data());
  await page.locator(".read-view .markdown a.new", { hasText: "Missing page" }).click();
  const dialog = page.getByRole("dialog", { name: "Create page" });
  await expect(dialog.getByLabel("Template")).toHaveValue(TEMPLATE.id);
  // Not created yet; the template can still be changed.
  expect(await storedPage(page, "Missing page.md")).toBeNull();
  await dialog.getByLabel("Template").selectOption(OTHER.id);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect.poll(async () => (await storedPage(page, "Missing page.md"))?.infobox?.template).toBe(OTHER.id);
});

test("Enter in a list entry starts the next entry", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  const list = formRow(page, "Example list");
  await list.locator(".cm-content").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  await expect.poll(() => fieldValue(page, "Page A.md", "Example list")).toEqual(["First", "Second"]);
  // Enter on an empty entry doesn't add another one.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(list.locator(".ib-list-item")).toHaveCount(3);

  const links = formRow(page, "Linked page");
  await links.getByRole("textbox").first().press("Escape");
  await links.getByRole("textbox").first().press("Enter");
  await expect(links.locator(".ib-list-item")).toHaveCount(2);
  await expect(links.getByRole("textbox").nth(1)).toBeFocused();
  await page.keyboard.type("Page B");
  await expect.poll(() => fieldValue(page, "Page A.md", "Linked page")).toEqual(["Page N", "Page B"]);
});

test("the sidebar can be hidden and shown again; remembered on this computer", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Hide the sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.screenshot({ path: "test-results/qol-sidebar-hidden.png" });
  await page.reload();
  await page.getByText("Project A", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Show the sidebar" })).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Show the sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page.locator(".sidebar")).toBeHidden();
});

test("dragging the page edge sets the page width; the infobox stays put when the sidebar hides", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openProject(page, data());
  const column = page.locator(".read-view > .read-column");
  const box = page.locator(".read-view .infobox");
  const before = (await column.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Page width" });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + 40);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 300, h.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await column.boundingBox())!.width).toBeLessThan(before - 250);
  expect(await page.evaluate(() => localStorage.getItem("ownwiki.pageRight"))).not.toBeNull();

  // Hiding the sidebar: the infobox keeps its place, the text gets the room.
  const boxX = (await box.boundingBox())!.x;
  const textLeft = (await column.boundingBox())!.x;
  await page.getByRole("button", { name: "Hide the sidebar" }).click();
  await expect.poll(async () => (await column.boundingBox())!.x).toBeLessThan(textLeft - 200);
  await expect.poll(async () => Math.abs((await box.boundingBox())!.x - boxX)).toBeLessThan(2);
  await page.getByRole("button", { name: "Show the sidebar" }).click();
  await expect.poll(async () => Math.abs((await box.boundingBox())!.x - boxX)).toBeLessThan(2);

  await handle.dblclick();
  await expect.poll(async () => (await column.boundingBox())!.width).toBeCloseTo(before, 0);
  expect(await page.evaluate(() => localStorage.getItem("ownwiki.pageRight"))).toBeNull();
});

test("Date, place and Date, text fields: date with text after it, several entries", async ({ page }) => {
  const pageD: MockPage = {
    id: "Page D.md",
    title: "Page D",
    infobox: {
      fields: [
        { label: "Born", type: "dateplace" },
        { label: "Reign", type: "datetext", options: { ranges: true, multiple: true } },
      ],
    },
  };
  await openProject(page, oneProject([pageD, { id: "Page B.md", title: "Page B" }], { mainPage: "Page D" }));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
  await page.getByLabel("Born: year").fill("283");
  await page.getByLabel("Born: era").fill("AC");
  await page.getByRole("textbox", { name: "Born: place" }).click();
  await page.keyboard.type("[[Page B]]");
  await page.getByLabel("Reign 1 from: year").fill("283");
  await page.getByLabel("Reign 1 to: year").fill("298");
  await page.getByRole("textbox", { name: "Reign 1: text" }).click();
  await page.keyboard.type("King");
  await formRow(page, "Reign").getByRole("button", { name: "+ Add entry" }).click();
  await page.getByLabel("Reign 2 from: year").fill("300");
  await page.getByRole("textbox", { name: "Reign 2: text" }).click();
  await page.keyboard.type("Lord");
  await expect
    .poll(() => fieldValue(page, "Page D.md", "Reign"))
    .toEqual([
      { date: { start: { year: 283 }, end: { year: 298 } }, text: "King" },
      { date: { start: { year: 300 } }, text: "Lord" },
    ]);
  expect(await fieldValue(page, "Page D.md", "Born")).toEqual({ date: { year: 283, era: "AC" }, text: "[[Page B]]" });
  const preview = page.locator(".split-preview .infobox");
  await expect(preview).toContainText(/283 AC\s*Page B/);
  await expect(preview.locator(".infobox-date-note")).toHaveText(["King", "Lord"]);
  await preview.screenshot({ path: "test-results/qol-date-text.png" });
  await formRow(page, "Reign").screenshot({ path: "test-results/qol-date-text-form.png" });
});

test("ages: the Age setting on date fields and the project's present day", async ({ page }) => {
  const person = {
    id: "template-a-ages",
    name: "Template A",
    fields: [
      { key: "f-b", label: "Born", type: "dateplace" as const, options: { age: "birth" } },
      { key: "f-d", label: "Died", type: "dateplace" as const },
    ],
  };
  const pageA: MockPage = {
    id: "Page A.md",
    title: "Page A",
    infobox: { template: person.id, fields: [{ ...person.fields[0], value: { date: { year: 283, era: "AC" }, text: "Place A" } }, { ...person.fields[1] }] },
  };
  await openProject(page, oneProject([pageA], { templates: [person], mainPage: "Page A" }));
  const box = page.locator(".read-view .infobox");
  await expect(box).toContainText("283 AC");
  await expect(box.locator(".infobox-age")).toHaveCount(0);

  await page.getByRole("button", { name: "Project settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Project settings" });
  await dialog.getByLabel("Present day: year").fill("300");
  await dialog.getByLabel("Present day: era").fill("AC");
  await dialog.screenshot({ path: "test-results/qol-present-day.png" });
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(box.locator(".infobox-age")).toHaveText("(age 17)");
  await box.screenshot({ path: "test-results/qol-age.png" });

  // The setting in the template.
  await page.getByRole("button", { name: "Templates" }).click();
  const died = page.locator(".field-defs > li").filter({ has: page.locator('input[aria-label="Field label"][value="Died"]') });
  await died.getByLabel("Age").selectOption("death");
  await expect
    .poll(() => page.evaluate(() => (window as any).__mock.projects.get("Project A").templates[0].fields[1].options))
    .toEqual({ age: "death" });
  expect(await page.evaluate(() => (window as any).__mock.projects.get("Project A").settings.presentDay)).toEqual({ year: 300, era: "AC" });
});
