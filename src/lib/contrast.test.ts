import { describe, expect, it } from "vitest";
import {
  accentShades,
  contrastRatio,
  hexToHsv,
  hsvToHex,
  hueRotate,
  mix,
  parseHex,
  readableInk,
  relativeLuminance,
  rgbTriplet,
} from "./contrast";

describe("parseHex", () => {
  it("parses long and short forms", () => {
    expect(parseHex("#ff8800")).toEqual([255, 136, 0]);
    expect(parseHex("#f80")).toEqual([255, 136, 0]);
  });
  it("falls back to black on garbage", () => {
    expect(parseHex("nope")).toEqual([0, 0, 0]);
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("spans 1 to 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#6c7fff", "#6c7fff")).toBeCloseTo(1, 5);
  });
  it("is symmetric", () => {
    expect(contrastRatio("#0b0d12", "#98a1b2")).toBeCloseTo(
      contrastRatio("#98a1b2", "#0b0d12"),
      10,
    );
  });
});

describe("readableInk", () => {
  it("uses black on light backgrounds", () => {
    expect(readableInk("#ffffff")).toBe("#000000");
    expect(readableInk("#ffd54a")).toBe("#000000"); // bright amber
  });
  it("uses white on dark backgrounds", () => {
    expect(readableInk("#000000")).toBe("#ffffff");
    expect(readableInk("#1e3a8a")).toBe("#ffffff"); // deep blue
  });

  /**
   * The old rule was `luminance > 0.45`, but the two ratios actually cross far
   * lower. Everything in between was given white when black was more readable,
   * and on these three that meant shipping below the 4.5:1 floor.
   */
  it("picks black for mid-luminance accents, where the old threshold did not", () => {
    for (const accent of ["#46a5b3", "#3b93e6", "#34c78a"]) {
      expect(readableInk(accent)).toBe("#000000");
      expect(contrastRatio(accent, "#ffffff")).toBeLessThan(4.5);
      expect(contrastRatio(accent, "#000000")).toBeGreaterThan(4.5);
    }
  });

  it("always returns the higher-contrast of the two", () => {
    for (const c of ["#000000", "#ffffff", "#6c7fff", "#e8d48a", "#4b3fc7"]) {
      const ink = readableInk(c);
      const other = ink === "#000000" ? "#ffffff" : "#000000";
      expect(contrastRatio(c, ink)).toBeGreaterThanOrEqual(
        contrastRatio(c, other),
      );
    }
  });
});

describe("hueRotate", () => {
  it("moves the hue and leaves saturation and value alone", () => {
    const rotated = hueRotate("#6c7fff", 46);
    const before = hexToHsv("#6c7fff");
    const after = hexToHsv(rotated);
    expect(after.h).toBeCloseTo((before.h + 46) % 360, 0);
    expect(after.s).toBeCloseTo(before.s, 0);
    expect(after.v).toBeCloseTo(before.v, 0);
  });

  it("wraps past 360 and below 0", () => {
    expect(hueRotate("#ff0000", 360)).toBe("#ff0000");
    expect(hexToHsv(hueRotate("#ff0000", -28)).h).toBeCloseTo(332, 0);
  });

  /** Without the floor a near-grey accent throws a second grey, not a tint. */
  it("floors saturation so a near-grey accent still throws a tint", () => {
    expect(hexToHsv(hueRotate("#808080", -28, 0.45)).s).toBeCloseTo(45, 0);
    // An already-saturated colour keeps its own saturation.
    expect(hexToHsv(hueRotate("#ff0000", -28, 0.45)).s).toBeCloseTo(100, 0);
  });
});

describe("rgbTriplet", () => {
  it("formats for rgba(var(--token), α)", () => {
    expect(rgbTriplet("#0b0d12")).toBe("11, 13, 18");
  });
});

describe("mix", () => {
  it("blends toward the target by the amount", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
  });
});

describe("accentShades", () => {
  it("keeps 500 as the base and darkens 600, lightens 400", () => {
    const s = accentShades("#6c7fff");
    expect(s.a500).toBe("#6c7fff");
    expect(relativeLuminance(s.a600)).toBeLessThan(relativeLuminance(s.a500));
    expect(relativeLuminance(s.a400)).toBeGreaterThan(relativeLuminance(s.a500));
  });

  it("picks ink for contrast against the accent", () => {
    expect(accentShades("#ffe100").ink).toBe("#000000"); // bright → black
    expect(accentShades("#3a1d6e").ink).toBe("#ffffff"); // dark → white
  });

  /** The whole point: any colour on the wheel has to be safe. */
  it("forces a400 past 4.5:1 on the page, for every accent", () => {
    const accents = [
      "#4b3fc7", // the default — dark enough that plain mixing misses
      "#e8d48a", // pale straw
      "#46a5b3", // feather sheen
      "#000000", // degenerate
      "#ffffff",
      "#808080",
      "#1a1a1a",
    ];
    for (const accent of accents) {
      expect(contrastRatio(accentShades(accent).a400, "#0b0d12")).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(accentShades(accent, { light: true }).a400, "#f4f6f9"),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens the fill in light theme only when it would vanish", () => {
    // Pale straw on white is invisible as a fill, so it gets pulled down.
    expect(accentShades("#e8d48a", { light: true }).a500).not.toBe("#e8d48a");
    // A deep indigo is already visible; leave it exactly as the user picked it.
    expect(accentShades("#4b3fc7", { light: true }).a500).toBe("#4b3fc7");
    // Dark theme never darkens the fill.
    expect(accentShades("#e8d48a").a500).toBe("#e8d48a");
  });

  it("derives both sheens from the accent's own hue", () => {
    const straw = accentShades("#e8d48a");
    const teal = accentShades("#46a5b3");
    // Different accents must not produce the same wash — that was the bug.
    expect(straw.w1).not.toBe(teal.w1);
    expect(straw.w2).not.toBe(teal.w2);
    // The two sheens straddle the base hue, so they differ from each other.
    expect(straw.w1).not.toBe(straw.w2);
  });

  it("emits hair as a usable rgba string, denser in light theme", () => {
    expect(accentShades("#4b3fc7").hair).toMatch(
      /^rgba\(\d+, \d+, \d+, 0\.11\)$/,
    );
    expect(accentShades("#4b3fc7", { light: true }).hair).toMatch(
      /^rgba\(\d+, \d+, \d+, 0\.16\)$/,
    );
  });
});

describe("hexToHsv / hsvToHex", () => {
  it("round-trips primary colours", () => {
    expect(hsvToHex(hexToHsv("#ff0000"))).toBe("#ff0000");
    expect(hsvToHex(hexToHsv("#00ff00"))).toBe("#00ff00");
    expect(hsvToHex(hexToHsv("#0000ff"))).toBe("#0000ff");
  });

  it("black and white have zero saturation", () => {
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("#ffffff").s).toBe(0);
    expect(hexToHsv("#ffffff").v).toBe(100);
  });

  it("round-trips the default accent", () => {
    expect(hsvToHex(hexToHsv("#6c7fff"))).toBe("#6c7fff");
  });

  it("changing only hue keeps saturation/value", () => {
    const hsv = hexToHsv("#6c7fff");
    const rotated = hsvToHex({ ...hsv, h: (hsv.h + 90) % 360 });
    expect(hexToHsv(rotated).s).toBeCloseTo(hsv.s, 0);
    expect(hexToHsv(rotated).v).toBeCloseTo(hsv.v, 0);
  });
});
