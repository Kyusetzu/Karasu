import { describe, expect, it } from "vitest";
import { nextFocus } from "./roving";

describe("nextFocus", () => {
  it("lands on the first item whichever key starts it", () => {
    for (const move of ["left", "right", "up", "down"] as const) {
      expect(nextFocus(null, move, 6, 30)).toBe(0);
    }
  });

  it("steps one along a row and a whole row up or down", () => {
    expect(nextFocus(7, "right", 6, 30)).toBe(8);
    expect(nextFocus(7, "left", 6, 30)).toBe(6);
    expect(nextFocus(7, "down", 6, 30)).toBe(13);
    expect(nextFocus(7, "up", 6, 30)).toBe(1);
  });

  it("clamps instead of wrapping at both ends", () => {
    expect(nextFocus(0, "left", 6, 30)).toBe(0);
    expect(nextFocus(0, "up", 6, 30)).toBe(0);
    expect(nextFocus(29, "right", 6, 30)).toBe(29);
    expect(nextFocus(29, "down", 6, 30)).toBe(29);
  });

  it("clamps a partial last row to the final item", () => {
    // 30 items at 7 columns: the last row holds 28 and 29 only.
    expect(nextFocus(26, "down", 7, 30)).toBe(29);
  });

  it("survives a column count that has not been measured yet", () => {
    // `useColumnCount` reports 0 before the probe is laid out, and a step of
    // zero would pin the focus in place with the key apparently doing nothing.
    expect(nextFocus(4, "down", 0, 30)).toBe(5);
  });

  it("has nowhere to go in an empty list", () => {
    expect(nextFocus(null, "down", 6, 0)).toBe(null);
    expect(nextFocus(3, "down", 6, 0)).toBe(null);
  });
});
