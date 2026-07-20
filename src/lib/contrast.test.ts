import { describe, expect, it } from "vitest";
import { parseHex, readableInk, relativeLuminance } from "./contrast";

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
