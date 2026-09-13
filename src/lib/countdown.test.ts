import { describe, expect, it } from "vitest";
import { countdownFraction, ringOffset, splitRemaining } from "./countdown";

describe("countdownFraction", () => {
  const MIN = 60_000;
  const armed = 1_700_000_000_000;

  it("runs from nothing done to all of it", () => {
    expect(countdownFraction(armed, armed + 1000, armed)).toBe(0);
    expect(countdownFraction(armed, armed + 1000, armed + 500)).toBe(0.5);
    expect(countdownFraction(armed, armed + 1000, armed + 1000)).toBe(1);
  });

  /** The bug this replaced: a card mounted mid-wait had only seen the time left and drew an empty ring. */
  it("starts partway round on a card mounted mid-session", () => {
    const due = armed + 25 * MIN;
    const first = countdownFraction(armed, due, armed + 14 * MIN);
    expect(first).toBeCloseTo(14 / 25, 10);
    expect(first).toBeGreaterThan(0.5);
    // And keeps going from there rather than restarting.
    expect(countdownFraction(armed, due, armed + 15 * MIN)).toBeGreaterThan(first);
  });

  /** Due is a closed ring, and so is anything the clock overshot. */
  it("is complete when due and stays so past it", () => {
    const due = armed + 25 * MIN;
    expect(countdownFraction(armed, due, due)).toBe(1);
    expect(countdownFraction(armed, due, due + 5000)).toBe(1);
  });

  /** A clock behind the arming stamp must not draw outside the ring. */
  it("clamps before the start", () => {
    expect(countdownFraction(armed, armed + 1000, armed - 2000)).toBe(0);
  });

  /** A zero or negative span would divide by zero; treat it as already due. */
  it("treats an empty or inverted span as complete", () => {
    expect(countdownFraction(armed, armed, armed)).toBe(1);
    expect(countdownFraction(armed, armed - 1, armed)).toBe(1);
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
