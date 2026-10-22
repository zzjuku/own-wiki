// M12: family trees — the settings, the Family tree screen (button and
// shortcut), generations, several partners with a dashed lover line, an
// unknown parent, stubs, placeholders, line styles, couple labels, spoilers.
import { expect, test, type Page } from "@playwright/test";
import type { Field } from "../../src/api";
import { oneProject, openProject, storedPage } from "./fixtures";
import { FAMILY, SETTINGS } from "./familyData";

const data = (extra = {}) => oneProject(FAMILY, { settings: SETTINGS, mainPage: "Person C", ...extra });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/family-${name}.png` });
const box = (page: Page, title: string) => page.locator(`.tree-box:not(.stub)[data-name="${title}"]`);

async function openTree(page: Page) {
  await page.getByRole("button", { name: "Family tree", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toBeVisible();
}

test("the Family tree screen opens from the sidebar and the shortcut, centred on the open page", async ({ page }) => {
  await openProject(page, data());
  await expect(page.locator(".page-head h1")).toHaveText("Person C");
  await openTree(page);
  await expect(page.getByLabel("Person in the middle")).toHaveValue("Person C");
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
  await expect(page.locator(".tree-box.centre")).toContainText("b. 290");
  // Up 2 / down 3: grandparents, parents, siblings, aunt, cousins, partners, children.
  for (const t of ["Person GA", "Person GB", "Person F", "Person M", "Person S", "Person H", "Person J", "Person W", "Person X", "Person K", "Person L"])
    await expect(box(page, t)).toHaveCount(1);
  await shot(page, "screen");

  // Away and back with the shortcut.
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Alt+KeyT");
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
});

test("generations up and down limit the tree, and a person can be chosen", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await page.getByLabel("Generations up").fill("0");
  await expect(box(page, "Person F")).toHaveCount(0);
  await expect(box(page, "Person X")).toHaveCount(1);
  await page.getByLabel("Generations down").fill("0");
  await expect(box(page, "Person X")).toHaveCount(0);
  await expect(box(page, "Person W")).toHaveCount(1);
  await page.getByLabel("Generations up").fill("2");
  await page.getByLabel("Generations down").fill("3");
  // Choose another person.
  await page.getByLabel("Person in the middle").click();
  await page.getByLabel("Person in the middle").fill("person h");
  await page.getByRole("option", { name: "Person H" }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person H");
  // Back returns to the person before.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
});

test("several partners, a dashed lover line, couple words, an unknown parent and line styles", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  // Person F: wife (with words) on one side, lover on the other; the lover's line is dashed.
  const f = await box(page, "Person F").boundingBox();
  const m = await box(page, "Person M").boundingBox();
  const l = await box(page, "Person L").boundingBox();
  expect(Math.sign(m!.x - f!.x)).not.toBe(Math.sign(l!.x - f!.x));
  await expect(page.locator(".tree-couple-label", { hasText: "(m. 283)" })).toHaveCount(1);
  await expect(page.locator(".tree-line.couple.dashed")).toHaveCount(1);
  // Person H: a child with Person U and one with no known second parent: a "?" partner
  // (on the other side from Person U).
  await page.getByLabel("Person in the middle").click();
  await page.getByLabel("Person in the middle").fill("Person H");
  await page.keyboard.press("Enter");
  await page.getByLabel("Generations up").fill("0");
  await expect(page.locator(".tree-box.unknown")).toHaveCount(1);
  const h = await box(page, "Person H").boundingBox();
  const u = await box(page, "Person U").boundingBox();
  const q = await page.locator(".tree-box.unknown").boundingBox();
  expect(Math.sign(u!.x - h!.x)).not.toBe(Math.sign(q!.x - h!.x));
  await shot(page, "unknown-parent");
});

test("someone belonging in two places has one box and a stub that leads to it", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  // Cousins Person S and Person J are married: one full box each, stubs elsewhere.
  await expect(box(page, "Person J")).toHaveCount(1);
  const stub = page.locator(".tree-box.stub").first();
  await expect(stub).toBeVisible();
  const target = await stub.getAttribute("data-target");
  await stub.hover();
  await expect(page.locator(`.tree-box[data-key="${target}"]`)).toHaveClass(/lit/);
  await stub.click();
  await expect(page.locator(`.tree-box[data-key="${target}"]`)).toHaveClass(/flash/);
});

test("a placeholder (no page yet) is a dashed box; clicking it creates the page", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  const ph = page.locator(".tree-box.placeholder");
  await expect(ph).toContainText("Person MZ");
  // A click selects it (the bar offers Create page…); a double-click creates it straight away.
  await ph.click();
  await expect(page.getByRole("toolbar", { name: "Selected" })).toContainText("has no page yet");
  await ph.dblclick();
  await expect(page.getByRole("dialog")).toContainText("Create page");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".tree-box.placeholder")).toHaveCount(0);
  await expect(box(page, "Person MZ")).toHaveCount(1);
  // Still on the tree.
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toBeVisible();
});

test("a person behind a spoiler relation is hidden until revealed", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await expect(box(page, "Person Q")).toHaveCount(0);
  const hidden = page.locator(".tree-box.hidden");
  await expect(hidden).toHaveCount(1);
  await hidden.click();
  await expect(box(page, "Person Q")).toHaveCount(1);
  // The eye switch shows them too.
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await page.getByRole("button", { name: "Show all spoilers" }).click();
  await page.keyboard.press("ControlOrMeta+Alt+KeyT");
  await expect(box(page, "Person Q")).toHaveCount(1);
});

test("Project settings → Family tree chooses the fields; nothing chosen opens the settings", async ({ page }) => {
  await openProject(page, data({ settings: { hideCategoryBox: false } }));
  await openTree(page);
  const dialog = page.getByRole("dialog", { name: "Project settings" });
  await expect(dialog).toBeVisible();
  await expect(page.getByText("No family fields are chosen yet.")).toBeVisible();
  await dialog.getByLabel("Add a parent field").selectOption("Father");
  await dialog.getByLabel("Add a parent field").selectOption("Mother");
  await dialog.getByLabel("Add a partner field").selectOption("Lover");
  await dialog.getByLabel("Partner fields: line for Lover").selectOption("dotted");
  await shot(page, "settings");
  await dialog.getByRole("button", { name: "Done" }).click();
  const stored = await page.evaluate(() => (window as any).__mock.projects.get("Project A").settings.familyTree);
  expect(stored).toEqual({ parents: [{ field: "Father", line: "solid" }, { field: "Mother", line: "solid" }], partners: [{ field: "Lover", line: "dotted" }] });
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
  await expect(page.locator(".tree-line.couple.dotted")).toHaveCount(1);
});

test("the tree in the built-in themes", async ({ page }) => {
  test.setTimeout(90_000);
  for (const id of ["default", "parchment", "awoiaf", "awoiaf-modern", "folio", "slate", "midnight"]) {
    await openProject(page, { ...data(), appTheme: `builtin:${id}` });
    await openTree(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await box(page, "Person F").hover();
    await page.waitForTimeout(300);
    await shot(page, `theme-${id}`);
  }
});

test("All families draws every family, each person once", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await page.getByLabel("Person in the middle").click();
  await page.getByRole("option", { name: "All families" }).click();
  await expect(page.getByLabel("Person in the middle")).toHaveValue("All families");
  await expect(page.getByLabel("Generations up")).toBeDisabled();
  // Everyone in a family has one full box (Page A has no family; Person Q is behind a spoiler).
  for (const p of FAMILY.filter((x) => !["Page A", "Person Q"].includes(x.title))) await expect(box(page, p.title)).toHaveCount(1);
  await expect(box(page, "Person MZ")).toHaveCount(1);
  await expect(box(page, "Person Q")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit" }).click();
  await shot(page, "all-families");
  // Back to the person before.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person C");
});

test("pages in a family have a Family tree button that opens the tree on them", async ({ page }) => {
  await openProject(page, data());
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Family tree of this page" })).toHaveCount(0);
  // Person Q's only relation is a spoiler: no button either.
  await page.locator(".sidebar").getByText("Person Q", { exact: true }).click();
  await expect(page.locator(".page-head h1")).toHaveText("Person Q");
  await expect(page.getByRole("button", { name: "Family tree of this page" })).toHaveCount(0);
  await page.locator(".sidebar").getByText("Person H", { exact: true }).click();
  await page.getByRole("button", { name: "Family tree of this page" }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person H");
  // Back returns to the page.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".page-head h1")).toHaveText("Person H");
});

test("a family tree in page text: inserted with its dialog, drawn in the page, opens on the screen", async ({ page }) => {
  await openProject(page, data());
  await page.locator(".sidebar").getByText("Person F", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+e");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Family tree (a person's family, drawn in the page)" }).click();
  const dialog = page.getByRole("dialog", { name: "Family tree" });
  await expect(dialog.getByLabel("Person in the middle")).toHaveValue("Person F");
  await dialog.getByLabel("Generations up").fill("0");
  await dialog.getByLabel("Generations down").fill("1");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator(".cm-content")).toContainText('<familytree root="Person F" up="0" down="1">');
  // The preview draws it already.
  await expect(page.locator(".split-preview .page-tree .tree-box.centre")).toContainText("Person F");
  // Clicking the line in the source reopens the dialog.
  await page.locator(".cm-line", { hasText: "<familytree" }).click();
  await expect(dialog.getByLabel("Generations down")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("ControlOrMeta+e");
  // Read view: parents (up 0) left out, children shown.
  const tree = page.locator(".read-view .page-tree");
  await expect(tree.locator(".tree-box.centre")).toContainText("Person F");
  await expect(tree.locator('.tree-box[data-name="Person GA"]')).toHaveCount(0);
  await expect(tree.locator('.tree-box[data-name="Person C"]')).toHaveCount(1);
  await shot(page, "in-page");
  await tree.getByRole("button", { name: "Open in Family tree" }).click();
  await expect(page.locator(".tree-canvas:not(.page-tree *) .tree-box.centre, .family-body .tree-box.centre")).toContainText("Person F");
});

test("a family tree line naming no page shows a red notice", async ({ page }) => {
  const pages = [...FAMILY, { id: "Page B.md", title: "Page B", body: 'Text.\n\n<familytree root="Missing person" up="1" down="1">\n' }];
  await openProject(page, oneProject(pages, { settings: SETTINGS }));
  await page.locator(".sidebar").getByText("Page B", { exact: true }).click();
  await expect(page.locator(".page-tree-missing")).toContainText("Missing person");
});

test("a house's tree: its members, their partners and their children", async ({ page }) => {
  await openProject(page, data({ settings: { ...SETTINGS, familyTree: { ...SETTINGS.familyTree, house: "Dynasty" } } }));
  await openTree(page);
  await page.getByLabel("Person in the middle").click();
  await expect(page.getByRole("option", { name: /House M/ })).toBeVisible();
  await page.getByRole("option", { name: /House A/ }).click();
  await expect(page.getByLabel("Person in the middle")).toHaveValue("House A");
  // Members (GA, F, H), partners (GB, M, L, U), children (F's: C, S, K; H's: J, I).
  for (const t of ["Person GA", "Person F", "Person H", "Person GB", "Person M", "Person L", "Person U", "Person C", "Person S", "Person K", "Person J", "Person I"])
    await expect(box(page, t)).toHaveCount(1);
  // Nobody beyond: grandchildren, partners' parents.
  for (const t of ["Person X", "Person W", "Person MZ"]) await expect(box(page, t)).toHaveCount(0);
  await shot(page, "house");
});

test("Project settings: the house field", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("button", { name: "Project settings" }).click();
  await page.getByLabel("House field").selectOption("Dynasty");
  await page.getByRole("button", { name: "Done" }).click();
  const stored = await page.evaluate(() => (window as any).__mock.projects.get("Project A").settings.familyTree);
  expect(stored.house).toBe("Dynasty");
});


/** The index of the line between two boxes (a couple, or a child's line). */
async function lineBetween(page: Page, a: string, b: string, kind: "couple" | "child") {
  return page.evaluate(
    ([a, b, kind]) => {
      const l = (window as any).__familyTree.layout;
      const key = (t: string) => l.boxes.find((x: any) => x.box.kind !== "stub" && x.key === `n${x.box.person}` && document.querySelector(`[data-key="${x.key}"]`)?.getAttribute("data-name") === t)?.key;
      return l.lines.findIndex((x: any) => x.select === kind && x.people.includes(key(a)) && x.people.includes(key(b)));
    },
    [a, b, kind] as const,
  );
}

/** Clicks a line where it is (a straight line's box has no height, which Playwright counts as hidden). */
async function clickLine(page: Page, index: number) {
  const r = await page.locator(`[data-line="${index}"]`).evaluate((el) => {
    const path = el as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() * 0.75);
    const m = path.getScreenCTM()!;
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  });
  await page.mouse.click(r.x, r.y);
}

test("a click selects a person; the bar opens the page, shows their tree, and a double-click opens", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await box(page, "Person H").click();
  const bar = page.getByRole("toolbar", { name: "Selected" });
  await expect(bar).toContainText("Person H");
  await expect(box(page, "Person H")).toHaveClass(/selected/);
  await shot(page, "selected");
  await bar.getByRole("button", { name: "Show their tree" }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person H");
  await expect(bar).toHaveCount(0);
  await box(page, "Person U").dblclick();
  await expect(page.locator(".page-head h1")).toHaveText("Person U");
});

test("Add parent, child and partner write the right pages", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  const bar = page.getByRole("toolbar", { name: "Selected" });
  const dialog = page.getByRole("dialog");
  // A child: Page A gets Person F as its Father (a new field on Page A).
  await box(page, "Person F").click();
  await bar.getByRole("button", { name: "Add child…" }).click();
  await dialog.getByLabel("Child").fill("Page A");
  await expect(dialog).toContainText("Person F is Page A's:");
  await shot(page, "add-child");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  expect((await storedPage(page, "Page A.md")).infobox.fields).toEqual([{ label: "Father", type: "links", value: ["Person F"] }]);
  await expect(box(page, "Page A")).toHaveCount(1);
  // A parent: into Person W's own page.
  await box(page, "Person W").click();
  await bar.getByRole("button", { name: "Add parent…" }).click();
  await dialog.getByLabel("Parent").fill("Page A");
  await expect(dialog).toContainText("Page A is Person W's:");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  expect((await storedPage(page, "Person W.md")).infobox.fields).toContainEqual({ label: "Father", type: "links", value: ["Page A"] });
  // A partner: into Person K's page, as Lover.
  await box(page, "Person K").click();
  await bar.getByRole("button", { name: "Add partner…" }).click();
  await dialog.getByLabel("Partner").fill("Person I");
  await dialog.getByLabel("Lover").check();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  expect((await storedPage(page, "Person K.md")).infobox.fields).toContainEqual({ label: "Lover", type: "links", value: ["Person I"] });
});

test("selecting a line removes the relations behind it (after asking)", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  const bar = page.getByRole("toolbar", { name: "Selected" });
  // The couple Person F and Person M: the link is on both pages.
  const couple = await lineBetween(page, "Person F", "Person M", "couple");
  await clickLine(page, couple);
  await expect(bar).toContainText("Person F and Person M");
  await expect(page.locator(".tree-line.selected")).toHaveCount(1);
  await bar.getByRole("button", { name: "Remove…" }).click();
  await expect(page.getByRole("dialog")).toContainText("This changes Person F, Person M's page");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const spouse = async (id: string) => (await storedPage(page, id)).infobox.fields.find((f: Field) => f.label === "Spouse")?.value;
  await expect.poll(() => spouse("Person F.md")).toBeUndefined();
  expect(await spouse("Person M.md")).toBeUndefined();
  // A child's line: Person K's Father and Mother links.
  const kid = await lineBetween(page, "Person L", "Person K", "child");
  await clickLine(page, kid);
  await bar.getByRole("button", { name: "Remove…" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(async () => (await storedPage(page, "Person K.md")).infobox.fields.flatMap((f: Field) => f.value ?? [])).toEqual([]);
});

test("New person… creates a page and shows it in the middle", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  await page.getByRole("button", { name: "New person…" }).click();
  const dialog = page.getByRole("dialog", { name: "New person" });
  await dialog.getByLabel("Page title").fill("Person New");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".tree-box.centre")).toContainText("Person New");
  await expect(page.getByRole("heading", { name: "Family tree", level: 1 })).toBeVisible();
});

test("Save image writes the whole tree as PNG or SVG", async ({ page }) => {
  await openProject(page, data());
  await openTree(page);
  const saved = () => page.evaluate(() => (window as any).__mock.savedImages.map((x: any) => ({ path: x.path, head: x.bytes.slice(0, 8), size: x.bytes.length })));
  await page.evaluate(() => (window as any).__mock.setNextSave("/Out/Tree.svg"));
  await page.getByRole("button", { name: "Save image…" }).click();
  await expect.poll(saved).toHaveLength(1);
  const svg = await page.evaluate(() => String.fromCharCode(...(window as any).__mock.savedImages[0].bytes));
  expect(svg).toContain("<svg");
  // Every person, not only those on screen; no clickable helper lines; theme colours written in.
  for (const t of ["Person GA", "Person X", "Person MZ"]) expect(svg).toContain(t);
  expect(svg).not.toContain("data-line");
  expect(svg).toContain("stroke:rgb(");
  // Pictures are in the file itself.
  expect(svg).toContain('href="data:image/png');
  await page.evaluate(() => (window as any).__mock.setNextSave("/Out/Tree"));
  await page.getByRole("button", { name: "Save image…" }).click();
  await expect.poll(saved).toHaveLength(2);
  const png = (await saved())[1];
  expect(png.path).toBe("/Out/Tree.png");
  expect(png.head.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(png.size).toBeGreaterThan(5000);
});
