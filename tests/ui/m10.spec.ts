// M10: the Search screen (word starts, ranking, filters, spoilers following
// the eye switch, opening at the match, Back), and find on page.
import { expect, test, type Page } from "@playwright/test";
import { oneProject, openProject } from "./fixtures";
import { TEMPLATE } from "./fixtures-data";
import type { MockPage } from "./mock/backend";

const PAGES: MockPage[] = [
  {
    id: "Group A/Page A.md",
    title: "Page A",
    categories: ["Category A"],
    body: "Intro about Examples and [[Page B|the other one]].\n\n## Early part\n\nAn example word and ||secret example|| here.\n\n## Later part\n\nMore text.\n",
    infobox: {
      template: TEMPLATE.id,
      fields: [
        { key: "f-txt", label: "Example field", type: "text", value: "Field example value" },
        { key: "f-date", label: "Date field", type: "date", value: { year: 250 } },
      ],
    },
  },
  { id: "Page B.md", title: "Page B", body: "Nothing to see. Ample words here." },
  { id: "Example title page.md", title: "Example title page", body: "Plain." },
  {
    id: "Page S.md",
    title: "Page S",
    body: "Only ||hiddenword|| in here.",
    infobox: { fields: [{ label: "Secret field", type: "text", value: "Fieldsecret", spoiler: true }] },
  },
];

const data = () => oneProject(PAGES, { templates: [TEMPLATE], groups: ["Group A"], mainPage: "Page B" });
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/m10-${name}.png` });
const results = (page: Page) => page.locator(".search-result .search-title");
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search", exact: true });
const highlights = (page: Page, name = "find") => page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name);

async function searchFor(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await searchBox(page).fill(query);
}

test("search matches word starts, lists titles first, and filters", async ({ page }) => {
  await openProject(page, data());
  await searchFor(page, "exam");
  await expect(results(page)).toHaveText(["Example title page", "Page A"]);
  // Where the matches are, with the words marked.
  const a = page.locator(".search-result").filter({ hasText: "Page A" });
  await expect(a.locator(".search-place-name")).toHaveText(["Infobox: Example field", "Text", "Section: Early part"]);
  await expect(a.locator(".search-snippet mark").first()).toHaveText("exam");
  await expect(page.locator(".search-result").first().locator(".search-title mark")).toHaveText("Exam");
  await shot(page, "search");

  // Inside a word: no match. All words must be on the page.
  await searchBox(page).fill("ample");
  await expect(results(page)).toHaveText(["Page B"]);
  await searchBox(page).fill("exam later");
  await expect(results(page)).toHaveText(["Page A"]);
  await searchBox(page).fill('"words here"');
  await expect(results(page)).toHaveText(["Page B"]);
  await searchBox(page).fill('"here words"');
  await expect(page.getByText("No pages match.")).toBeVisible();

  // Filters: group, category, template.
  await searchBox(page).fill("exam");
  await page.getByRole("combobox", { name: "Group", exact: true }).selectOption({ label: " Group A" });
  await expect(results(page)).toHaveText(["Page A"]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("Category A");
  await expect(results(page)).toHaveText(["Page A"]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("combobox", { name: "Template", exact: true }).selectOption({ label: "Template A" });
  await expect(results(page)).toHaveText(["Page A"]);
});

test("spoilers are searched only while the eye switch is on", async ({ page }) => {
  await openProject(page, data());
  await searchFor(page, "hiddenword");
  await expect(page.getByText("No pages match.")).toBeVisible();
  await searchBox(page).fill("fieldsecret");
  await expect(page.getByText("No pages match.")).toBeVisible();
  // A snippet next to a spoiler leaves its text out.
  await searchBox(page).fill("only");
  await expect(results(page)).toHaveText(["Page S"]);
  await expect(page.locator(".search-snippet .search-spoiler-hidden")).toHaveCount(1);
  await expect(page.locator(".search-snippet")).not.toContainText("hiddenword");

  await page.getByRole("button", { name: "Show all spoilers" }).click();
  await expect(page.locator(".search-snippet .search-spoiler")).toHaveText("hiddenword");
  await searchBox(page).fill("hiddenword");
  await expect(results(page)).toHaveText(["Page S"]);
  await expect(page.locator(".search-snippet .search-spoiler mark")).toHaveText("hiddenword");
  await searchBox(page).fill("fieldsecret");
  await expect(page.locator(".search-place-name")).toHaveText("Infobox: Secret field");
  await shot(page, "search-spoilers-on");
});

test("a result opens at the match with the find bar; Back returns to the results", async ({ page }) => {
  await openProject(page, data());
  await searchFor(page, "exam");
  await results(page).filter({ hasText: "Page A" }).click();
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  const find = page.getByRole("textbox", { name: "Find on page" });
  await expect(find).toHaveValue("exam");
  // Infobox label and value, "Examples", "example" (the spoiler stays out while hidden).
  await expect(page.locator(".find-count")).toHaveText("1 of 4");
  expect(await highlights(page)).toBe(4);
  expect(await highlights(page, "find-current")).toBe(1);
  await find.press("Enter");
  await expect(page.locator(".find-count")).toHaveText("2 of 4");
  await find.press("Shift+Enter");
  await find.press("Shift+Enter");
  await expect(page.locator(".find-count")).toHaveText("4 of 4");
  await shot(page, "find-from-search");

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(searchBox(page)).toHaveValue("exam");
  await expect(results(page)).toHaveText(["Example title page", "Page A"]);
});

test("the sidebar's search box opens the Search screen", async ({ page }) => {
  await openProject(page, data());
  await page.getByRole("searchbox", { name: "Search the project" }).fill("ample");
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(results(page)).toHaveText(["Page B"]);
  await page.keyboard.type(" words");
  await expect(searchBox(page)).toHaveValue("ample words");
  await expect(results(page)).toHaveText(["Page B"]);
});

test("find on page: Cmd+F, next and previous, links by target, hidden spoilers, Escape", async ({ page }) => {
  await openProject(page, data());
  await page.locator(".sidebar").getByText("Group A", { exact: true }).click();
  await page.locator(".sidebar").getByText("Page A", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Page A", level: 1 })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+F");
  const find = page.getByRole("textbox", { name: "Find on page" });
  await expect(find).toBeFocused();
  await find.fill("part");
  await expect(page.locator(".find-count")).toHaveText("1 of 2");
  await find.fill("zzz");
  await expect(page.locator(".find-count")).toHaveText("No matches");
  // A link matches by the page it points to.
  await find.fill('"page b"');
  await expect(page.locator(".find-count")).toHaveText("1 of 1");
  // Spoilers: matched only once revealed.
  await find.fill("secret");
  await expect(page.locator(".find-count")).toHaveText("No matches");
  await page.getByRole("button", { name: "Reveal spoilers" }).click();
  await expect(page.locator(".find-count")).toHaveText("1 of 1");
  await find.fill("example");
  await expect(page.locator(".find-count")).toHaveText("1 of 5");
  await shot(page, "find-bar");
  await find.press("Escape");
  await expect(find).toBeHidden();
  expect(await highlights(page)).toBe(0);
});
