// Theme looks (2026-10-21): new frame, heading, title and quote shapes, switching
// between them in the editor, and the built-ins AWOIAF Modern, Folio, Slate, Midnight.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { oneProject, openProject, PROJECT, startApp } from "./fixtures";
import { PAGES } from "./fixtures-data";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/looks-${name}.png` });
const css = (el: Locator, prop: string, pseudo?: string) =>
  el.evaluate((e, [p, ps]) => getComputedStyle(e, ps ?? null).getPropertyValue(p!), [prop, pseudo] as const);
const rootVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const themeItem = (page: Page, name: string | RegExp) => page.getByRole("navigation", { name: "Themes" }).getByRole("button", { name });

async function editThemeA(page: Page) {
  await startApp(page, { ...oneProject(PAGES), themes: { "Theme A": { name: "Theme A", vars: {} } } });
  await page.getByRole("button", { name: "Themes" }).click();
  await themeItem(page, /Theme A/).click();
  const pick = (name: string, value: string) => page.locator(`.theme-row[data-var="${name}"] select`).selectOption(value);
  return { pick, sample: page.locator(".theme-sample") };
}

test("frames: switching shows only the chosen one, no ornaments left behind", async ({ page }) => {
  const { pick, sample } = await editThemeA(page);
  const box = sample.locator(".infobox");
  const toc = sample.locator(".toc");
  const embed = sample.locator("details.embed-box");

  await pick("--infobox-frame", "ornate");
  await pick("--toc-frame", "ornate");
  await pick("--navbox-frame", "ornate");
  expect(await css(box, "display", "::before")).toBe("block");
  expect(await css(toc, "display", "::after")).toBe("block");
  expect(await css(embed.locator(".embed-box-title"), "display", "::before")).toBe("block");

  // Ornate → double: the inner line stays, the corner ornaments go.
  await pick("--infobox-frame", "double");
  await pick("--toc-frame", "double");
  await pick("--navbox-frame", "double");
  expect(await css(box, "display", "::before")).toBe("none");
  expect(await css(box, "display", "::after")).toBe("none");
  expect(await css(toc, "display", "::before")).toBe("none");
  expect(await css(embed.locator(".embed-box-title"), "display", "::before")).toBe("none");
  expect(await css(box, "box-shadow")).toContain("inset");

  await pick("--infobox-frame", "bracket");
  await pick("--toc-frame", "bracket");
  expect(await css(box, "background-image")).toContain("linear-gradient");
  expect(await css(toc, "background-image")).toContain("linear-gradient");
  expect(await css(box, "box-shadow")).not.toContain("inset");
  await sample.screenshot({ path: "test-results/looks-bracket.png" });

  // Corner rounding: one size for every box, with any frame; ornate and brackets stay square.
  await pick("--infobox-frame", "double");
  await pick("--toc-frame", "plain");
  await page.getByRole("slider", { name: "Corner rounding", exact: true }).fill("12");
  expect(await css(box, "border-top-left-radius")).toBe("12px");
  expect(await css(box, "box-shadow")).toContain("inset");
  expect(await css(embed, "border-top-left-radius")).toBe("12px");
  expect(await css(sample.locator(".markdown table").first(), "border-top-left-radius")).toBe("12px");
  expect(await css(sample.locator(".markdown table th").first(), "border-top-left-radius")).toBe("11px");
  expect(await css(toc, "border-top-left-radius")).toBe("12px");
  await pick("--quote-style", "framed");
  expect(await css(sample.locator(".quote-box"), "border-top-left-radius")).toBe("12px");
  await sample.screenshot({ path: "test-results/looks-rounded.png" });
  await pick("--infobox-frame", "ornate");
  await pick("--navbox-frame", "bracket");
  expect(await css(box, "border-top-left-radius")).toBe("0px");
  expect(await css(box, "overflow")).toBe("visible");
  expect(await css(embed, "border-top-left-radius")).toBe("0px");
  // Embed boxes can still have their own rounding.
  await pick("--navbox-frame", "plain");
  await page.getByRole("slider", { name: "Own corner rounding" }).fill("4");
  expect(await css(embed, "border-top-left-radius")).toBe("4px");
  await page.getByRole("slider", { name: "Corner rounding", exact: true }).fill("0");
  expect(await css(box, "border-top-left-radius")).toBe("0px");

  await pick("--infobox-frame", "rule");
  expect(await css(box, "border-top-width")).toBe("3px");
  expect(await css(box, "border-left-width")).toBe("0px");
  await pick("--infobox-frame", "plain");
  expect(await css(box, "border-top-width")).toBe("1px");
  expect(await css(box, "border-left-width")).toBe("1px");
});

test("headings, title and quote boxes: new shapes and letters", async ({ page }) => {
  const { pick, sample } = await editThemeA(page);
  const h2 = sample.locator(".markdown h2").first();
  const title = sample.locator(".page-head h1");
  const quote = sample.locator(".quote-box");

  await pick("--heading-deco", "accent");
  expect(await css(h2, "display", "::after")).toBe("block");
  await pick("--heading-deco", "bar");
  expect(await css(h2, "display", "::after")).toBe("none");
  expect(await css(h2, "border-left-width")).toBe("4px");
  expect(await css(h2, "border-bottom-style")).toBe("none");
  await pick("--heading-deco", "double");
  expect(await css(h2, "border-bottom-style")).toBe("double");
  expect(await css(h2, "border-left-width")).toBe("0px");
  await pick("--heading-case", "caps");
  expect(await css(h2, "text-transform")).toBe("uppercase");
  await pick("--heading-weight", "700");
  expect(await css(h2, "font-weight")).toBe("700");

  await pick("--title-deco", "double");
  expect(await css(title, "border-bottom-style")).toBe("double");
  await pick("--title-case", "small-caps");
  expect(await css(title, "font-variant-caps")).toBe("small-caps");
  await pick("--infobox-heading-case", "caps");
  expect(await css(sample.locator("th.infobox-heading"), "text-transform")).toBe("uppercase");

  // Quote box with a bar: no quotation marks; back to open: marks again.
  await pick("--quote-style", "bar");
  expect(await css(quote, "border-left-width")).toBe("3px");
  expect(await css(quote.locator(".quote-text"), "display", "::before")).toBe("none");
  await sample.screenshot({ path: "test-results/looks-shapes.png" });
  await pick("--quote-style", "open");
  expect(await css(quote.locator(".quote-text"), "display", "::before")).toBe("block");
  expect(await css(quote, "border-left-width")).toBe("0px");
});

test("new built-in themes: listed, read-only, used with their own fonts", async ({ page }) => {
  await openProject(page, oneProject(PAGES, { mainPage: "Page A" }));
  await page.getByRole("button", { name: "Themes" }).click();
  for (const name of ["AWOIAF Modern", "Folio", "Slate", "Midnight"]) await expect(themeItem(page, name)).toBeVisible();

  await themeItem(page, "AWOIAF Modern").click();
  await expect(page.getByRole("combobox", { name: "Infobox frame", exact: true })).toHaveValue("bracket");
  await expect(page.getByRole("combobox", { name: "Infobox frame", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Use as app theme" }).click();
  await expect.poll(() => rootVar(page, "--infobox-frame")).toBe("bracket");

  // Copying it writes its font from the app into the copy.
  await page.getByRole("button", { name: "Copy…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy theme" });
  await dialog.getByLabel("Store in").selectOption("project");
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("heading", { name: "AWOIAF Modern copy", level: 2 })).toBeVisible();
  const stored = await page.evaluate((p) => JSON.parse(JSON.stringify((window as any).__mock.projects.get(p).themes.get("AWOIAF Modern copy"))), PROJECT);
  expect(stored.fonts.map((f: { file: string }) => f.file)).toEqual(["Jost-Variable.ttf"]);
  await page.getByRole("button", { name: "Done" }).or(page.getByRole("button", { name: "Page A" })).first().click();
});

for (const [id, check] of [
  ["awoiaf-modern", async (page: Page) => {
    const title = page.locator(".page > .page-head h1");
    await expect(title).toHaveCSS("text-transform", "uppercase");
    await expect(title).toHaveCSS("font-family", /^"?ThemeFont/);
    expect(await css(page.locator(".read-view .infobox"), "background-image")).toContain("linear-gradient");
  }],
  ["folio", async (page: Page) => {
    await expect(page.locator(".read-view .markdown p").first()).toHaveCSS("font-family", /^"?ThemeFont/);
    await expect(page.locator(".read-view .infobox")).toHaveCSS("border-left-width", "0px");
    await expect(page.locator(".read-view .markdown h2").first()).toHaveCSS("font-variant-caps", "small-caps");
  }],
  ["slate", async (page: Page) => {
    await expect(page.locator(".read-view .infobox")).toHaveCSS("border-top-left-radius", "12px");
    await expect(page.locator(".read-view .markdown h2").first()).toHaveCSS("border-left-width", "4px");
  }],
  ["midnight", async (page: Page) => {
    await expect(page.locator(".read-view .markdown p").first()).toHaveCSS("color", "rgb(208, 214, 221)");
    await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(26, 30, 36)");
  }],
] as const) {
  test(`${id} look on a page`, async ({ page }) => {
    await openProject(page, { ...oneProject(PAGES, { mainPage: "Page A" }), appTheme: `builtin:${id}` });
    await expect(page.locator(".read-view .infobox")).toBeVisible();
    await check(page);
    await page.waitForTimeout(300);
    await shot(page, id);
  });
}
