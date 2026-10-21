// Helpers for the graph tests (M11): the graphs are drawn on a canvas, so the
// tests look at them through the controllers the app exposes while testing.
import { expect, type Page } from "@playwright/test";
import type { GraphController } from "../../src/graph/controller";

declare global {
  interface Window {
    __graph?: GraphController;
    __localGraph?: GraphController;
  }
}

export type Which = "__graph" | "__localGraph";

/** Waits until the graph has come to rest once (it keeps drifting gently after). */
export async function settled(page: Page, which: Which = "__graph") {
  await expect
    .poll(() => page.evaluate((w) => (window[w]?.settled && !window[w]!.sigma.getCamera().isAnimated()) ?? false, which), { timeout: 15000 })
    .toBe(true);
}

export const position = (page: Page, key: string, which: Which = "__graph") =>
  page.evaluate(([k, w]) => [window[w as Which]!.graph.getNodeAttribute(k, "x"), window[w as Which]!.graph.getNodeAttribute(k, "y")], [key, which]);

/** The middle of a node on screen. */
export async function nodeAt(page: Page, key: string, which: Which = "__graph") {
  const r = await page.evaluate(([k, w]) => {
    const rect = window[w as Which]?.nodeRect(k);
    return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, [key, which]);
  if (!r) throw new Error(`no node ${key}`);
  return r;
}

/** The colour a node is drawn in now. */
export const nodeColor = (page: Page, key: string, which: Which = "__graph") =>
  page.evaluate(([k, w]) => window[w as Which]!.sigma.getNodeDisplayData(k)?.color, [key, which]);

/** The nodes shown, by key. */
export const nodes = (page: Page, which: Which = "__graph") => page.evaluate((w) => window[w]!.graph.nodes().sort(), which);

export async function openGraph(page: Page) {
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();
  await settled(page);
}
