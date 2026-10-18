// Shared setup for the UI tests: start the app on given data and answer image requests.
import { expect, type Page } from "@playwright/test";
import type { Fixture, MockPage } from "./mock/backend";

export const PROJECT = "Project A";

/** One project with the given pages (placeholder data only). */
export function oneProject(pages: MockPage[], extra: Partial<NonNullable<Fixture["projects"]>[number]> = {}): Fixture {
  return { projects: [{ id: PROJECT, name: PROJECT, mainPage: null, pages, ...extra }] };
}

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8aa"/><circle cx="400" cy="300" r="150" fill="#cdd"/></svg>`;

/** Opens the app (library screen) with `fixture` as the backend's data. */
export async function startApp(page: Page, fixture: Fixture) {
  await page.addInitScript((f) => ((window as any).__MOCK_FIXTURE__ = f), fixture);
  await page.route("**/mock-assets/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: PICTURE }));
  await page.goto("/tests/ui/harness.html");
}

/** Opens the app straight into the project. */
export async function openProject(page: Page, fixture: Fixture, name = PROJECT) {
  await startApp(page, fixture);
  await page.getByText(name, { exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
}

/** A page as the in-memory backend holds it now (to check what the app saved). */
export function storedPage(page: Page, id: string) {
  return page.evaluate(([p, id]) => {
    const pg = (window as any).__mock.projects.get(p).pages.get(id);
    return pg ? JSON.parse(JSON.stringify(pg)) : null;
  }, [PROJECT, id]);
}
