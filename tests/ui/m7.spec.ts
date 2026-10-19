// M7: spoilers, quote boxes, separator line, infobox dividers, Contents panel.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, storedPage } from "./fixtures";
import { PAGES, TEMPLATE } from "./fixtures-data";

const SPOILER_PAGE = {
  id: "Page S.md",
  title: "Page S",
  body: [
    "Open text and ||hidden text with [[Page A]]|| after.",
    "",
    "## Section ||secret|| one",
    "",
    "[[File:Picture A.png|right|medium|spoiler|Hidden caption]]Text beside the picture.",
    "",
    "## Section two",
    "",
    "<quote>",
    "Quoted text with ||a spoiler||.",
    "<by>[[Page A]]</by>",
    "<source>Example source</source>",
    "</quote>",
    "",
    "## Section three",
    "",
    "Last text.",
  ].join("\n"),
  infobox: {
    fields: [
      { label: "Example field", type: "text" as const, value: "Shown value" },
      { label: "Divider label", type: "divider" as const },
      { label: "Hidden field", type: "text" as const, value: "Hidden value", spoiler: true },
    ],
  },
};

const data = () => oneProject([...PAGES, SPOILER_PAGE], { templates: [TEMPLATE], groups: ["Group A"], mainPage: "Page S" });
const text = (page: Page) => page.locator(".read-view .markdown");
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m7-${name}.png` });

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New page" }).click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel("Page title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

/** Is the spoiler's text hidden (transparent)? */
const hidden = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => getComputedStyle(el).color === "rgba(0, 0, 0, 0)");

test("spoilers stay hidden until clicked; a click doesn't follow a link", async ({ page }) => {
  await openProject(page, data());
  await expect(page.getByRole("heading", { name: "Page S", level: 1 })).toBeVisible();
  const spoiler = text(page).locator("p .spoiler").first();
  expect(await hidden(spoiler)).toBe(true);
  await expect(text(page).locator(".infobox-value .spoiler")).toHaveText("Hidden value");
  expect(await hidden(text(page).locator(".infobox-value .spoiler"))).toBe(true);
  await expect(text(page).locator(".wiki-image.spoiler-media")).toBeVisible();
  await expect(page.locator(".toc-left .spoiler")).toHaveCount(1);
  await shot(page, "spoilers-hidden");

  // Clicking the link inside reveals the spoiler and stays on the page.
  await spoiler.getByRole("link", { name: "Page A" }).click({ force: true });
  await expect(spoiler).toHaveClass(/revealed/);
  await expect(page.getByRole("heading", { name: "Page S", level: 1 })).toBeVisible();
  expect(await hidden(spoiler)).toBe(false);
  // Now the link works.
  await spoiler.getByRole("link", { name: "Page A" }).click();
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  // Back on the page, the spoiler is hidden again.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(text(page).locator("p .spoiler").first()).not.toHaveClass(/revealed/);
});

test("a heading spoiler reveals together with its Contents entry", async ({ page }) => {
  await openProject(page, data());
  await page.locator(".toc-left .spoiler").click();
  await expect(page.locator(".toc-left .spoiler")).toHaveClass(/revealed/);
  await expect(text(page).locator("h2 .spoiler")).toHaveClass(/revealed/);
  await expect(page.getByRole("heading", { name: "Page S", level: 1 })).toBeVisible();
});

test("Reveal spoilers on the page and the global switch", async ({ page }) => {
  await openProject(page, data());
  // One revealed by clicking: Hide spoilers hides it again too.
  const field = text(page).locator(".infobox-value .spoiler");
  await field.click();
  expect(await hidden(field)).toBe(false);
  await page.getByRole("button", { name: "Reveal spoilers" }).click();
  expect(await hidden(text(page).locator("p .spoiler").first())).toBe(false);
  await page.getByRole("button", { name: "Hide spoilers" }).click();
  expect(await hidden(text(page).locator("p .spoiler").first())).toBe(true);
  expect(await hidden(field)).toBe(true);
  await expect(text(page).locator(".spoiler.revealed")).toHaveCount(0);

  await page.getByRole("button", { name: "Show all spoilers" }).click();
  await expect(page.getByRole("button", { name: /Spoilers shown everywhere/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal spoilers" })).toBeHidden();
  expect(await hidden(text(page).locator("p .spoiler").first())).toBe(false);
  await shot(page, "spoilers-global");
  // Remembered on this computer.
  await page.reload();
  await page.getByText("Project A", { exact: true }).click();
  await expect(page.getByRole("button", { name: /Spoilers shown everywhere/ })).toBeVisible();
  await page.getByRole("button", { name: /Spoilers shown everywhere/ }).click();
  expect(await hidden(text(page).locator("p .spoiler").first())).toBe(true);
});

test("Spoiler button in the editor and the infobox field toggle", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await page.keyboard.type("Some secret words");
  await page.keyboard.press("Shift+Alt+ArrowLeft");
  await page.getByRole("button", { name: /^Spoiler/ }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("Some secret ||words||");
  // The preview shows it revealed but marked.
  const preview = page.locator(".split-preview .spoiler");
  await expect(preview).toHaveText("words");
  expect(await hidden(preview)).toBe(false);
  await shot(page, "editor");
  await page.keyboard.press("Meta+Shift+s");
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("Some secret words");

  // Infobox: an empty infobox, a field, the Spoiler toggle.
  await page.getByRole("tab", { name: "Infobox" }).click();
  await page.getByRole("button", { name: "Add infobox ▾" }).click();
  await page.getByRole("menuitem", { name: "Empty infobox" }).click();
  await page.getByRole("button", { name: "+ Add field" }).click();
  await page.locator(".ib-row").first().locator(".ib-input [contenteditable]").click();
  await page.keyboard.type("Field value");
  await page.getByRole("button", { name: "Spoiler: New field" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.infobox?.fields?.[0]?.spoiler).toBe(true);
  await page.getByRole("button", { name: "+ Add divider" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.infobox?.fields?.[1]?.type).toBe("divider");
  await shot(page, "infobox-tab");
  await page.getByRole("button", { name: "View", exact: true }).click();
  expect(await hidden(text(page).locator(".infobox-value .spoiler"))).toBe(true);
});

test("quote box: insert with the dialog, edit by clicking it", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await page.getByRole("button", { name: /Quote box/ }).click();
  const dialog = page.getByRole("dialog", { name: "New quote box" });
  await dialog.getByLabel("Quote").click();
  await page.keyboard.type("Quoted words.");
  await dialog.getByLabel("By").click();
  await page.keyboard.type("Someone");
  await dialog.getByLabel("Source").click();
  await page.keyboard.type("Example source");
  await shot(page, "quote-dialog");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe(
    "<quote>\nQuoted words.\n<by>Someone</by>\n<source>Example source</source>\n</quote>\n\n",
  );
  await expect(page.locator(".split-preview .quote-box .quote-by")).toHaveText("— Someone, Example source");

  // Clicking the quote box in the source reopens the dialog.
  await page.locator(".cm-line", { hasText: "Quoted words." }).click();
  const edit = page.getByRole("dialog", { name: "Edit quote box" });
  await edit.getByLabel("By").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("Someone else");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toContain("<by>Someone else</by>");
});

test("separator line and the read view of quote, divider and spoiler image", async ({ page }) => {
  await openProject(page, data());
  await expect(text(page).locator(".quote-box")).toContainText("Quoted text with");
  await expect(text(page).locator(".quote-box .quote-by")).toHaveText("— Page A, Example source");
  await expect(text(page).locator(".infobox-divider")).toHaveText("Divider label");
  const img = text(page).locator(".wiki-image.spoiler-media");
  await img.click();
  await expect(img).toHaveClass(/revealed/);
  await expect(page.locator(".image-viewer")).toHaveCount(0);
  await shot(page, "quote-divider");

  await newPage(page, "Page D");
  await page.keyboard.type("Line above");
  await page.getByRole("button", { name: "Separator line" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toBe("Line above\n\n---\n\n");
  await expect(page.locator(".split-preview hr")).toHaveCount(1);
  await expect(page.locator(".split-preview h2")).toHaveCount(0);
});

test("spoiler option for images and galleries", async ({ page }) => {
  await openProject(page, data());
  await newPage(page, "Page D");
  await page.evaluate(() => (window as any).__mock.setNextOpen(["/Pictures/Picture D.png"]));
  await page.getByRole("button", { name: /Insert image/ }).click();
  await page.getByRole("dialog", { name: "Edit image" }).getByLabel("Spoiler: blurred until clicked").check();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toContain("[[File:Picture D.png|right|medium|spoiler]]");
  await page.getByRole("dialog", { name: "Edit image" }).getByRole("button", { name: "Done" }).click();

  await page.evaluate(() => (window as any).__mock.setNextOpen(["/Pictures/Picture E.png"]));
  await page.getByRole("button", { name: "Insert gallery" }).click();
  const g = page.getByRole("dialog", { name: "New gallery" });
  await g.getByRole("button", { name: "Add images…" }).click();
  await g.getByLabel("Spoiler: blurred until clicked").check();
  await g.getByRole("button", { name: "Insert" }).click();
  await expect.poll(async () => (await storedPage(page, "Page D.md"))?.body).toContain("<gallery spoiler>\nPicture E.png\n</gallery>");
});
