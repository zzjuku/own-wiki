// M13: zoom — Cmd/Ctrl + scroll, Cmd/Ctrl + = − 0 and Settings → Zoom, remembered on this computer.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, startApp } from "./fixtures";

const asked = (page: Page) => page.evaluate(() => (window as any).__mock.zoomAsked as number[]);
const last = async (page: Page) => (await asked(page)).at(-1);

test("Settings → Zoom, the keys and the wheel zoom the whole app; the level is remembered", async ({ page }) => {
  await startApp(page, oneProject([{ id: "Page A.md", title: "Page A", body: "Text." }]));
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Zoom").selectOption("150");
  expect(await last(page)).toBe(1.5);
  await page.screenshot({ path: "test-results/zoom-settings.png" });
  await page.getByRole("button", { name: "Done" }).click();

  await page.keyboard.press("ControlOrMeta+Equal");
  expect(await last(page)).toBe(1.6);
  await page.keyboard.press("ControlOrMeta+Minus");
  await page.keyboard.press("ControlOrMeta+Minus");
  expect(await last(page)).toBe(1.4);

  // Cmd/Ctrl + scroll: up is bigger.
  await page.mouse.move(400, 300);
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("ControlOrMeta");
  await expect.poll(() => last(page)).toBe(1.5);

  // Remembered: after a restart the app asks for the same level.
  await page.reload();
  await expect(page.getByText("Project A", { exact: true })).toBeVisible();
  await expect.poll(() => asked(page)).toEqual([1.5]);
  await page.keyboard.press("ControlOrMeta+Digit0");
  expect(await last(page)).toBe(1);
  // Never below 50 % or above 200 %.
  for (let i = 0; i < 12; i++) await page.keyboard.press("ControlOrMeta+Minus");
  expect(await last(page)).toBe(0.5);
});

test("the Family tree keeps its own wheel zoom; the app zoom stays", async ({ page }) => {
  const { FAMILY, SETTINGS } = await import("./familyData");
  await startApp(page, oneProject(FAMILY, { settings: SETTINGS, mainPage: "Person C" }));
  await page.getByText("Project A", { exact: true }).click();
  await page.getByRole("button", { name: "Family tree", exact: true }).click();
  const g = page.locator(".tree-canvas > g");
  await expect(g).toHaveAttribute("transform", /scale/);
  const before = await g.getAttribute("transform");
  const box = (await page.locator(".tree-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => g.getAttribute("transform")).not.toBe(before);
  expect(await asked(page)).toEqual([]);
});
