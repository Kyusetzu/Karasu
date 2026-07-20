import { describe, expect, it } from "vitest";
import {
  accentShades,
  mix,
  parseHex,
  readableInk,
  relativeLuminance,
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

describe("readableInk", () => {
  it("uses black on light backgrounds", () => {
    expect(readableInk("#ffffff")).toBe("#000000");
    expect(readableInk("#ffd54a")).toBe("#000000"); // bright amber
  });
  it("uses white on dark backgrounds", () => {
    expect(readableInk("#000000")).toBe("#ffffff");
    expect(readableInk("#1e3a8a")).toBe("#ffffff"); // deep blue
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
});
