// M11: the Graph screen's panel (extra-node switches, filters, colour rules
// and their order), search, field names on lines with spoilers, the local
// graph beside pages (depth, follows the page, Open in Graph), and the graph
// following saves and renames.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject, PROJECT } from "./fixtures";
import { TEMPLATE } from "./fixtures-data";
import { nodeAt, nodeColor, nodes, openGraph, settled } from "./graphHelpers";
import type { MockPage } from "./mock/backend";

const PAGES: MockPage[] = [
  {
    id: "Page A.md",
    title: "Page A",
    aliases: ["Alias A"],
    categories: ["Category A"],
    body: "Links to [[Page B]] and [[Missing page]].",
    infobox: { template: TEMPLATE.id, fields: [] },
  },
  { id: "Page B.md", title: "Page B", body: "Back to [[Page A]] and [[Page C|C]]." },
  {
    id: "Group A/Page C.md",
    title: "Page C",
    body: "See [[Page B]].",
    infobox: {
      fields: [
        { label: "Father", type: "links", value: ["Page D"] },
        { label: "Secret field", type: "links", value: ["Page D"], spoiler: true },
      ],
    },
  },
  { id: "Group A/Page D.md", title: "Page D", body: "Nothing." },
  { id: "Page E.md", title: "Page E", categories: ["Category A"], body: "No links.", infobox: { template: TEMPLATE.id, fields: [] } },
];

const data = () => oneProject(PAGES, { groups: ["Group A"], templates: [TEMPLATE], mainPage: "Page B" });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/graph-${name}.png` });
const panel = (page: Page) => page.getByRole("complementary", { name: "Graph filters and colours" });
const count = (page: Page) => page.locator(".graph-count");
const sidebarPage = (page: Page, title: string) => page.getByRole("tree", { name: "Pages" }).getByRole("button", { name: title, exact: true });

async function openPanel(page: Page) {
  await openGraph(page);
  await page.getByRole("button", { name: "Filters & colours" }).click();
  await expect(panel(page)).toBeVisible();
}

test("extra nodes: red links, categories and groups each have a switch", async ({ page }) => {
  await openProject(page, data());
  await openPanel(page);
  expect(await nodes(page)).toEqual(["p:Group A/Page C.md", "p:Group A/Page D.md", "p:Page A.md", "p:Page B.md", "p:Page E.md"]);

  await panel(page).getByLabel("Red links").check();
  await expect.poll(() => nodes(page)).toContain("r:missing page");
  await panel(page).getByLabel("Categories").check();
  await expect.poll(() => nodes(page)).toContain("c:category a");
  // The category is lined to both its pages.
  expect(await page.evaluate(() => window.__graph!.graph.neighbors("c:category a").sort())).toEqual(["p:Page A.md", "p:Page E.md"]);
  await panel(page).getByLabel("Groups").check();
  await expect.poll(() => nodes(page)).toContain("g:Group A");
  expect(await page.evaluate(() => window.__graph!.graph.neighbors("g:Group A").sort())).toEqual(["p:Group A/Page C.md", "p:Group A/Page D.md"]);
  await settled(page);
  await shot(page, "extra-nodes");

  // Clicking a red link offers to create the page (the panel closed, so it doesn't cover the node).
  await page.getByRole("button", { name: "Filters & colours" }).click();
  await expect(panel(page)).toHaveCount(0);
  // (The small node drifts, so under load a click can just miss it: aim again.)
  await expect(async () => {
    const p = await nodeAt(page, "r:missing page");
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole("dialog", { name: "Create page" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.press("Escape");

  // Switched off again, they go; the switches are remembered.
  await page.getByRole("button", { name: "Filters & colours" }).click();
  await panel(page).getByLabel("Red links").uncheck();
  await expect.poll(() => nodes(page)).not.toContain("r:missing page");
  await sidebarPage(page, "Page B").click();
  await openGraph(page);
  await expect.poll(() => nodes(page)).toContain("c:category a");
});

test("filters by group, category and template, hide orphans, and link types", async ({ page }) => {
  await openProject(page, data());
  await openPanel(page);
  await expect(count(page)).toHaveText("5 pages · 3 links");
  await panel(page).getByLabel("Group", { exact: true }).selectOption("Group A");
  await expect(count(page)).toHaveText("2 pages · 1 link (filtered)");
  await panel(page).getByLabel("Group", { exact: true }).selectOption("");
  await panel(page).getByLabel("Category", { exact: true }).selectOption("Category A");
  await expect(count(page)).toHaveText("2 pages · 0 links (filtered)");
  await panel(page).getByLabel("Category", { exact: true }).selectOption("");
  await panel(page).getByLabel("Template").selectOption(TEMPLATE.id);
  await expect.poll(() => nodes(page)).toEqual(["p:Page A.md", "p:Page E.md"]);
  await panel(page).getByRole("button", { name: "Clear filters" }).click();
  await panel(page).getByLabel("Hide orphans").check();
  await expect.poll(() => nodes(page)).not.toContain("p:Page E.md");
  await panel(page).getByLabel("Hide orphans").uncheck();
  // Without infobox links the Father line goes; without text links only it stays.
  await panel(page).getByLabel("Infobox links").uncheck();
  await expect(count(page)).toHaveText("5 pages · 2 links");
  await panel(page).getByLabel("Infobox links").check();
  await panel(page).getByLabel("Text links").uncheck();
  await expect(count(page)).toHaveText("5 pages · 1 link");
  await shot(page, "panel");
});

test("search highlights titles and aliases and moves to the first match", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const normal = await nodeColor(page, "p:Page B.md");
  const box = page.getByRole("searchbox", { name: "Search the graph" });
  await box.fill("alias");
  await expect(page.locator(".graph-matches")).toHaveText("1 match");
  await expect.poll(() => nodeColor(page, "p:Page A.md")).not.toBe(normal);
  expect(await nodeColor(page, "p:Page B.md")).toBe(normal);
  // Word starts only, as on the Search screen.
  await box.fill("age");
  await expect(page.locator(".graph-matches")).toHaveText("0 matches");
  await box.fill("page");
  await expect(page.locator(".graph-matches")).toHaveText("5 matches");
  // The view moved to the first match.
  await expect.poll(() => page.evaluate(() => window.__graph!.getCamera().ratio)).toBeLessThan(0.5);
});

test("colour rules: first match wins, drag changes the order, saved in the project", async ({ page }) => {
  await openProject(page, data());
  await openPanel(page);
  const rules = panel(page).locator(".graph-rule");
  await panel(page).getByRole("button", { name: "+ Add colour rule" }).click();
  await rules.nth(0).getByLabel("Rule value").selectOption(TEMPLATE.id);
  await rules.nth(0).getByLabel("Colour").fill("#cc0000");
  await panel(page).getByRole("button", { name: "+ Add colour rule" }).click();
  await rules.nth(1).getByLabel("Rule kind").selectOption("category");
  await rules.nth(1).getByLabel("Rule value").selectOption("Category A");
  await rules.nth(1).getByLabel("Colour").fill("#0000cc");
  // Page A matches both: the first rule (template) wins. Page B matches none.
  await expect.poll(() => nodeColor(page, "p:Page A.md")).toBe("rgba(204,0,0,1)");
  expect(await nodeColor(page, "p:Page B.md")).not.toBe("rgba(204,0,0,1)");
  await shot(page, "colour-rules");

  // Drag the category rule above the template rule.
  const handle = rules.nth(1).locator(".drag-handle");
  const from = (await handle.boundingBox())!;
  const to = (await rules.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, to.y + 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => nodeColor(page, "p:Page A.md")).toBe("rgba(0,0,204,1)");
  await expect
    .poll(() => page.evaluate((p) => (window as any).__mock.projects.get(p).settings.graphColors, PROJECT))
    .toEqual([
      { kind: "category", value: "Category A", color: "#0000cc" },
      { kind: "template", value: TEMPLATE.id, color: "#cc0000" },
    ]);
});

test("field names on lines: spoiler fields only with the eye switch on", async ({ page }) => {
  await openProject(page, data());
  await openGraph(page);
  const label = () =>
    page.evaluate(() => {
      const g = window.__graph!;
      return g.sigma.getEdgeDisplayData(g.graph.edge("p:Group A/Page C.md", "p:Group A/Page D.md"))?.label;
    });
  const p = await nodeAt(page, "p:Group A/Page D.md");
  await page.mouse.move(p.x, p.y);
  await expect.poll(label).toBe("Father");
  await page.mouse.move(5, 5);
  await page.getByRole("button", { name: "Show all spoilers" }).click();
  // Over the empty background first, then onto the node again.
  const canvas = (await page.locator(".graph-canvas").boundingBox())!;
  await page.mouse.move(canvas.x + 10, canvas.y + canvas.height - 10);
  const q = await nodeAt(page, "p:Group A/Page D.md");
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await expect.poll(label).toBe("Father, Secret field");
});

test("local graph beside the page: neighbours, depth, follows the page, Open in Graph", async ({ page }) => {
  await openProject(page, data());
  await sidebarPage(page, "Page A").click();
  await page.getByRole("button", { name: "Local graph", exact: true }).click();
  const local = page.getByRole("complementary", { name: "Local graph" });
  await expect(local).toBeVisible();
  await expect.poll(() => nodes(page, "__localGraph")).toEqual(["p:Page A.md", "p:Page B.md"]);
  await local.getByRole("button", { name: "2", exact: true }).click();
  await expect.poll(() => nodes(page, "__localGraph")).toEqual(["p:Group A/Page C.md", "p:Page A.md", "p:Page B.md"]);
  await settled(page, "__localGraph");
  await shot(page, "local");

  // Clicking a node opens that page; the panel follows it.
  const c = await nodeAt(page, "p:Group A/Page C.md", "__localGraph");
  await page.mouse.click(c.x, c.y);
  await expect(page.locator(".page-head h1")).toHaveText("Page C");
  await expect.poll(() => nodes(page, "__localGraph")).toEqual(["p:Group A/Page C.md", "p:Group A/Page D.md", "p:Page A.md", "p:Page B.md"]);

  // Open in Graph: the full screen, centred on this page.
  await local.getByRole("button", { name: "Open in Graph" }).click();
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__graph?.getCamera().ratio ?? 1)).toBeLessThan(0.5);

  // Open stays remembered; closing hides it on every page.
  await sidebarPage(page, "Page B").click();
  await expect(local).toBeVisible();
  await local.getByRole("button", { name: "Close the local graph" }).click();
  await expect(local).toHaveCount(0);
});

test("the graph follows a save and a rename", async ({ page }) => {
  await openProject(page, data());
  await sidebarPage(page, "Page E").click();
  await page.getByRole("button", { name: "Local graph", exact: true }).click();
  await expect.poll(() => nodes(page, "__localGraph")).toEqual(["p:Page E.md"]);
  // A link typed into Page E shows up after the autosave.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" See [[Page D]].");
  await expect.poll(() => nodes(page, "__localGraph"), { timeout: 10000 }).toEqual(["p:Group A/Page D.md", "p:Page E.md"]);
  // A save that changes no link leaves the graph alone.
  await page.keyboard.type(" More words.");
  await page.getByRole("button", { name: "View", exact: true }).click();

  // Renaming Page D: the node follows the new name.
  await page.getByRole("tree", { name: "Pages" }).getByRole("button", { name: "Group A", exact: true }).click();
  await sidebarPage(page, "Page D").click();
  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: /Rename/ });
  await rename.getByRole("textbox").first().fill("Page D2");
  await rename.getByRole("button", { name: "Rename" }).click();
  await openGraph(page);
  await expect.poll(() => nodes(page)).toContain("p:Group A/Page D2.md");
  expect(await page.evaluate(() => window.__graph!.graph.hasEdge("p:Group A/Page D2.md", "p:Page E.md"))).toBe(true);
});
