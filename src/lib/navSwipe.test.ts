import { describe, expect, it } from "vitest";
import {
  EDGE_GUARD_PX,
  SWIPE_MAX_MS,
  SWIPE_MIN_PX,
  TAB_SWIPE_FRACTION,
  TAB_SWIPE_MIN_PX,
  TAB_SWIPE_SLOP_PX,
  adjacentTab,
  isEdgeStart,
  isPaletteSwipe,
  swipeAxis,
  swipeOffset,
  tabSwipe,
} from "@/lib/navSwipe";
import { PULL_SLOP_PX } from "@/lib/pullToSync";

describe("isPaletteSwipe", () => {
  it("opens on a quick flick up from the bar", () => {
    expect(isPaletteSwipe({ dx: 0, dy: -(SWIPE_MIN_PX + 20), ms: 180 })).toBe(true);
  });

  it("ignores a downward swipe, which belongs to pull-to-sync", () => {
    expect(isPaletteSwipe({ dx: 0, dy: SWIPE_MIN_PX + 20, ms: 180 })).toBe(false);
  });

  it("ignores a flick that did not travel far enough", () => {
    expect(isPaletteSwipe({ dx: 0, dy: -(SWIPE_MIN_PX - 1), ms: 120 })).toBe(false);
  });

  it("ignores a slow drag, which is a finger resting rather than a command", () => {
    expect(isPaletteSwipe({ dx: 0, dy: -200, ms: SWIPE_MAX_MS + 1 })).toBe(false);
  });

  it("ignores a mostly sideways wipe across the bar", () => {
    expect(isPaletteSwipe({ dx: 120, dy: -60, ms: 200 })).toBe(false);
    expect(isPaletteSwipe({ dx: -120, dy: -60, ms: 200 })).toBe(false);
  });

  it("accepts a diagonal that is still mostly upward", () => {
    expect(isPaletteSwipe({ dx: 20, dy: -90, ms: 200 })).toBe(true);
  });

  it("refuses a sample that is not a measurement at all", () => {
    expect(isPaletteSwipe({ dx: Number.NaN, dy: -200, ms: 100 })).toBe(false);
  });
});

describe("swipeAxis", () => {
  it("waits inside the slop", () => {
    expect(swipeAxis(TAB_SWIPE_SLOP_PX - 1, 2)).toBeNull();
  });

  it("commits to whichever axis leads on the first sample past it, a tie going to the scroll", () => {
    expect(swipeAxis(TAB_SWIPE_SLOP_PX + 2, 3)).toBe("x");
    expect(swipeAxis(-(TAB_SWIPE_SLOP_PX + 2), 3)).toBe("x");
    expect(swipeAxis(3, TAB_SWIPE_SLOP_PX + 2)).toBe("y");
    expect(swipeAxis(TAB_SWIPE_SLOP_PX, TAB_SWIPE_SLOP_PX)).toBe("y");
  });

  /** The pull decides on the same sample with the same rule, so a drag is never both a pull and a swipe. */
  it("shares its slop with the pull", () => {
    expect(TAB_SWIPE_SLOP_PX).toBe(PULL_SLOP_PX);
  });

  it("treats a sample that is not a measurement as a scroll", () => {
    expect(swipeAxis(Number.NaN, 0)).toBe("y");
  });
});

describe("tabSwipe", () => {
  const width = 390;

  it("moves to the next tab on a swipe to the left and back on one to the right", () => {
    expect(tabSwipe({ dx: -120, dy: 10, width })).toBe(1);
    expect(tabSwipe({ dx: 120, dy: -10, width })).toBe(-1);
  });

  it("ignores a swipe shorter than the minimum or the share of the width", () => {
    expect(tabSwipe({ dx: -(TAB_SWIPE_MIN_PX - 1), dy: 0, width })).toBeNull();
    // On a wide screen the share of the width is the larger bar.
    expect(tabSwipe({ dx: -150, dy: 0, width: 1200 })).toBeNull();
    expect(tabSwipe({ dx: -(1200 * TAB_SWIPE_FRACTION + 1), dy: 0, width: 1200 })).toBe(1);
  });

  it("ignores a diagonal that is not clearly sideways", () => {
    expect(tabSwipe({ dx: -120, dy: 70, width })).toBeNull();
  });

  it("refuses a sample that is not a measurement at all", () => {
    expect(tabSwipe({ dx: Number.NaN, dy: 0, width })).toBeNull();
  });
});

describe("adjacentTab", () => {
  const order = ["CURRENT", "REPEATING", "COMPLETED", "PAUSED", "DROPPED", "PLANNING"] as const;

  it("steps to either neighbour", () => {
    expect(adjacentTab(order, "CURRENT", 1)).toBe("REPEATING");
    expect(adjacentTab(order, "PAUSED", -1)).toBe("COMPLETED");
  });

  /** The row has two ends: Planning does not wrap round to Watching, nor Watching back to Planning. */
  it("stops at both ends instead of looping", () => {
    expect(adjacentTab(order, "PLANNING", 1)).toBeNull();
    expect(adjacentTab(order, "CURRENT", -1)).toBeNull();
  });

  it("has nowhere to go from a tab it does not know", () => {
    expect(adjacentTab(order, "NOPE" as never, 1)).toBeNull();
  });
});

describe("swipeOffset", () => {
  it("follows the finger damped toward a neighbour", () => {
    expect(swipeOffset(-100, true)).toBeCloseTo(-45);
  });

  it("gives only a short rubber band where there is no neighbour", () => {
    expect(Math.abs(swipeOffset(-100, false))).toBeLessThan(Math.abs(swipeOffset(-100, true)));
    expect(Math.abs(swipeOffset(-1000, false))).toBeLessThanOrEqual(36);
    expect(swipeOffset(-1000, false)).toBeLessThan(0);
  });
});

describe("isEdgeStart", () => {
  it("leaves both edge strips to the system back gesture", () => {
    expect(isEdgeStart(EDGE_GUARD_PX - 1, 390)).toBe(true);
    expect(isEdgeStart(390 - EDGE_GUARD_PX + 1, 390)).toBe(true);
    expect(isEdgeStart(195, 390)).toBe(false);
  });
});
