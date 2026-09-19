import { describe, expect, it } from "vitest";
import { SWIPE_MAX_MS, SWIPE_MIN_PX, isPaletteSwipe } from "@/lib/navSwipe";

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
