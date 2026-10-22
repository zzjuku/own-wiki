// M12 speed check (run on request: PERF=1 npx playwright test family-speed):
// a 5,000-page project with a 500-person family. Prints how long the Family
// tree screen takes to show the whole family, to show it again after a page
// changed, and how smooth zooming and panning are.
import { expect, test } from "@playwright/test";
import { oneProject, openProject } from "./fixtures";
import type { MockPage } from "./mock/backend";

declare const process: { env: Record<string, string | undefined> };

test.skip(!process.env.PERF, "speed check: PERF=1");
test.setTimeout(180_000);

/** Page 0 and their descendants: each person has a partner from outside and up to 3 children. */
function bigFamily(people: number, pages: number): MockPage[] {
  const out: MockPage[] = [];
  const kids: number[] = [0];
  let made = 1;
  const fields = (i: number, parent: number | null) => [
    ...(parent !== null ? [{ label: "Father", type: "links" as const, value: [`Page ${parent}`] }, { label: "Mother", type: "links" as const, value: [`Page ${parent} partner`] }] : []),
    { label: "Spouse", type: "links" as const, value: [`Page ${i} partner`] },
    { label: "Born", type: "date" as const, options: { age: "birth" }, value: { year: 100 + i } },
  ];
  out.push({ id: "Page 0.md", title: "Page 0", infobox: { fields: fields(0, null) } });
  // Breadth first: about half the people (with their partners) make 500 in all.
  while (made < people / 2 && kids.length) {
    const p = kids.shift()!;
    for (let k = 0; k < 3 && made < people / 2; k++, made++) {
      out.push({ id: `Page ${made}.md`, title: `Page ${made}`, infobox: { fields: fields(made, p) } });
      kids.push(made);
    }
  }
  for (let i = 0; i < made; i++) out.push({ id: `Page ${i} partner.md`, title: `Page ${i} partner` });
  for (let i = out.length; i < pages; i++) out.push({ id: `Other ${i}.md`, title: `Other ${i}`, body: "Not in the family." });
  return out;
}

test("a 500-person family in 5,000 pages", async ({ page }) => {
  const settings = { hideCategoryBox: false, familyTree: { parents: [{ field: "Father" }, { field: "Mother" }], partners: [{ field: "Spouse" }] } };
  await openProject(page, oneProject(bigFamily(500, 5000), { settings, mainPage: "Page 0" }));
  // Show the whole family: 10 generations down.
  await page.evaluate(() => localStorage.setItem("ownwiki.familyTree.Project A", JSON.stringify({ up: 2, down: 10, partnersParents: false, last: null })));
  const t0 = Date.now();
  await page.getByRole("button", { name: "Family tree", exact: true }).click();
  await expect(page.locator(".tree-box.person")).toHaveCount(500, { timeout: 30_000 });
  const shown = Date.now() - t0;

  // Again after a page changed (the index changes; the tree is worked out anew).
  await page.getByRole("button", { name: "Main page", exact: true }).click();
  await page.evaluate(() => {
    const p = (window as any).__mock.projects.get("Project A").pages.get("Page 10.md");
    p.infobox.fields[2].value = ["Page 10 partner", "Page 11 partner"];
  });
  const t1 = Date.now();
  await page.keyboard.press("ControlOrMeta+Alt+KeyT");
  await expect(page.locator(".tree-box.person")).toHaveCount(500);
  await expect(page.locator(".tree-box.stub").first()).toBeVisible();
  const again = Date.now() - t1;

  // Smoothness: frame times while zooming and panning with the mouse.
  const area = (await page.locator(".tree-canvas").boundingBox())!;
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.evaluate(() => {
    (window as any).__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      (window as any).__frames.push(t - last);
      last = t;
      if ((window as any).__frames.length < 200) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -100);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(cx + i * 8, cy + i * 3);
  await page.mouse.up();
  const frames: number[] = await page.evaluate(() => (window as any).__frames.slice(1));
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)];
  console.log(JSON.stringify({ shownMs: shown, againMs: again, frames: frames.length, medianFrameMs: frames[Math.floor(frames.length / 2)], p95FrameMs: p95 }));
  expect(shown).toBeLessThan(1500);
  expect(again).toBeLessThan(1500);
});
