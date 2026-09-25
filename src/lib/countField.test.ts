import { describe, expect, it } from "vitest";
import { countText, parseCount } from "./countField";

describe("parseCount", () => {
  /** A cleared field saves as 0, never as a missing value. */
  it("reads an empty field as 0", () => {
    expect(parseCount("")).toBe(0);
    expect(parseCount("  ")).toBe(0);
  });

  it("reads a typed number", () => {
    expect(parseCount("7")).toBe(7);
    expect(parseCount("07")).toBe(7);
  });

  it("keeps it inside [0, max], whole", () => {
    expect(parseCount("15", 13)).toBe(13);
    expect(parseCount("-3", 13)).toBe(0);
    expect(parseCount("4.9", 13)).toBe(4);
  });

  it("has no ceiling without a max", () => {
    expect(parseCount("2000")).toBe(2000);
  });

  it("refuses what is not a number, so the field keeps its last good value", () => {
    expect(parseCount("abc")).toBeNull();
    expect(parseCount("Infinity")).toBeNull();
  });
});

describe("countText", () => {
  it("shows nothing for 0, so the placeholder speaks and typing needs no delete first", () => {
    expect(countText(0)).toBe("");
  });

  it("shows any other count as it is", () => {
    expect(countText(11)).toBe("11");
  });

  it("shows nothing for a value that is not a count", () => {
    expect(countText(Number.NaN)).toBe("");
    expect(countText(-2)).toBe("");
  });
});
