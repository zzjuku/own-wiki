// M10 sync safety: live reload of the open page and the sidebar, the edit
// clash bar (each choice), a page deleted or moved on disk, the Conflicts
// screen (each choice), and the open-on-another-computer warning. Changes
// "from the other computer" come from the in-memory backend, reported as the
// file watcher would (window.__outside).
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, PROJECT, startApp, storedPage } from "./fixtures";
import type { Fixture, MockConflict } from "./mock/backend";

const PAGES = [
  { id: "Page A.md", title: "Page A", body: "Text of Page A." },
  { id: "Page B.md", title: "Page B", body: "Text of Page B." },
];
const data = (extra: Partial<NonNullable<Fixture["projects"]>[number]> = {}) => oneProject(PAGES, { mainPage: "Page A", ...extra });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m10-${name}.png` });
const text = (page: Page) => page.locator(".read-view .markdown");
const outside = (page: Page, id: string, change: Record<string, unknown> | null, moveTo?: string) =>
  page.evaluate(([p, i, c, m]) => window.__outside(p as string, i as string, c as Record<string, unknown> | null, m as string | undefined), [PROJECT, id, change, moveTo] as const);
const trashed = (page: Page) => page.evaluate(() => window.__mock.trashed);
const bar = (page: Page) => page.locator(".sync-bar");

async function typeInEditor(page: Page, words: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(words);
}

test("the open page and the sidebar reload after a change from outside", async ({ page }) => {
  await openProject(page, data());
  await expect(text(page)).toContainText("Text of Page A.");
  await outside(page, "Page A.md", { body: "Changed on the other computer." });
  await expect(text(page)).toContainText("Changed on the other computer.");
  await expect(bar(page)).toContainText("This page was changed on another computer. It shows the new version now.");
  await outside(page, "Page N.md", { title: "Page N", body: "New." });
  await expect(page.locator(".sidebar").getByText("Page N", { exact: true })).toBeVisible();
  // While editing without unsaved changes, the editor shows the new text too.
  await page.getByRole("button", { name: "Edit" }).click();
  await outside(page, "Page A.md", { body: "Second change." });
  await expect(page.locator(".cm-content")).toContainText("Second change.");
});

test("edit clash: Show differences, Keep mine, Use the other version", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Edit" }).click();
  await typeInEditor(page, " Mine one.");
  await outside(page, "Page A.md", { body: "Theirs one." });
  await expect(bar(page)).toContainText("This page was changed on another computer");
  await shot(page, "clash-bar");
  // Autosave waits: nothing of mine was written.
  await page.waitForTimeout(900);
  expect((await storedPage(page, "Page A.md")).body).toBe("Theirs one.");

  await bar(page).getByRole("button", { name: "Show differences" }).click();
  const diff = page.getByRole("dialog", { name: "Differences" });
  await expect(diff.locator("tr.changed")).toContainText(["Text of Page A. Mine one.Theirs one."]);
  await shot(page, "clash-differences");
  await diff.getByRole("button", { name: "Close" }).click();

  await bar(page).getByRole("button", { name: "Keep mine" }).click();
  await expect(bar(page)).toContainText("Your version was kept");
  expect((await storedPage(page, "Page A.md")).body).toBe("Text of Page A. Mine one.");
  expect(await trashed(page)).toContain("theirs:Page A.md:Theirs one.");
  // Saving goes on as usual afterwards.
  await typeInEditor(page, " More.");
  await expect.poll(async () => (await storedPage(page, "Page A.md")).body).toBe("Text of Page A. Mine one. More.");

  // Again, now choosing the other version: mine goes to the Trash.
  await typeInEditor(page, " Mine two.");
  await outside(page, "Page A.md", { body: "Theirs two." });
  await bar(page).getByRole("button", { name: "Use the other version" }).click();
  await expect(page.locator(".cm-content")).toHaveText("Theirs two.");
  expect(await trashed(page)).toContain("mine:Page A.md:Text of Page A. Mine one. More. Mine two.");
  expect((await storedPage(page, "Page A.md")).body).toBe("Theirs two.");
});

test("a save is refused when the file changed since it was opened", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Edit" }).click();
  // Changed on disk without the watcher noticing (e.g. while the computer slept).
  await page.evaluate(([p]) => void window.__mock.outside(p, "Page A.md", { body: "Theirs." }), [PROJECT]);
  await typeInEditor(page, " Mine.");
  await expect(bar(page)).toContainText("This page was changed on another computer");
  expect((await storedPage(page, "Page A.md")).body).toBe("Theirs.");
});

test("a page deleted on disk: Keep it saves it again, Close leaves it", async ({ page }) => {
  await openProject(page, data());
  await outside(page, "Page A.md", null);
  await expect(bar(page)).toContainText("This page was deleted on another computer");
  await expect(text(page)).toContainText("Text of Page A.");
  await bar(page).getByRole("button", { name: "Keep it" }).click();
  await expect(bar(page)).toBeHidden();
  expect((await storedPage(page, "Page A.md")).body).toBe("Text of Page A.");
  await expect(page.locator(".sidebar").getByText("Page A", { exact: true })).toBeVisible();

  await outside(page, "Page A.md", null);
  await bar(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Select a page on the left.")).toBeVisible();
});

test("a page moved on disk stays open at its new place", async ({ page }) => {
  await openProject(page, data({ groups: ["Group A"] }));
  await outside(page, "Page A.md", {}, "Group A/Page A.md");
  await expect(page.locator(".breadcrumb")).toContainText("Group A");
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  await expect(bar(page)).toBeHidden();
});

const CONFLICTS: MockConflict[] = [
  {
    conflict: { kind: "page", title: "Page B", original: `${PROJECT}/pages/Page B.md`, copy: `${PROJECT}/pages/Page B [Conflict].md` },
    original: { text: "Line one.\nLine two.\n", infobox: { fields: [{ label: "Example field", type: "text", value: "Value A" }] }, modified: Date.UTC(2026, 9, 21, 10) },
    copy: { text: "Line one.\nLine 2 changed.\n", infobox: { fields: [{ label: "Example field", type: "text", value: "Value B" }] }, modified: Date.UTC(2026, 9, 21, 11) },
  },
  {
    conflict: { kind: "project", title: "project.json", original: `${PROJECT}/project.json`, copy: `${PROJECT}/project (1).json` },
    original: { text: '{\n  "name": "Project A"\n}', infobox: null, modified: Date.UTC(2026, 9, 21, 9) },
    copy: { text: '{\n  "name": "Project A",\n  "mainPage": "Page B"\n}', infobox: null, modified: Date.UTC(2026, 9, 21, 12) },
  },
  {
    conflict: { kind: "category", title: "Category A", original: `${PROJECT}/categories/Category A.md`, copy: `${PROJECT}/categories/Category A (1).md` },
    original: { text: "Category text.", infobox: null, modified: Date.UTC(2026, 9, 21, 9) },
    copy: { text: "Other category text.", infobox: null, modified: Date.UTC(2026, 9, 21, 12) },
  },
];

test("Conflicts screen: differences side by side, keep the original, the copy, or both", async ({ page }) => {
  await openProject(page, data({ conflicts: CONFLICTS }));
  const button = page.getByRole("button", { name: /Conflicts/ });
  await expect(button).toContainText("3");
  await button.click();
  await expect(page.getByRole("heading", { name: "Conflicts", level: 1 })).toBeVisible();
  const pageConflict = page.getByRole("region", { name: "Page Page B" });
  await expect(pageConflict.locator(".diff-fields tr.changed")).toContainText(["Example fieldValue AValue B"]);
  await expect(pageConflict.locator(".diff-text tr.changed")).toContainText(["Line two.Line 2 changed."]);
  // project.json can't keep both.
  await expect(page.getByRole("region", { name: /project\.json/ }).getByRole("button", { name: "Keep both" })).toHaveCount(0);
  await shot(page, "conflicts");

  await pageConflict.getByRole("button", { name: "Keep the copy" }).click();
  await expect(pageConflict).toHaveCount(0);
  await page.getByRole("region", { name: /project\.json/ }).getByRole("button", { name: "Keep the original" }).click();
  await page.getByRole("region", { name: "Category Category A" }).getByRole("button", { name: "Keep both" }).click();
  await expect(page.getByText("No conflicts. Everything is in one version.")).toBeVisible();
  expect(await trashed(page)).toEqual([
    `original:${PROJECT}/pages/Page B.md`,
    `copy:${PROJECT}/project (1).json`,
    `kept both:${PROJECT}/categories/Category A (1).md`,
  ]);
  await expect(button).toHaveCount(0);
});

test("opening a project open on another computer warns first", async ({ page }) => {
  const now = Date.now();
  await startApp(page, data({ openElsewhere: [{ computer: "Computer B", since: now - 30 * 60_000, refreshed: now }] }));
  await page.getByText(PROJECT, { exact: true }).click();
  const warning = page.getByRole("dialog", { name: "Open on another computer" });
  await expect(warning).toContainText("is open on Computer B since");
  await shot(page, "open-elsewhere");
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByText(PROJECT, { exact: true }).click();
  await page.getByRole("dialog", { name: "Open on another computer" }).getByRole("button", { name: "Open anyway" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  // This computer's own marker is set while the project is open, removed on leaving.
  expect(await page.evaluate(() => window.__mock.marks)).toContain(`open:${PROJECT}`);
  await page.getByRole("button", { name: "← Projects" }).click();
  await expect.poll(() => page.evaluate(() => window.__mock.marks)).toContain(`closed:${PROJECT}`);
});
