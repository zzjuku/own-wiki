// M12: family trees — the settings, the Family tree screen (button and
// shortcut), generations, several partners with a dashed lover line, an
// unknown parent, stubs, placeholders, line styles, couple labels, spoilers.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject } from "./fixtures";
import { FAMILY, SETTINGS } from "./familyData";

const data = (extra = {}) => oneProject(FAMILY, { settings: SETTINGS, mainPage: "Person C", ...extra });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/family-${name}.png` });
const box = (page: Page, title: string) => page.locator(`.tree-box:not(.stub)[data-name="${title}"]`);

async function openTree(page: Page) {
  await page.getByRole("button", { name: "Family tree", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toBeVisible();
}

test("the Family tree screen opens from the sidebar and the shortcut, centred on the open page", async ({ page }) => {
  await openProject(page, data());
  await expect(page.locator(".page-head h1")).toHaveText("Person C");
  await openTree(page);
  await expect(page.getByLabel("Person in the middle")).toHaveValue("Person C");
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
  await expect(page.locator(".tree-box.centre")).toContainText("b. 290");
  // Up 2 / down 3: grandparents, parents, siblings, aunt, cousins, partners, children.
  for (const t of ["Person GA", "Person GB", "Person F", "Person M", "Person S", "Person H", "Person J", "Person W", "Person X", "Person K", "Person L"])
    await expect(box(page, t)).toHaveCount(1);
  await shot(page, "screen");

  // Away and back with the shortcut.
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Alt+KeyT");
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
});

test("generations up and down limit the tree, and a person can be chosen", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await page.getByLabel("Generations up").fill("0");
  await expect(box(page, "Person F")).toHaveCount(0);
  await expect(box(page, "Person X")).toHaveCount(1);
  await page.getByLabel("Generations down").fill("0");
  await expect(box(page, "Person X")).toHaveCount(0);
  await expect(box(page, "Person W")).toHaveCount(1);
  await page.getByLabel("Generations up").fill("2");
  await page.getByLabel("Generations down").fill("3");
  // Choose another person.
  await page.getByLabel("Person in the middle").click();
  await page.getByLabel("Person in the middle").fill("person h");
  await page.getByRole("option", { name: "Person H" }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person H");
  // Back returns to the person before.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
});

test("several partners, a dashed lover line, couple words, an unknown parent and line styles", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  // Person F: wife (with words) on one side, lover on the other; the lover's line is dashed.
  const f = await box(page, "Person F").boundingBox();
  const m = await box(page, "Person M").boundingBox();
  const l = await box(page, "Person L").boundingBox();
  expect(Math.sign(m!.x - f!.x)).not.toBe(Math.sign(l!.x - f!.x));
  await expect(page.locator(".tree-couple-label", { hasText: "(m. 283)" })).toHaveCount(1);
  await expect(page.locator(".tree-line.couple.dashed")).toHaveCount(1);
  // Person H: a child with Person U and one with no known second parent: a "?" partner
  // (on the other side from Person U).
  await page.getByLabel("Person in the middle").click();
  await page.getByLabel("Person in the middle").fill("Person H");
  await page.keyboard.press("Enter");
  await page.getByLabel("Generations up").fill("0");
  await expect(page.locator(".tree-box.unknown")).toHaveCount(1);
  const h = await box(page, "Person H").boundingBox();
  const u = await box(page, "Person U").boundingBox();
  const q = await page.locator(".tree-box.unknown").boundingBox();
  expect(Math.sign(u!.x - h!.x)).not.toBe(Math.sign(q!.x - h!.x));
  await shot(page, "unknown-parent");
});

test("someone belonging in two places has one box and a stub that leads to it", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  // Cousins Person S and Person J are married: one full box each, stubs elsewhere.
  await expect(box(page, "Person J")).toHaveCount(1);
  const stub = page.locator(".tree-box.stub").first();
  await expect(stub).toBeVisible();
  const target = await stub.getAttribute("data-target");
  await stub.hover();
  await expect(page.locator(`.tree-box[data-key="${target}"]`)).toHaveClass(/lit/);
  await stub.click();
  await expect(page.locator(`.tree-box[data-key="${target}"]`)).toHaveClass(/flash/);
});

test("a placeholder (no page yet) is a dashed box; clicking it creates the page", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  const ph = page.locator(".tree-box.placeholder");
  await expect(ph).toContainText("Person MZ");
  await ph.click();
  await expect(page.getByRole("dialog")).toContainText("Create page");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".tree-box.placeholder")).toHaveCount(0);
  await expect(box(page, "Person MZ")).toHaveCount(1);
  // Still on the tree.
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toBeVisible();
});

test("a person behind a spoiler relation is hidden until revealed", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await expect(box(page, "Person Q")).toHaveCount(0);
  const hidden = page.locator(".tree-box.hidden");
  await expect(hidden).toHaveCount(1);
  await hidden.click();
  await expect(box(page, "Person Q")).toHaveCount(1);
  // The eye switch shows them too.
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await page.getByRole("button", { name: "Show all spoilers" }).click();
  await page.keyboard.press("ControlOrMeta+Alt+KeyT");
  await expect(box(page, "Person Q")).toHaveCount(1);
});

test("Project settings → Family tree chooses the fields; nothing chosen opens the settings", async ({ page }) => {
  await openProject(page, data({ settings: { hideCategoryBox: false } }));
  await openTree(page);
  const dialog = page.getByRole("dialog", { name: "Project settings" });
  await expect(dialog).toBeVisible();
  await expect(page.getByText("No family fields are chosen yet.")).toBeVisible();
  await dialog.getByLabel("Add a parent field").selectOption("Father");
  await dialog.getByLabel("Add a parent field").selectOption("Mother");
  await dialog.getByLabel("Add a partner field").selectOption("Lover");
  await dialog.getByLabel("Partner fields: line for Lover").selectOption("dotted");
  await shot(page, "settings");
  await dialog.getByRole("button", { name: "Done" }).click();
  const stored = await page.evaluate(() => (window as any).__mock.projects.get("Project A").settings.familyTree);
  expect(stored).toEqual({ parents: [{ field: "Father", line: "solid" }, { field: "Mother", line: "solid" }], partners: [{ field: "Lover", line: "dotted" }] });
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
  await expect(page.locator(".tree-line.couple.dotted")).toHaveCount(1);
});

test("the tree in the built-in themes", async ({ page }) => {
  test.setTimeout(90_000);
  for (const id of ["default", "parchment", "awoiaf", "awoiaf-modern", "folio", "slate", "midnight"]) {
    await openProject(page, { ...data(), appTheme: `builtin:${id}` });
    await openTree(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await box(page, "Person F").hover();
    await page.waitForTimeout(300);
    await shot(page, `theme-${id}`);
  }
});
