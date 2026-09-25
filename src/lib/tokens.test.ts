import { describe, expect, it } from "vitest";
import css from "@/app/index.css?raw";
import { accentShades, contrastRatio } from "@/lib/contrast";
import { ACCENT_PRESETS, customProperties } from "@/lib/designTokens";

/** DESIGN.md's contrast obligations and the token blocks' parity, read from the stylesheet the app ships. */

// A `?raw` glob for the files outside `src/`, since the tsconfig knows no Node API.
const OUTSIDE = {
  ...(import.meta.glob("/index.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("/src-tauri/tauri.conf.json", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >),
};

const blocks = customProperties(css);
const base = blocks.get("@theme static")!;
const root = blocks.get(":root")!;
const light = blocks.get(':root[data-theme="light"]')!;

/** A theme's colour by token name: the light block over the base, as the cascade resolves it. */
const colour = (theme: "dark" | "light", name: string): string =>
  (theme === "light" ? light.get(`--color-${name}`) : undefined) ?? base.get(`--color-${name}`)!;

/** The colours a theme swaps; status and accent are set at runtime and never live in a theme block. */
const THEMED = /^--color-(surface|ink|gold|danger|success|graph)-?/;
/** Root values `stores/theme` writes inline per accent, so no theme block carries them. */
const RUNTIME = new Set(["--accent-rgb", "--w1", "--w2", "--hair"]);
/** Accents past the presets: the corners of the colour cube and a mid grey, where a derivation is most likely to break. */
const EXTREMES = ["#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#ffff00"];

describe("token blocks", () => {
  it("finds the blocks the rest of this file reads", () => {
    expect(base.size).toBeGreaterThan(20);
    expect(root.has("--scrim")).toBe(true);
    expect(light.has("--color-surface-950")).toBe(true);
  });

  it("gives every themed colour a light twin, and the light theme nothing the base lacks", () => {
    const themed = [...base.keys()].filter((k) => THEMED.test(k));
    expect(themed.filter((k) => !light.has(k))).toEqual([]);
    const known = new Set([...base.keys(), ...root.keys()]);
    expect([...light.keys()].filter((k) => !known.has(k))).toEqual([]);
  });

  it("gives every root value the theme does not write at runtime a light twin", () => {
    expect([...root.keys()].filter((k) => !RUNTIME.has(k) && !light.has(k))).toEqual([]);
  });
});

describe("contrast obligations", () => {
  for (const theme of ["dark", "light"] as const) {
    it(`reads primary and secondary ink on every surface in ${theme}`, () => {
      for (const ink of ["ink-100", "ink-300"]) {
        for (const surface of ["surface-950", "surface-900", "surface-850", "surface-800"]) {
          expect(contrastRatio(colour(theme, ink), colour(theme, surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`reads muted and label ink on the page and a panel in ${theme}`, () => {
      for (const ink of ["ink-500", "ink-600"]) {
        for (const surface of ["surface-950", "surface-900"]) {
          expect(contrastRatio(colour(theme, ink), colour(theme, surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`reads accent text on the page for every preset and extreme in ${theme}`, () => {
      const page = colour(theme, "surface-950");
      const panel = colour(theme, "surface-900");
      for (const hex of [...ACCENT_PRESETS, ...EXTREMES]) {
        const { a400 } = accentShades(hex, { light: theme === "light", surface950: page, surface900: panel });
        expect(contrastRatio(a400, page), hex).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  // The presets that fall short today, exactly: a new shortfall fails, and so does a fix that leaves its entry here.
  const SHORT = {
    inkOnFill: { dark: [] as string[], light: ["#46a5b3", "#f56c92"] },
    fillOffPanel: { dark: ["#4b3fc7"], light: ["#e8d48a"] },
  };
  for (const theme of ["dark", "light"] as const) {
    const shades = (hex: string) =>
      accentShades(hex, { light: theme === "light", surface950: colour(theme, "surface-950"), surface900: colour(theme, "surface-900") });

    it(`reads accent-ink on the fill at 4.5:1 in ${theme}, the known shortfalls aside`, () => {
      const short = ACCENT_PRESETS.filter((hex) => contrastRatio(shades(hex).ink, shades(hex).a500) < 4.5);
      expect(short).toEqual(SHORT.inkOnFill[theme]);
    });

    it(`keeps the accent fill 3:1 off the panel in ${theme}, the known shortfalls aside`, () => {
      const short = ACCENT_PRESETS.filter((hex) => contrastRatio(shades(hex).a500, colour(theme, "surface-900")) < 3);
      expect(short).toEqual(SHORT.fillOffPanel[theme]);
    });
  }
});

describe("the frame around the stylesheet", () => {
  const html = OUTSIDE["/index.html"];
  const conf = JSON.parse(OUTSIDE["/src-tauri/tauri.conf.json"]) as {
    app: { windows: { backgroundColor?: string }[]; security: { csp: string } };
  };

  it("paints the native window in the dark page colour, so the first frame does not flash", () => {
    for (const w of conf.app.windows) expect(w.backgroundColor?.toLowerCase()).toBe(colour("dark", "surface-950"));
  });

  // Tauri injects nonces only when the page carries inline style; one would silently block every library-injected tag.
  it("keeps index.html free of inline style and inline script", () => {
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("keeps the CSP's style-src open to inline style and its script-src closed to it", () => {
    const directive = (name: string) => new RegExp(`${name} ([^;]*)`).exec(conf.app.security.csp)?.[1] ?? "";
    expect(directive("style-src")).toContain("'unsafe-inline'");
    expect(directive("script-src")).not.toMatch(/'unsafe-(inline|eval)'/);
  });
});
