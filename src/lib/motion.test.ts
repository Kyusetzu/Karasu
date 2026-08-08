import { describe, expect, it } from "vitest";
import {
  motionDuration,
  reducedMotion,
  seriesDelay,
  staggerDelay,
  SERIES_WINDOW_MS,
  STAGGER_CYCLE,
  STAGGER_STEP_MS,
} from "./motion";

describe("reducedMotion", () => {
  it("is off only when neither source asks for it", () => {
    expect(reducedMotion(false, false)).toBe(false);
  });

  it("follows the app's toggle", () => {
    expect(reducedMotion(true, false)).toBe(true);
  });

  /**
   * The toggle only ever adds — a user cannot opt back *into* motion the OS has
   * asked to suppress, which the settings hint states as intended.
   */
  it("follows the OS even with the toggle off", () => {
    expect(reducedMotion(false, true)).toBe(true);
  });
});

describe("motionDuration", () => {
  it("passes the duration through normally", () => {
    expect(motionDuration(280, false)).toBe(280);
  });

  /**
   * The point of the helper: a duration held in JS is invisible to the CSS
   * `!important` rules, so it has to collapse here or it ships as real motion.
   */
  it("collapses to zero under reduced motion", () => {
    expect(motionDuration(280, true)).toBe(0);
  });
});

describe("staggerDelay", () => {
  it("steps through the cycle and wraps", () => {
    expect(staggerDelay(0, false)).toBe(0);
    expect(staggerDelay(1, false)).toBe(STAGGER_STEP_MS);
    expect(staggerDelay(STAGGER_CYCLE, false)).toBe(0);
    expect(staggerDelay(STAGGER_CYCLE + 2, false)).toBe(2 * STAGGER_STEP_MS);
  });

  /** The wrap is what stops a long list from waiting seconds for its turn. */
  it("never exceeds one cycle", () => {
    for (let i = 0; i < 200; i++) {
      expect(staggerDelay(i, false)).toBeLessThan(
        STAGGER_CYCLE * STAGGER_STEP_MS,
      );
    }
  });

  /**
   * A stagger whose duration is zeroed but whose delay is not becomes a
   * staggered *wait*. The delay has to go too.
   */
  it("is flat under reduced motion", () => {
    expect(staggerDelay(3, true)).toBe(0);
    expect(staggerDelay(97, true)).toBe(0);
  });
});

describe("seriesDelay", () => {
  it("keeps the house rhythm for a short series", () => {
    expect(seriesDelay(0, 6, false)).toBe(0);
    expect(seriesDelay(1, 6, false)).toBe(STAGGER_STEP_MS);
    expect(seriesDelay(5, 6, false)).toBe(5 * STAGGER_STEP_MS);
  });

  /**
   * The whole reason it exists: a chart is one shape arriving, so the delay
   * must never return to zero partway through the way `staggerDelay` does.
   */
  it("never restarts, however long the series", () => {
    for (const count of [7, 14, 40, 200]) {
      let previous = -1;
      for (let i = 0; i < count; i++) {
        const delay = seriesDelay(i, count, false);
        expect(delay).toBeGreaterThanOrEqual(previous);
        previous = delay;
      }
    }
  });

  /** Compressed rather than unbounded, so a big treemap still lands promptly. */
  it("fits the series into the window", () => {
    for (const count of [7, 14, 40, 200]) {
      expect(seriesDelay(count - 1, count, false)).toBeLessThanOrEqual(
        SERIES_WINDOW_MS,
      );
    }
  });

  it("is flat under reduced motion", () => {
    expect(seriesDelay(9, 14, true)).toBe(0);
  });

  it("treats a single-item series as immediate", () => {
    expect(seriesDelay(0, 1, false)).toBe(0);
  });
});
