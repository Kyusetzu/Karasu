import { describe, expect, it } from "vitest";
import css from "@/app/index.css?raw";
import { accentShades, contrastRatio, mix } from "@/lib/contrast";
import { ACCENT_PRESETS, DEFAULT_ACCENT, customProperties } from "@/lib/designTokens";
import { DEFAULT_STATUS_COLORS } from "@/lib/statusColors";

/** DESIGN.md's contrast obligations and the token blocks' parity, read from the stylesheet the app ships. */

// A `?raw` glob for the files outside `src/`, since the tsconfig knows no Node API.
const OUTSIDE = {
  ...(import.meta.glob("/index.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("/src-tauri/tauri.conf.json", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >),
  ...(import.meta.glob(
    [
      "/src-tauri/gen/android/app/src/main/res/{drawable/karasu_widget_bg,layout/karasu_widget,values/styles_widgets}.xml",
      "/src-tauri/gen/android/app/src/main/java/dev/kyu/karasu/MainActivity.kt",
    ],
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>),
};

const blocks = customProperties(css);
const base = blocks.get("@theme static")!;
const root = blocks.get(":root")!;
const light = blocks.get(':root[data-theme="light"]')!;
const hcDark = blocks.get(':root[data-contrast="more"]')!;
const hcLight = blocks.get(':root[data-contrast="more"][data-theme="light"]')!;

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

  it("writes every themed colour as hex, the one form the contrast checks can measure", () => {
    for (const block of [base, light, hcDark, hcLight]) {
      const bad = [...block].filter(([k, v]) => THEMED.test(k) && !/^#[0-9a-f]{6}$/i.test(v)).map(([k]) => k);
      expect(bad).toEqual([]);
    }
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

    it(`reads the label on a gold fill at 4.5:1 in ${theme}`, () => {
      expect(contrastRatio(colour(theme, "gold-ink"), colour(theme, "gold"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps the accent fill 3:1 off the panel in ${theme}, the known shortfalls aside`, () => {
      const short = ACCENT_PRESETS.filter((hex) => contrastRatio(shades(hex).a500, colour(theme, "surface-900")) < 3);
      expect(short).toEqual(SHORT.fillOffPanel[theme]);
    });
  }
});

/** A high-contrast colour: the setting's own block over the theme's, as the cascade resolves it. */
const high = (theme: "dark" | "light", name: string): string =>
  (theme === "light" ? hcLight.get(`--color-${name}`) : undefined) ?? hcDark.get(`--color-${name}`) ?? colour(theme, name);

describe("high contrast", () => {
  it("gives both high-contrast blocks every surface and ink, and the light one its own semantic colours", () => {
    const steps = [...base.keys()].filter((k) => /^--color-(surface|ink)-/.test(k));
    expect(steps.filter((k) => !hcDark.has(k))).toEqual([]);
    expect(steps.filter((k) => !hcLight.has(k))).toEqual([]);
    expect(["--color-gold", "--color-danger", "--color-success"].filter((k) => !hcLight.has(k))).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    it(`reads every ink at 7:1 on the surfaces it sits on, in ${theme}`, () => {
      const pairs = [
        ...["ink-100", "ink-300"].flatMap((i) => ["surface-950", "surface-900", "surface-850", "surface-800"].map((s) => [i, s])),
        ...["ink-500", "ink-600"].flatMap((i) => ["surface-950", "surface-900"].map((s) => [i, s])),
        ...["gold", "danger", "success"].map((i) => [i, "surface-900"]),
      ];
      for (const [ink, surface] of pairs) {
        expect(contrastRatio(high(theme, ink), high(theme, surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(7);
      }
    });

    it(`reads the label on a gold fill at 7:1, in ${theme}`, () => {
      expect(contrastRatio(high(theme, "gold-ink"), high(theme, "gold"))).toBeGreaterThanOrEqual(7);
    });

    it(`draws the border role at 3:1 against a panel and the page, in ${theme}`, () => {
      for (const surface of ["surface-950", "surface-900", "surface-850"]) {
        expect(contrastRatio(high(theme, "surface-600"), high(theme, surface)), surface).toBeGreaterThanOrEqual(3);
      }
    });

    it(`lifts accent text and the fill's label to 7:1 for every preset and extreme, in ${theme}`, () => {
      const page = high(theme, "surface-950");
      const panel = high(theme, "surface-900");
      for (const hex of [...ACCENT_PRESETS, ...EXTREMES]) {
        const s = accentShades(hex, { light: theme === "light", contrast: "high", surface950: page, surface900: panel });
        expect(contrastRatio(s.a400, page), `${hex} text`).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(s.ink, s.a500), `${hex} label`).toBeGreaterThanOrEqual(7);
      }
    });
  }
});

describe("the tint fill", () => {
  const block = (start: string) => css.slice(css.indexOf(start), css.indexOf("\n}", css.indexOf(start)));
  const shares = (text: string, over: string) =>
    [...text.matchAll(new RegExp(String.raw`var\(--tint\) (\d+)%, var\(--color-${over}\)`, "g"))].map((m) => Number(m[1]) / 100);
  const panel = shares(block("@utility tint-fill {"), "surface-900");
  const cover = block("@utility tint-fill-on-cover {");
  const [coverFill] = shares(cover, "on-cover");
  const [coverGlyph] = shares(cover, "on-cover-edge");

  it("reads the shares it grades from the utilities themselves", () => {
    expect(panel.length).toBe(2);
    expect(coverFill).toBeGreaterThan(0);
    expect(coverGlyph).toBeGreaterThan(0);
  });

  for (const theme of ["dark", "light"] as const) {
    const page = colour(theme, "surface-950");
    const surface = colour(theme, "surface-900");
    const accents = [...ACCENT_PRESETS, ...EXTREMES].map((hex) => accentShades(hex, { light: theme === "light", surface950: page, surface900: surface }));

    it(`keeps the status button's label and progress readable on every status tint, resting and hovered, in ${theme}`, () => {
      for (const tint of Object.values(DEFAULT_STATUS_COLORS)) {
        for (const share of panel) {
          const fill = mix(surface, tint, share);
          for (const ink of ["ink-100", "ink-300"]) {
            expect(contrastRatio(colour(theme, ink), fill), `${ink} on ${tint} at ${share}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    });

    it(`keeps a main button's label readable on the accent tint for every preset and extreme, in ${theme}`, () => {
      for (const { a500 } of accents) {
        for (const share of panel) {
          expect(contrastRatio(colour(theme, "ink-100"), mix(surface, a500, share)), `${a500} at ${share}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`keeps the +1 glyph at 3:1 on its own accent tint for every preset and extreme, in ${theme}`, () => {
      for (const { a400, a500 } of accents) {
        for (const share of panel) {
          expect(contrastRatio(a400, mix(surface, a500, share)), `${a500} at ${share}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }

  it("draws the rim in ink in high contrast, where the raw tint fell under the 3:1 border obligation", () => {
    const fill = block("@utility tint-fill {");
    expect(fill).toMatch(/:root\[data-contrast="more"\] & \{\s*background-color: var\(--color-surface-900\);\s*border-color: var\(--color-ink-100\);/);
    for (const theme of ["dark", "light"] as const) {
      expect(contrastRatio(high(theme, "ink-100"), high(theme, "surface-900")), theme).toBeGreaterThanOrEqual(3);
    }
  });

  it("marks a chosen tint by a fill and a doubled rim in high contrast, and by the system highlight in forced colours", () => {
    const fill = block("@utility tint-fill {");
    expect(fill).toMatch(
      /:root\[data-contrast="more"\] &\[aria-pressed="true"\] \{\s*background-color: var\(--color-surface-800\);\s*box-shadow: inset 0 0 0 1px var\(--color-ink-100\);/,
    );
    expect(fill).toMatch(/@media \(forced-colors: active\) \{\s*&\[aria-pressed="true"\] \{\s*forced-color-adjust: none;\s*background-color: Highlight;/);
  });

  it("keeps every hover of the tint behind a real pointer, so a tap on a phone does not leave it lit", () => {
    const fill = block("@utility tint-fill {");
    const bare = fill.split("\n").filter((line, i, all) => /&:hover/.test(line) && !/@media \(hover: hover\)/.test(all[i - 1] ?? ""));
    expect(bare).toEqual([]);
  });

  it("rims the accent in its text shade in high contrast, the one already held to 7:1 on the page", () => {
    expect(block("@utility tint-accent {")).toMatch(/:root\[data-contrast="more"\] & \{\s*--tint: var\(--color-accent-400\);/);
  });

  // The accent tint is the theme's own shade, the fill shade in standard contrast and the text shade in high.
  for (const theme of ["dark", "light"] as const) {
    for (const contrast of ["standard", "high"] as const) {
      it(`keeps a cover control's tinted glyph at 4.5:1 on its tinted near-black, for every tint, in ${theme} ${contrast}`, () => {
        const base = colour("dark", "on-cover");
        const edge = colour("dark", "on-cover-edge");
        const read = contrast === "high" ? high : colour;
        const accents = [...ACCENT_PRESETS, ...EXTREMES].map((hex) => {
          const s = accentShades(hex, { light: theme === "light", contrast, surface950: read(theme, "surface-950"), surface900: read(theme, "surface-900") });
          return contrast === "high" ? s.a400 : s.a500;
        });
        for (const tint of [...Object.values(DEFAULT_STATUS_COLORS), ...accents]) {
          expect(contrastRatio(mix(edge, tint, coverGlyph), mix(base, tint, coverFill)), tint).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe("the theme picker's miniatures", () => {
  it("draws each theme in its own page, panel and ink, whichever theme is showing", () => {
    for (const block of [light, hcDark, hcLight]) expect([...block.keys()].filter((k) => k.startsWith("--color-preview-"))).toEqual([]);
    for (const theme of ["dark", "light"] as const) {
      expect(colour("dark", `preview-${theme}-page`), theme).toBe(colour(theme, theme === "dark" ? "surface-950" : "surface-850"));
      expect(colour("dark", `preview-${theme}-panel`), theme).toBe(colour(theme, theme === "dark" ? "surface-850" : "surface-900"));
      expect(colour("dark", `preview-${theme}-ink`), theme).toBe(colour(theme, "ink-100"));
    }
  });
});

describe("cover art", () => {
  // The lightest plate a coloured mark sits on is the action circle's, and white art is the worst case under it.
  it("keeps each colour over cover art one bright value in every theme, at 4.5:1 on the lightest plate over white", () => {
    const plate = mix("#ffffff", colour("dark", "on-cover"), 0.86);
    for (const name of ["on-cover-gold", "on-cover-danger", "on-cover-success"]) {
      for (const block of [light, hcDark, hcLight]) expect(block.has(`--color-${name}`), name).toBe(false);
      expect(contrastRatio(colour("dark", name), plate), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("turns glass over cover art solid near-black in high contrast, not the page's panel colour", () => {
    expect(css).toMatch(
      /:root\[data-contrast="more"\] \[class\*="backdrop-blur"\]\[class\*="on-cover"\] \{\s*background-color: var\(--color-on-cover\);/,
    );
  });

  it("keeps a tinted label on cover art at 4.5:1 over white art, for every accent in every theme and contrast", () => {
    const label = css.slice(css.indexOf("@utility tint-label-on-cover {"), css.indexOf("\n}", css.indexOf("@utility tint-label-on-cover {")));
    const plate = Number(/var\(--color-on-cover\) (\d+)%, transparent/.exec(label)![1]) / 100;
    const glyph = Number(/var\(--tint\) (\d+)%, var\(--color-on-cover-edge\)/.exec(label)![1]) / 100;
    const ground = mix("#ffffff", colour("dark", "on-cover"), plate);
    for (const theme of ["dark", "light"] as const) {
      for (const contrast of ["standard", "high"] as const) {
        const read = contrast === "high" ? high : colour;
        for (const hex of [...ACCENT_PRESETS, ...EXTREMES]) {
          const s = accentShades(hex, { light: theme === "light", contrast, surface950: read(theme, "surface-950"), surface900: read(theme, "surface-900") });
          const tint = contrast === "high" ? s.a400 : s.a500;
          expect(contrastRatio(mix(colour("dark", "on-cover-edge"), tint, glyph), ground), `${hex} ${theme} ${contrast}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("focus inside a clipping frame", () => {
  it("draws the inset ring inside the control in high contrast and forced colours too, where the ring is thicker", () => {
    expect(css).toMatch(/:root\[data-contrast="more"\] \.focus-inset:focus-visible \{\s*outline-offset: -3px;/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{[^@]*\.focus-inset:focus-visible \{\s*outline-offset: -3px;/);
  });
});

describe("the frame around the stylesheet", () => {
  const html = OUTSIDE["/index.html"];
  const conf = JSON.parse(OUTSIDE["/src-tauri/tauri.conf.json"]) as {
    app: { windows: { backgroundColor?: string }[]; security: { csp: string } };
  };

  it("paints the native window in the dark page colour, so the first frame does not flash", () => {
    for (const w of conf.app.windows) expect(w.backgroundColor?.toLowerCase()).toBe(colour("dark", "surface-950"));
  });

  it("paints the Android activity and the home-screen widgets in the dark tokens, which they cannot read at runtime", () => {
    const res = "/src-tauri/gen/android/app/src/main/res";
    const hexes = (file: string) => [...file.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
    const bg = hexes(OUTSIDE[`${res}/drawable/karasu_widget_bg.xml`]);
    expect(bg).toEqual([colour("dark", "surface-950"), colour("dark", "surface-800")]);
    expect(hexes(OUTSIDE[`${res}/values/styles_widgets.xml`])).toEqual([colour("dark", "ink-100")]);
    const { a400 } = accentShades(DEFAULT_ACCENT);
    expect(hexes(OUTSIDE[`${res}/layout/karasu_widget.xml`])).toEqual([a400.toLowerCase(), colour("dark", "ink-600")]);
    const activity = OUTSIDE["/src-tauri/gen/android/app/src/main/java/dev/kyu/karasu/MainActivity.kt"];
    expect(hexes(activity)).toEqual([colour("dark", "surface-950")]);
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

describe("the skeleton's wait", () => {
  const rule = css.slice(css.indexOf("@utility shimmer-fill"), css.indexOf("}", css.indexOf("@utility shimmer-fill")));

  it("keeps a cell hidden until --delay-skeleton has passed, then fades it in", () => {
    expect(css).toMatch(/--delay-skeleton:\s*\d+ms;/);
    expect(rule).toContain("fadeIn");
    expect(rule).toContain("backwards");
    expect(rule).toMatch(/animation-delay:\s*var\(--shimmer-offset, 0ms\),\s*var\(--delay-skeleton\)/);
  });
});

describe("the focus ring on a clipping frame", () => {
  const block = (start: string) => css.slice(css.indexOf(start), css.indexOf("\n}", css.indexOf(start)));
  const frame = block("@utility focus-frame");
  const ring = (text: string, selector: string) => {
    const at = text.indexOf(selector);
    return text.slice(at, text.indexOf("}", at));
  };

  it("draws what the global ring draws, so a cover's focus reads like any other control's", () => {
    const global = ring(css, "  :focus-visible {");
    const own = ring(frame, "&:has(> [data-fills-frame]:focus-visible) {");
    for (const property of ["outline:", "outline-offset:"]) {
      const value = (text: string) => new RegExp(`${property}\\s*([^;]+);`).exec(text)?.[1];
      expect(value(own), property).toBe(value(global));
    }
  });

  it("thickens in high contrast and takes the system highlight in forced colours, as the global ring does", () => {
    const own = String.raw`&:has\(> \[data-fills-frame\]:focus-visible\)`;
    expect(frame).toMatch(new RegExp(String.raw`:root\[data-contrast="more"\] ${own} \{\s*outline-width: 3px;`));
    expect(frame).toMatch(new RegExp(String.raw`@media \(forced-colors: active\) \{\s*${own} \{\s*outline: 3px solid Highlight;`));
  });
});
