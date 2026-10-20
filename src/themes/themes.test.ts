import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, builtinTheme } from "./builtin";
import { mix, parseColor, readableOn, toHex6, withAlpha } from "./color";
import { cssFor, effectiveValue, firstFamily, followsWhat, fontStack, resolveVars, scopedFamily } from "./engine";
import { ALL_COLORS, DEFAULTS, MAIN_SETTINGS } from "./vars";

describe("colours", () => {
  it("reads and mixes CSS colours", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgb(47 95 208 / 0.14)")).toEqual({ r: 47, g: 95, b: 208, a: 0.14 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("var(--x)")).toBeNull();
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(withAlpha("#2f5fd0", 0.22)).toBe("rgb(47 95 208 / 0.22)");
    expect(readableOn("#102030")).toBe("#ffffff");
    expect(readableOn("#cedff2")).toBe("#202122");
    expect(toHex6("rgb(47 95 208 / 0.2)")).toBe("#2f5fd0");
  });
});

describe("theme variables", () => {
  it("come from theme.css, references kept", () => {
    expect(DEFAULTS["--bg"]).toBe("#ffffff");
    expect(DEFAULTS["--page-bg"]).toBe("var(--bg)");
    expect(DEFAULTS["--tooltip-bg"]).toBeTruthy();
    // Every setting the editor offers is a real variable.
    for (const name of [...MAIN_SETTINGS.flatMap((g) => g.settings.map((s) => s.name)), ...ALL_COLORS.flatMap((g) => g.vars.map((v) => v[0]))]) {
      expect(DEFAULTS[name], name).toBeDefined();
    }
  });

  it("an unchanged theme sets nothing", () => {
    expect(resolveVars({}).changed).toEqual({});
    expect(builtinTheme("builtin:default")?.vars).toEqual({});
  });

  it("colours follow a changed main setting", () => {
    const { changed } = resolveVars({ "--bg": "#202020", "--text": "#eeeeee" });
    expect(changed["--bg-hover"]).toBe(mix("#202020", "#eeeeee", 0.08));
    expect(changed["--border"]).toBeDefined();
    // The page text follows the app text; headings follow the page text.
    expect(changed["--page-text"]).toBe("#eeeeee");
    expect(changed["--heading-color"]).toBe("#eeeeee");
    // References need no copy: the page background follows through var(--bg).
    expect(changed["--page-bg"]).toBeUndefined();
    expect(effectiveValue(resolveVars({ "--bg": "#202020" }), "--page-bg")).toBe("#202020");
    // Only what follows a changed setting is computed.
    expect(changed["--link"]).toBeUndefined();
  });

  it("the theme's own value wins over a computed one", () => {
    const { changed } = resolveVars({ "--accent": "#123456", "--accent-text": "#ff0000" });
    expect(changed["--accent-text"]).toBe("#ff0000");
    expect(changed["--drop"]).toBe("rgb(18 52 86 / 0.14)");
  });

  it("title bar text stays readable, also in embed boxes", () => {
    const { changed } = resolveVars({ "--infobox-header-bg": "#102030" });
    expect(changed["--infobox-header-text"]).toBe("#ffffff");
    expect(changed["--navbox-title-text"]).toBe("#ffffff");
  });

  it("unknown variables are ignored", () => {
    expect(resolveVars({ "--nothing": "#000", color: "red" }).changed).toEqual({});
  });

  it("knows what a variable follows", () => {
    expect(followsWhat("--page-bg")).toBe("--bg");
    expect(followsWhat("--bg-hover")).toBe("--bg");
    expect(followsWhat("--link")).toBeNull();
  });

  it("theme fonts get their own family names", () => {
    const css = cssFor(":root", { "--font-body": fontStack("Font A", "--font-body"), "--bg": "#fff" }, [
      { family: "Font A", file: "Font A.ttf", weight: "400", style: "normal" },
    ], "app:Theme A");
    expect(css).toMatch(/--font-body: "ThemeFont[0-9a-z]+", -apple-system/);
    expect(css).toContain("--bg: #fff;");
    expect(firstFamily('"Font A", serif')).toBe("Font A");
    // One plain word (WebKit's FontFace refuses other names), different per theme and family.
    expect(scopedFamily("3D Font-A (x)", "app:Theme A")).toMatch(/^ThemeFont[0-9a-z]+$/);
    expect(scopedFamily("Font A", "app:Theme A")).not.toBe(scopedFamily("Font B", "app:Theme A"));
    expect(scopedFamily("Font A", "app:Theme A")).not.toBe(scopedFamily("Font A", "app:Theme B"));
  });

  it("built-in themes only set known variables", () => {
    for (const t of BUILTIN_THEMES) {
      for (const k of Object.keys(t.data.vars)) expect(DEFAULTS[k], `${t.id} ${k}`).toBeDefined();
    }
  });
});
