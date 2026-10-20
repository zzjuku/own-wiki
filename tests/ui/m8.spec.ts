// M8: themes (built-in, app and project themes, editor, fonts) and app-styled tooltips.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, PROJECT, startApp } from "./fixtures";
import { PAGES } from "./fixtures-data";

const rootVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const appTheme = (page: Page) => page.evaluate(() => (window as any).__mock.appTheme);
const storedAppTheme = (page: Page, id: string) =>
  page.evaluate((i) => JSON.parse(JSON.stringify((window as any).__mock.appThemes.get(i) ?? null)), id);
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m8-${name}.png` });

async function openThemes(page: Page) {
  await page.getByRole("button", { name: "Themes" }).click();
  await expect(page.getByRole("heading", { name: "Themes", level: 1 })).toBeVisible();
}
const themeItem = (page: Page, name: string | RegExp) => page.getByRole("navigation", { name: "Themes" }).getByRole("button", { name });

test("tooltips: app-styled, fade in on hover, system title put back after", async ({ page }) => {
  await openProject(page, oneProject(PAGES, { mainPage: "Page A" }));
  const button = page.getByRole("button", { name: "Project settings" });
  await expect(button).toHaveAttribute("title", "Project settings");
  await button.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText("Project settings");
  await expect(tip).toHaveClass(/visible/);
  // No system tooltip while the app's shows.
  await expect(button).not.toHaveAttribute("title", /.*/);
  await shot(page, "tooltip");
  // Shortcuts stay in the text.
  await page.getByRole("button", { name: "Back" }).hover();
  await expect(tip).toHaveText(/Back \(/);
  await page.mouse.move(700, 600);
  await expect(tip).not.toHaveClass(/visible/);
  await expect(button).toHaveAttribute("title", "Project settings");
  // Page links keep their hover cards instead.
  await page.locator(".read-view a.wikilink").first().hover();
  await expect(page.locator(".app-tooltip.visible")).toHaveCount(0);
});

test("built-in themes: read-only, used as app theme", async ({ page }) => {
  await startApp(page, oneProject(PAGES));
  await openThemes(page);
  for (const name of ["Default", "Parchment", "AWOIAF"]) await expect(themeItem(page, name)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Default", level: 2 })).toBeVisible();
  await shot(page, "themes-default");

  await themeItem(page, "Parchment").click();
  await expect(page.getByRole("heading", { name: "Parchment", level: 2 })).toBeVisible();
  await expect(page.locator(".theme-settings input").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Rename…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  // The sample shows the theme before it's used.
  await expect(page.locator(".theme-sample .sample-page")).toHaveCSS("background-color", "rgb(247, 240, 222)");
  expect(await rootVar(page, "--bg")).toBe("#ffffff");
  await page.getByRole("button", { name: "Use as app theme" }).click();
  await expect.poll(() => rootVar(page, "--bg")).toBe("#f4ecd8");
  expect(await appTheme(page)).toBe("builtin:parchment");
  await shot(page, "themes-parchment");

  await themeItem(page, "AWOIAF").click();
  await page.getByRole("button", { name: "Use as app theme" }).click();
  await expect.poll(() => rootVar(page, "--link")).toBe("#1088b7");
  await shot(page, "themes-awoiaf");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.locator(".library")).toHaveCSS("color", "rgb(28, 28, 27)");
});

test("new theme: edit a colour, the app follows live, saved", async ({ page }) => {
  await startApp(page, oneProject(PAGES));
  await openThemes(page);
  await page.getByRole("button", { name: "New theme" }).click();
  const dialog = page.getByRole("dialog", { name: "New theme" });
  await dialog.getByLabel("Theme name").fill("Theme A");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Theme A", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Use as app theme" }).click();
  await expect.poll(() => appTheme(page)).toBe("app:Theme A");

  const bg = page.locator('.theme-row[data-var="--bg"]').getByRole("textbox", { name: "Background", exact: true });
  await bg.fill("#202020");
  await bg.press("Enter");
  await expect.poll(() => rootVar(page, "--bg")).toBe("#202020");
  // Colours that follow the background change with it.
  expect(await rootVar(page, "--bg-hover")).not.toBe("");
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.vars?.["--bg"]).toBe("#202020");
  // Reset: back to following the default.
  await page.getByRole("button", { name: "Reset Background" }).click();
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.vars?.["--bg"]).toBeUndefined();

  // Sizes and embed box frame.
  const width = page.getByRole("slider", { name: "Frame width" });
  await width.fill("3");
  await expect(page.locator(".theme-sample details.embed-box")).toHaveCSS("border-top-width", "3px");

  // Rename and delete.
  await page.getByRole("button", { name: "Rename…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename theme" });
  await rename.getByLabel("Theme name").fill("Theme B");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { name: "Theme B", level: 2 })).toBeVisible();
  await expect.poll(() => appTheme(page)).toBe("app:Theme B");
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete theme" }).getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("heading", { name: "Default", level: 2 })).toBeVisible();
  await expect.poll(() => appTheme(page)).toBe(null);
});

test("a project's own theme wins over the app theme while it's open", async ({ page }) => {
  const data = oneProject(PAGES, {
    mainPage: "Page A",
    settings: { hideCategoryBox: false, theme: "project:Theme P" },
    themes: { "Theme P": { name: "Theme P", vars: { "--page-bg": "#fdf6e3" } } },
  });
  await openProject(page, { ...data, appTheme: "builtin:parchment" });
  await expect.poll(() => rootVar(page, "--page-bg")).toBe("#fdf6e3");
  expect(await rootVar(page, "--bg")).toBe("#ffffff");

  // The Themes screen in the project lists its own themes; switch to the app theme here.
  await openThemes(page);
  await expect(themeItem(page, /Theme P/)).toBeVisible();
  await expect(page.getByText("This project uses its own theme.")).toBeVisible();
  await themeItem(page, /Theme P/).click();
  await page.getByRole("button", { name: "Use the app theme here" }).click();
  await expect.poll(() => rootVar(page, "--bg")).toBe("#f4ecd8");
  await page.getByRole("button", { name: "Use for this project" }).click();
  await expect.poll(() => rootVar(page, "--bg")).toBe("#ffffff");

  // Project settings show the choice too.
  await page.getByRole("button", { name: "Project settings" }).click();
  const select = page.getByRole("dialog", { name: "Project settings" }).getByLabel("Project theme");
  await expect(select).toHaveValue("project:Theme P");
  await select.selectOption({ label: "App theme" });
  await expect.poll(() => rootVar(page, "--bg")).toBe("#f4ecd8");
  await page.getByRole("button", { name: "Done" }).click();

  // Back in the library: the app theme.
  await page.getByRole("button", { name: "← Projects" }).click();
  await expect.poll(() => rootVar(page, "--bg")).toBe("#f4ecd8");
  await expect(page.getByText(PROJECT, { exact: true })).toBeVisible();
});

test("fonts: copy an installed font or import a file into a theme", async ({ page }) => {
  await startApp(page, { ...oneProject(PAGES), themes: { "Theme A": { name: "Theme A", vars: {} } } });
  await openThemes(page);
  await themeItem(page, /Theme A/).click();
  await page.getByRole("combobox", { name: "Page font" }).selectOption("installed");
  const dialog = page.getByRole("dialog", { name: "Installed fonts" });
  await dialog.getByLabel("Filter fonts").fill("b");
  await expect(dialog.getByRole("button")).toHaveText(["Font B", "Cancel"]);
  await dialog.getByRole("button", { name: "Font B" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.vars?.["--font-body"]).toMatch(/^"Font B", /);
  const saved = await storedAppTheme(page, "Theme A");
  expect(saved.fonts.map((f: { file: string }) => f.file)).toEqual(["Font B Regular.ttf", "Font B Bold.ttf"]);

  await page.evaluate(() => (window as any).__mock.setNextOpen("/Fonts/Font C-Regular.otf"));
  await page.getByRole("combobox", { name: "Headings font" }).selectOption("import");
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.vars?.["--font-heading"]).toMatch(/^"Font C", /);
  // Going back to a standard font drops the copied files from the theme.
  await page.getByRole("combobox", { name: "Page font" }).selectOption({ label: "Verdana" });
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.fonts?.map((f: { family: string }) => f.family)).toEqual(["Font C"]);
});

test("copy a built-in theme into the project", async ({ page }) => {
  await openProject(page, oneProject(PAGES, { mainPage: "Page A" }));
  await openThemes(page);
  await themeItem(page, "AWOIAF").click();
  await page.getByRole("button", { name: "Copy…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy theme" });
  await expect(dialog.getByLabel("Theme name")).toHaveValue("AWOIAF copy");
  await dialog.getByLabel("Store in").selectOption("project");
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("heading", { name: "AWOIAF copy", level: 2 })).toBeVisible();
  await expect(page.getByText("Stored in this project")).toBeVisible();
  const stored = await page.evaluate((p) => JSON.parse(JSON.stringify((window as any).__mock.projects.get(p).themes.get("AWOIAF copy"))), PROJECT);
  expect(stored.vars["--link"]).toBe("#1088b7");
  expect(stored.fonts.map((f: { file: string }) => f.file)).toEqual(["Marcellus-Regular.ttf", "UncialAntiqua-Regular.ttf"]);
  await page.getByRole("button", { name: "Use for this project" }).click();
  await expect.poll(() => rootVar(page, "--link")).toBe("#1088b7");
  await shot(page, "themes-project");
});

test("AWOIAF look: centred title, its own fonts, ornate Contents, framed quotes", async ({ page }) => {
  await openProject(page, { ...oneProject(PAGES, { mainPage: "Page A" }), appTheme: "builtin:awoiaf" });
  const title = page.locator(".page > .page-head h1");
  await expect(title).toHaveCSS("text-align", "center");
  // The title has its own row under the buttons.
  const titleBox = (await title.boundingBox())!;
  const editBox = (await page.getByRole("button", { name: "Edit", exact: true }).boundingBox())!;
  expect(titleBox.y).toBeGreaterThan(editBox.y + editBox.height - 2);
  // The bundled fonts load.
  await expect.poll(() => page.evaluate(() => document.fonts.check("16px " + getComputedStyle(document.querySelector(".page-head h1")!).fontFamily.split(",")[0]))).toBe(true);
  await expect(title).toHaveCSS("font-family", /^"?ThemeFont/);
  await expect(page.locator(".markdown h2").first()).toHaveCSS("font-family", /^"?ThemeFont/);
  // Accent bar under headings, ornaments on the Contents panel, shadow on the infobox.
  const accent = await page.locator(".markdown h2").first().evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
  expect(accent).toBe("rgb(143, 92, 20)");
  expect(await page.locator(".toc-left").evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).toContain("gradient");
  await expect(page.locator(".markdown .infobox").first()).not.toHaveCSS("box-shadow", "none");
  await page.waitForTimeout(300);
  await shot(page, "awoiaf-page");
});

test("Default look stays as it was: no ornaments, title at the left", async ({ page }) => {
  await openProject(page, oneProject(PAGES, { mainPage: "Page A" }));
  await expect(page.locator(".page > .page-head h1")).not.toHaveCSS("text-align", "center");
  expect(await page.locator(".toc-left").evaluate((el) => getComputedStyle(el, "::before").content)).toBe("none");
  expect(await page.locator(".markdown h2").first().evaluate((el) => getComputedStyle(el, "::after").content)).toBe("none");
});

test("every part of the page can have its own font", async ({ page }) => {
  await startApp(page, { ...oneProject(PAGES), themes: { "Theme A": { name: "Theme A", vars: {} } } });
  await openThemes(page);
  await themeItem(page, /Theme A/).click();
  const infoboxTitle = page.getByRole("combobox", { name: "Infobox title", exact: true });
  await expect(infoboxTitle).toHaveValue("follow");
  await infoboxTitle.selectOption({ label: "Courier New" });
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.vars?.["--font-infobox-title"]).toMatch(/Courier New/);
  await expect(page.locator(".theme-sample .infobox th.infobox-title")).toHaveCSS("font-family", /Courier New/);
  // Look settings change the sample.
  await page.getByRole("combobox", { name: "Page title", exact: true }).selectOption("center");
  await expect(page.locator(".theme-sample .page-head h1")).toHaveCSS("text-align", "center");
  await page.getByRole("combobox", { name: "Contents frame" }).selectOption("ornate");
  expect(await page.locator(".theme-sample .toc").evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).toContain("gradient");
  await infoboxTitle.selectOption("follow");
  await expect.poll(async () => (await storedAppTheme(page, "Theme A"))?.vars?.["--font-infobox-title"]).toBeUndefined();
});
