import { describe, expect, it } from "vitest";
import { countdownFraction, ringOffset, splitRemaining } from "./countdown";

describe("countdownFraction", () => {
  it("runs from nothing done to all of it", () => {
    expect(countdownFraction(1000, 1000)).toBe(0);
    expect(countdownFraction(500, 1000)).toBe(0.5);
    expect(countdownFraction(0, 1000)).toBe(1);
  });

  /**
   * The clock can overshoot the target between ticks, and the span is inferred
   * rather than given — so both ends have to be pinned or the ring draws
   * outside itself.
   */
  it("clamps past either end", () => {
    expect(countdownFraction(-5000, 1000)).toBe(1);
    expect(countdownFraction(2000, 1000)).toBe(0);
  });

  /** A zero or negative span would divide by zero; treat it as already due. */
  it("treats an unknown span as complete", () => {
    expect(countdownFraction(1000, 0)).toBe(1);
    expect(countdownFraction(1000, -1)).toBe(1);
  });
});

describe("ringOffset", () => {
  it("is the full circumference when empty and zero when closed", () => {
    expect(ringOffset(0, 100)).toBe(100);
    expect(ringOffset(1, 100)).toBe(0);
    expect(ringOffset(0.25, 100)).toBe(75);
  });

  it("clamps rather than drawing outside the ring", () => {
    expect(ringOffset(-1, 100)).toBe(100);
    expect(ringOffset(3, 100)).toBe(0);
  });
});

describe("splitRemaining", () => {
  it("splits into minutes and seconds", () => {
    expect(splitRemaining(90_000)).toEqual({ minutes: 1, seconds: 30 });
    expect(splitRemaining(45_000)).toEqual({ minutes: 0, seconds: 45 });
  });

  /** Past due reads as zero, never as a negative countdown. */
  it("floors at zero", () => {
    expect(splitRemaining(-5000)).toEqual({ minutes: 0, seconds: 0 });
  });
});
