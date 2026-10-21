// Smoke tests for features from M1–M6: one quick pass through each main flow.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, startApp, storedPage } from "./fixtures";
import { PAGES, TEMPLATE } from "./fixtures-data";

const data = () => oneProject(PAGES, { templates: [TEMPLATE], groups: ["Group A"], mainPage: "Page A" });

/** The page text of the read view. */
const text = (page: Page) => page.locator(".read-view .markdown");

async function newPage(page: Page, title: string, template?: string) {
  await page.getByRole("button", { name: "New page" }).click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel("Page title").fill(title);
  if (template) await dialog.getByLabel("Template").selectOption({ label: template });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

/** Types into the source editor at the end of the text. */
async function typeInEditor(page: Page, keys: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(keys);
}

test("opens a project on its main page", async ({ page }) => {
  await startApp(page, data());
  await page.getByText("Project A", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  const tree = page.getByRole("tree", { name: "Pages" });
  await expect(tree.getByRole("button", { name: "Group A", exact: true })).toBeVisible();
  await tree.getByRole("button", { name: "Group A", exact: true }).click();
  await expect(tree.getByRole("button", { name: "Page B", exact: true })).toBeVisible();
});

test("creates and edits a page", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await typeInEditor(page, "Example text for Page D.");
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toContain("Example text for Page D.");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(text(page)).toContainText("Example text for Page D.");
});

test("links: autocomplete, follow, red link", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await typeInEditor(page, "See [[Page C");
  await expect(page.getByRole("option", { name: /Page C/, selected: true })).toBeVisible();
  // CodeMirror ignores Enter for a moment after the list changes (its interactionDelay).
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("See [[Page C]]");
  await typeInEditor(page, " and [[Page E]].");
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("See [[Page C]] and [[Page E]].");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(text(page).getByRole("link", { name: "Page E" })).toHaveClass(/\bnew\b/);
  await text(page).getByRole("link", { name: "Page C" }).click();
  await expect(page.getByRole("heading", { name: "Page C", level: 1 })).toBeVisible();
});

test("infobox: page from a template, fill a field", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D", "Template A");
  await page.getByRole("tab", { name: "Infobox" }).click();
  const field = page.locator(".infobox-form .ib-row").filter({ hasText: "Example field" }).locator("[contenteditable], input").first();
  await field.click();
  await page.keyboard.type("Value D");
  await expect.poll(async () => JSON.stringify((await storedPage(page, "Page D.md"))?.infobox)).toContain("Value D");
  const stored = await storedPage(page, "Page D.md");
  expect(stored.categories).toEqual(["Category A"]);
  expect(stored.body).toBe("## Section A\n");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.locator(".infobox")).toContainText("Value D");
});

test("image in text: insert and show", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await page.evaluate(() => (window as any).__mock.setNextOpen(["/Pictures/Picture D.png"]));
  await page.getByRole("button", { name: /Insert image/ }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toContain("[[File:Picture D.png|right|medium");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(text(page).locator(".wiki-image img")).toBeVisible();
  await expect(text(page).locator(".wiki-image")).toHaveClass(/pos-right size-medium/);
});

test("categories: add from the read view, category page lists the page", async ({ page }) => {
  await openProject(page, data());
  const tree = page.getByRole("tree", { name: "Pages" });
  await tree.getByRole("button", { name: "Group A", exact: true }).click();
  await tree.getByRole("button", { name: "Page C", exact: true }).click();
  const box = page.locator(".catlinks");
  await box.getByRole("button", { name: "+ Add" }).click();
  await page.getByLabel("Add category").fill("Category C");
  await page.keyboard.press("Enter");
  await expect(box).toContainText("Category C");
  expect((await storedPage(page, "Group A/Page C.md")).categories).toEqual(["Category C"]);
  await page.getByRole("button", { name: /^Categories/ }).click();
  await page.getByText("Category C", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Category: Category C" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Page C" })).toBeVisible();
});
