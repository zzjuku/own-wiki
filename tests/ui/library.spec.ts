// Settings → Move library…: the library's projects and themes are copied to a
// chosen folder and used from there; the originals stay (copying is tested in Rust).
import { expect, test } from "@playwright/test";
import { oneProject, startApp } from "./fixtures";

test("Move library copies the library to a chosen folder and switches to it", async ({ page }) => {
  await startApp(page, oneProject([{ id: "Page A.md", title: "Page A" }]));
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).locator("code.path")).toHaveText("/Library");
  await page.evaluate(() => (window as any).__mock.setNextOpen("/Drive/My Drive"));
  await page.getByRole("button", { name: "Move library…" }).click();
  const confirm = page.getByRole("dialog", { name: "Move library" });
  await expect(confirm).toContainText("/Drive/My Drive/Own WIKI");
  await expect(confirm).toContainText("(“Project A”, “_themes”)");
  await expect(confirm).toContainText("Nothing else in the current library folder is touched");
  await page.screenshot({ path: "test-results/m10-move-library.png" });
  await confirm.getByRole("button", { name: "Move library" }).click();
  const done = page.getByRole("dialog", { name: "Library moved" });
  await expect(done).toContainText("3 files were copied");
  await done.getByRole("button").first().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).locator("code.path")).toHaveText("/Drive/My Drive/Own WIKI");
});
