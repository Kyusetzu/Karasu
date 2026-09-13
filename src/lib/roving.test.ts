import { describe, expect, it } from "vitest";
import { nextFocus, ownsKeyboard } from "./roving";

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
    // `useColumnCount` reports 0 before the probe is laid out, and a zero step would pin the focus in place.
    expect(nextFocus(4, "down", 0, 30)).toBe(5);
  });

  it("has nowhere to go in an empty list", () => {
    expect(nextFocus(null, "down", 6, 0)).toBe(null);
    expect(nextFocus(3, "down", 6, 0)).toBe(null);
  });
});

describe("ownsKeyboard", () => {
  const body = { tag: "body" };
  const container = { tag: "div.scroll" };

  it("acts from the resting state", () => {
    expect(ownsKeyboard(body, body, container)).toBe(true);
    expect(ownsKeyboard(null, body, container)).toBe(true);
    expect(ownsKeyboard(container, body, container)).toBe(true);
  });

  /** Space on a focused button must not run the list's `+1` against the roving entry, a different title. */
  it("stands down for any other focused control", () => {
    expect(ownsKeyboard({ tag: "button" }, body, container)).toBe(false);
    expect(ownsKeyboard({ tag: "a" }, body, container)).toBe(false);
    // Arrow keys change a `<select>`'s value, so the handler must not preventDefault them for the roving index.
    expect(ownsKeyboard({ tag: "select" }, body, container)).toBe(false);
  });

  /** Keep this: an "outside the grid" test would let every row's own button through, and those are inside. */
  it("stands down for a control inside the grid too", () => {
    const rowButton = { tag: "button", inside: container };
    expect(ownsKeyboard(rowButton, body, container)).toBe(false);
  });
});
