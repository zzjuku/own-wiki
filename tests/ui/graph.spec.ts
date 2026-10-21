// M11: the Graph screen (opens from the sidebar button and Cmd+Alt+G, click
// opens a page and Back returns, hover highlights neighbours, positions are
// remembered).
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, PROJECT } from "./fixtures";
import type { MockPage } from "./mock/backend";
import type { GraphController } from "../../src/graph/controller";

declare global {
  interface Window {
    __graph?: GraphController;
  }
}

const PAGES: MockPage[] = [
  { id: "Page A.md", title: "Page A", body: "Links to [[Page B]] and [[Page C]] and [[Missing page]]." },
  { id: "Page B.md", title: "Page B", body: "Back to [[Page A]]." },
  {
    id: "Group A/Page C.md",
    title: "Page C",
    body: "Plain text.",
    infobox: { fields: [{ label: "Example field", type: "links", value: ["Page D"] }] },
  },
  { id: "Page D.md", title: "Page D", body: "Nothing." },
  { id: "Page E.md", title: "Page E", body: "No links at all." },
];

const data = () => oneProject(PAGES, { groups: ["Group A"], mainPage: "Page B" });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/graph-${name}.png` });

/** Waits until the graph has come to rest once (it keeps drifting gently after). */
async function settled(page: Page) {
  await expect.poll(() => page.evaluate(() => (window.__graph?.settled && !window.__graph.sigma.getCamera().isAnimated()) ?? false), { timeout: 15000 }).toBe(true);
}

const position = (page: Page, key: string) =>
  page.evaluate((k) => [window.__graph!.graph.getNodeAttribute(k, "x"), window.__graph!.graph.getNodeAttribute(k, "y")], key);

/** The middle of a node on screen. */
async function nodeAt(page: Page, key: string) {
  const r = await page.evaluate((k) => {
    const rect = window.__graph?.nodeRect(k);
    return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, key);
  if (!r) throw new Error(`no node ${key}`);
  return r;
}

/** The colour a node is drawn in now. */
const nodeColor = (page: Page, key: string) => page.evaluate((k) => window.__graph!.sigma.getNodeDisplayData(k)?.color, key);

async function openGraph(page: Page) {
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();
  await settled(page);
}

test("the Graph screen opens from the sidebar and the shortcut and shows every page and link", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  // Red links are off by default: 5 pages, 3 links (A–B both ways is one line).
  await expect(page.locator(".graph-count")).toHaveText("5 pages · 3 links");
  await shot(page, "screen");

  // Away and back with the shortcut.
  await page.locator(".sidebar").getByText("Page D", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Alt+KeyG");
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();
});

test("clicking a node opens the page and Back returns to the graph", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const before = await page.evaluate(() => window.__graph!.getCamera());
  const p = await nodeAt(page, "p:Group A/Page C.md");
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(".page-head h1")).toHaveText("Page C");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();
  // The view is where it was.
  await expect.poll(() => page.evaluate(() => window.__graph?.getCamera())).toEqual(before);
});

test("hovering a node highlights it and its neighbours and shows the hover card", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const normal = await nodeColor(page, "p:Page E.md");
  const p = await nodeAt(page, "p:Page A.md");
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => nodeColor(page, "p:Page E.md")).not.toBe(normal);
  // Neighbours keep their colour, the rest fades; the hovered page gets the highlight colour.
  expect(await nodeColor(page, "p:Page B.md")).toBe(normal);
  expect(await nodeColor(page, "p:Group A/Page C.md")).toBe(normal);
  expect(await nodeColor(page, "p:Page D.md")).toBe(await nodeColor(page, "p:Page E.md"));
  expect(await nodeColor(page, "p:Page A.md")).not.toBe(normal);
  await expect(page.locator(".hover-card .hover-card-title")).toHaveText("Page A");
  await shot(page, "hover");
  await page.mouse.move(5, 5);
  await expect.poll(() => nodeColor(page, "p:Page E.md")).toBe(normal);
});

test("dragging pulls the neighbours along and the node springs back; positions are remembered", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const saved = () => page.evaluate((p) => (window as any).__mock.graphLayouts.get(p)?.positions, PROJECT);
  await expect.poll(saved).toBeTruthy();
  const neighbour = await position(page, "p:Page B.md");
  const p = await nodeAt(page, "p:Page A.md");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 150, p.y + 100, { steps: 10 });
  // The node follows the mouse; its neighbour is pulled after it.
  const held = await nodeAt(page, "p:Page A.md");
  expect(Math.abs(held.x - p.x - 150)).toBeLessThan(3);
  await expect.poll(async () => (await position(page, "p:Page B.md"))[0]).not.toBe(neighbour[0]);
  await page.mouse.up();
  // Not opened by the drag; let go, it springs back towards its neighbours.
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();
  await expect.poll(async () => {
    const now = await nodeAt(page, "p:Page A.md");
    return Math.hypot(now.x - held.x, now.y - held.y);
  }).toBeGreaterThan(30);

  // Leave and come back: the nodes start where they were left.
  await page.locator(".sidebar").getByText("Page D", { exact: true }).click();
  await expect.poll(async () => Object.keys((await saved()) ?? {}).length).toBe(5);
  const positions = await saved();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  const again = await page.evaluate(() => {
    const g = window.__graph!.graph;
    return Object.fromEntries(g.nodes().map((k) => [k, [g.getNodeAttribute(k, "x"), g.getNodeAttribute(k, "y")]]));
  });
  for (const [k, [x, y]] of Object.entries(again)) expect(Math.hypot(x - positions[k][0], y - positions[k][1])).toBeLessThan(15);
});

test("the graph keeps moving gently after it has settled", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const before = await position(page, "p:Page E.md");
  await expect.poll(async () => {
    const [x, y] = await position(page, "p:Page E.md");
    return Math.hypot(x - before[0], y - before[1]);
  }).toBeGreaterThan(0.2);
});

test("Re-arrange lays the graph out anew", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const pos = () => page.evaluate(() => window.__graph!.graph.getNodeAttribute("p:Page A.md", "x"));
  const before = await pos();
  await page.getByRole("button", { name: "Re-arrange" }).click();
  await expect.poll(pos).not.toBe(before);
});
