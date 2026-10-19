// M7: embeds.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, storedPage } from "./fixtures";
import { PAGES, TEMPLATE } from "./fixtures-data";

const HOST = {
  id: "Host.md",
  title: "Host page",
  body: "Host text.\n\n{{Page A}}\n\nMiddle text.\n\n{{Page C|infobox}}\n\n{{Missing embed}}\n\nEnd of host.",
};
const data = () => oneProject([...PAGES, HOST], { templates: [TEMPLATE], groups: ["Group A"], mainPage: "Host page" });
const text = (page: Page) => page.locator(".read-view .markdown");
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m7-${name}.png` });

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New page" }).click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel("Page title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

test("embeds show the page's content, seamless, with an open link", async ({ page }) => {
  await openProject(page, data());
  const embed = text(page).locator(".embed").first();
  await expect(embed.locator(".infobox")).toContainText("Example value");
  await expect(embed).toContainText("Links to Page B");
  // Embedded headings stay out of the host's Contents.
  await expect(page.locator(".toc-left")).toHaveCount(0);
  await expect(text(page).locator("a.embed-missing")).toContainText("Missing embed doesn't exist yet");
  await embed.hover();
  await expect(embed.locator(".embed-open")).toBeVisible();
  await shot(page, "embeds");
  // A link inside the embed works.
  await embed.getByRole("link", { name: "Page B" }).first().click();
  await expect(page.getByRole("heading", { name: "Page B", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await text(page).locator(".embed").first().hover();
  await text(page).locator(".embed-open").first().click();
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
});

test("What links here lists embeds apart; embedding isn't a link", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("tree", { name: "Pages" }).getByRole("button", { name: "Page A", exact: true }).click();
  await page.getByRole("button", { name: /Links here/ }).click();
  const dialog = page.getByRole("dialog", { name: "What links here" });
  await expect(dialog.getByRole("heading", { name: "Embedded in (1)" })).toBeVisible();
  await dialog.getByRole("button", { name: /Host page/ }).last().click();
  await expect(page.getByRole("heading", { name: "Host page", level: 1 })).toBeVisible();
});

test("Embed button, popup: change and remove; renaming updates embeds", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await page.getByRole("button", { name: /^Embed a page/ }).click();
  const dialog = page.getByRole("dialog", { name: "Embed a page" });
  await dialog.getByLabel("Page to embed").fill("Page A");
  await page.keyboard.press("Tab");
  await dialog.getByLabel("One section").check();
  await dialog.getByLabel("Section", { exact: true }).selectOption({ label: "Section two" });
  await shot(page, "embed-dialog");
  await dialog.getByRole("button", { name: "Embed" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("{{Page A#Section two}}\n\n");
  await expect(page.locator(".split-preview .embed")).toContainText("Cell 2");
  await expect(page.locator(".split-preview .embed")).not.toContainText("Links to Page B");

  await page.locator(".cm-line", { hasText: "{{Page A#Section two}}" }).click();
  const popup = page.getByRole("dialog", { name: "Embed" });
  await popup.getByRole("button", { name: "Change…" }).click();
  const change = page.getByRole("dialog", { name: "Change embed" });
  await change.getByLabel("Infobox only").check();
  await change.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("{{Page A|infobox}}\n\n");
  await expect(page.locator(".split-preview .embed .infobox")).toBeVisible();

  // Renaming Page A rewrites the embed.
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("tree", { name: "Pages" }).getByRole("button", { name: "Page A", exact: true }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: /Rename/ });
  await rename.getByRole("textbox").first().fill("Page A2");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("{{Page A2|infobox}}\n\n");

  await page.getByRole("tree", { name: "Pages" }).getByRole("button", { name: "Page D", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-line", { hasText: "{{Page A2|infobox}}" }).click();
  await page.getByRole("dialog", { name: "Embed" }).getByRole("button", { name: "Remove" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("\n");
});

test("a page with 50 embeds opens quickly", async ({ page }) => {
  const sources = Array.from({ length: 50 }, (_, i) => ({
    id: `Source ${i}.md`,
    title: `Source ${i}`,
    body: `Opening text ${i} with [[Page A]].\n\n## Part\n\n${"Some words here. ".repeat(40)}\n\n- one\n- two`,
  }));
  const host = { id: "Many.md", title: "Many", body: sources.map((s) => `{{${s.title}}}`).join("\n\n") };
  await openProject(page, oneProject([...PAGES, ...sources, host], { mainPage: "Page A" }));
  const start = await page.evaluate(() => performance.now());
  await page.getByRole("tree", { name: "Pages" }).getByRole("button", { name: "Many", exact: true }).click();
  await expect(text(page).locator(".embed")).toHaveCount(50);
  const ms = (await page.evaluate(() => performance.now())) - start;
  console.log(`50 embeds shown in ${Math.round(ms)} ms`);
  expect(ms).toBeLessThan(1000);
});
