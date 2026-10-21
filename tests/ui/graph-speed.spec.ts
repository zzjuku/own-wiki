// M11 speed check (run on request: PERF=1 npx playwright test graph-speed):
// a generated 5,000-page / 25,000-link project. Prints how long the Graph
// screen takes to show, to settle, to show again with remembered positions,
// and how smooth zooming and panning are.
import { expect, test } from "@playwright/test";
import { oneProject, openProject } from "./fixtures";
import type { MockPage } from "./mock/backend";
import type { GraphController } from "../../src/graph/controller";

declare const process: { env: Record<string, string | undefined> };

declare global {
  interface Window {
    __graph?: GraphController;
  }
}

test.skip(!process.env.PERF, "speed check: PERF=1");
test.setTimeout(180_000);
// Draw with the computer's graphics chip, as the app does (headless Chromium draws in software otherwise).
test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader=false"] } });

function bigProject(n: number, perPage: number): MockPage[] {
  const pages: MockPage[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i++) {
    const links: string[] = [];
    for (let k = 0; k < perPage; k++) {
      // Some pages are linked a lot (hubs), most a little; a few links point to missing pages.
      const t = rnd() < 0.3 ? Math.floor(rnd() ** 3 * n) : Math.floor(rnd() * n);
      links.push(rnd() < 0.02 ? `[[Missing ${t}]]` : `[[Page ${t}]]`);
    }
    pages.push({ id: `Group ${i % 20}/Page ${i}.md`, title: `Page ${i}`, body: `Text ${links.join(" ")}.` });
  }
  return pages;
}

test("5,000 pages, 25,000 links", async ({ page }) => {
  const groups = Array.from({ length: 20 }, (_, i) => `Group ${i}`);
  await openProject(page, oneProject(bigProject(5000, 5), { groups }));
  const t0 = Date.now();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__graph?.graph.order ?? 0), { intervals: [20] }).toBeGreaterThan(4000);
  const shown = Date.now() - t0;
  await expect.poll(() => page.evaluate(() => window.__graph?.settled), { timeout: 120_000, intervals: [100] }).toBe(true);
  const settled = Date.now() - t0;
  const stats = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return { nodes: window.__graph!.graph.order, edges: window.__graph!.graph.size, gpu: info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : "?" };
  });
  // How long one full draw takes, without the mouse.
  const draw = await page.evaluate(() => {
    const s = window.__graph!.sigma;
    const t = performance.now();
    for (let i = 0; i < 10; i++) s.refresh();
    const refresh = (performance.now() - t) / 10;
    const t2 = performance.now();
    for (let i = 0; i < 10; i++) (s as any).render();
    return { refreshMs: refresh, renderMs: (performance.now() - t2) / 10 };
  });
  console.log(JSON.stringify(draw));

  // Smoothness: frame times while zooming and panning with the mouse.
  const box = (await page.locator(".graph-canvas").boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.evaluate(() => {
    (window as any).__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      (window as any).__frames.push(t - last);
      last = t;
      if ((window as any).__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
  await page.mouse.down();
  await page.mouse.move(cx + 300, cy + 150, { steps: 30 });
  await page.mouse.up();
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(30);
  }
  const frames: number[] = await page.evaluate(() => (window as any).__frames.slice(5));
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)];
  const median = frames[frames.length >> 1];

  // Away and back: remembered positions, no layout.
  console.log(JSON.stringify({ ...stats, shownMs: shown, settledMs: settled, frameMedianMs: median, frameP95Ms: p95 }));
  await page.getByRole("button", { name: "Templates" }).click();
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toHaveCount(0);
  const t1 = Date.now();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__graph?.graph.order ?? 0), { intervals: [20] }).toBeGreaterThan(4000);
  const again = Date.now() - t1;
  const relayout = !(await page.evaluate(() => window.__graph!.settled));
  await page.screenshot({ path: "test-results/graph-speed.png" });

  console.log(JSON.stringify({ reopenMs: again, relayout }));
  expect(shown).toBeLessThan(2500);
  expect(again).toBeLessThan(1000);
  expect(relayout).toBe(false);
});
