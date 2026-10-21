// M10: easier field moving in the Infobox tab and the template editor —
// Move to section…, a section heading moving with its fields, and the list
// scrolling by itself while a field is dragged near its edge.
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Field, Template } from "../../src/api";
import { oneProject, openProject, storedPage } from "./fixtures";

const field = (label: string, type: Field["type"] = "text"): Field => ({ label, type });
// Top: Field 1, Field 2 | Section A: Field 3, Field 4 | Section B: Field 5
const SHORT = [field("Field 1"), field("Field 2"), field("Section A", "heading"), field("Field 3"), field("Field 4"), field("Section B", "heading"), field("Field 5")];
// Many fields, so the box is taller than the window.
const LONG = [...Array.from({ length: 40 }, (_, i) => field(`Long field ${i + 1}`)), field("Last section", "heading"), field("Last field")];

const TEMPLATE: Template = {
  id: "template-m-x1y2",
  name: "Template M",
  fields: SHORT.map((f, i) => ({ ...f, key: `f-${i}` })),
};

const data = () =>
  oneProject(
    [
      { id: "Page F.md", title: "Page F", body: "Text.", infobox: { fields: SHORT } },
      { id: "Page L.md", title: "Page L", body: "Text.", infobox: { fields: LONG } },
    ],
    { templates: [TEMPLATE], mainPage: "Page F" },
  );
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m10-${name}.png` });

/** The labels of the Infobox tab's rows, in order. */
const formLabels = (page: Page) => page.locator(".infobox-form .ib-row").evaluateAll((rows) => rows.map((r) => r.querySelector(".ib-label, .ib-heading")?.textContent ?? ""));
const formRow = (page: Page, label: string) => page.locator(".infobox-form .ib-row").filter({ has: page.locator(".ib-label, .ib-heading", { hasText: new RegExp(`^${label}$`) }) });

async function infoboxTab(page: Page, title: string) {
  await page.locator(".sidebar").getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("tab", { name: "Infobox" }).click();
}

async function moveToSection(page: Page, row: Locator, target: string) {
  await row.getByRole("button", { name: /^More for/ }).click();
  await page.getByRole("menuitem", { name: "Move to section…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("option", { name: target }).click();
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toBeHidden();
}

async function drag(page: Page, handle: Locator, to: { x: number; y: number }, wait = 0) {
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  if (wait) await page.waitForTimeout(wait);
  await page.mouse.up();
}

test("Move to section puts a field at the end of a section, and a heading takes its fields along", async ({ page }) => {
  await openProject(page, data());
  await infoboxTab(page, "Page F");
  await moveToSection(page, formRow(page, "Field 1"), "Section B");
  await expect.poll(() => formLabels(page)).toEqual(["Field 2", "Section A", "Field 3", "Field 4", "Section B", "Field 5", "Field 1"]);
  await moveToSection(page, formRow(page, "Field 5"), "Top (before the first section)");
  await expect.poll(() => formLabels(page)).toEqual(["Field 2", "Field 5", "Section A", "Field 3", "Field 4", "Section B", "Field 1"]);
  // A heading moves with its fields.
  await formRow(page, "Section B").getByRole("button", { name: /^More for/ }).click();
  await page.getByRole("menuitem", { name: "Move to section…" }).click();
  await expect(page.getByRole("dialog").getByRole("option", { name: "After “Section A” current" })).toBeDisabled();
  await shot(page, "move-to-section");
  await page.getByRole("dialog").getByRole("option", { name: "First section" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => formLabels(page)).toEqual(["Field 2", "Field 5", "Section B", "Field 1", "Section A", "Field 3", "Field 4"]);
  await expect
    .poll(async () => (await storedPage(page, "Page F.md")).infobox.fields.map((f: Field) => f.label))
    .toEqual(["Field 2", "Field 5", "Section B", "Field 1", "Section A", "Field 3", "Field 4"]);
});

test("dragging a section heading moves its fields; it lands only between sections", async ({ page }) => {
  await openProject(page, data());
  await infoboxTab(page, "Page F");
  // Drop "Section A" in the middle of Section B: it goes after Section B as a whole.
  const target = (await formRow(page, "Field 5").boundingBox())!;
  await drag(page, formRow(page, "Section A").locator(".drag-handle"), { x: target.x + 40, y: target.y + target.height - 2 });
  await expect.poll(() => formLabels(page)).toEqual(["Field 1", "Field 2", "Section B", "Field 5", "Section A", "Field 3", "Field 4"]);
  // A single field still moves on its own.
  const top = (await formRow(page, "Field 1").boundingBox())!;
  await drag(page, formRow(page, "Field 4").locator(".drag-handle"), { x: top.x + 40, y: top.y + 2 });
  await expect.poll(() => formLabels(page)).toEqual(["Field 4", "Field 1", "Field 2", "Section B", "Field 5", "Section A", "Field 3"]);
});

test("the list scrolls by itself while a field is dragged near its edge", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await openProject(page, data());
  await infoboxTab(page, "Page L");
  const scroller = page.locator(".infobox-form");
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
  const area = (await scroller.boundingBox())!;
  // Hold the first field near the bottom edge until the list has scrolled to its end.
  await drag(page, formRow(page, "Long field 1").locator(".drag-handle"), { x: area.x + 60, y: area.y + area.height - 8 }, 2500);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  await expect.poll(async () => (await formLabels(page)).at(-1)).toBe("Long field 1");

  // The template editor's list scrolls too, and has Move to section.
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByText("Template M", { exact: true }).first().click();
  const row = page.locator(".field-defs > li").filter({ has: page.locator('input[value="Field 1"]') });
  await moveToSection(page, row, "Section A");
  await expect
    .poll(() => page.locator(".field-defs > li input.field-label").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(["Field 2", "Section A", "Field 3", "Field 4", "Field 1", "Section B", "Field 5"]);
});
