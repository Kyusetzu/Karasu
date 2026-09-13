import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_VIEW,
  WEEK_MIN_WIDTH,
  effectiveView,
  isCalendarView,
  loadCalendarView,
  saveCalendarView,
  weekFits,
} from "./calendarView";

describe("effectiveView", () => {
  it("draws the chosen view where it fits", () => {
    expect(effectiveView("week", WEEK_MIN_WIDTH, false)).toBe("week");
    expect(effectiveView("tiles", 400, true)).toBe("tiles");
    expect(effectiveView("agenda", 2000, false)).toBe("agenda");
  });

  it("falls a week grid that would scroll sideways back to the agenda", () => {
    expect(effectiveView("week", WEEK_MIN_WIDTH - 1, false)).toBe("agenda");
    expect(effectiveView("week", 3000, true)).toBe("agenda");
  });

  it("never offers the week grid on a phone", () => {
    expect(weekFits(3000, true)).toBe(false);
    expect(weekFits(WEEK_MIN_WIDTH, false)).toBe(true);
  });
});

describe("the stored view", () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const original = globalThis.localStorage;
  afterEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("round-trips and falls back on a stray value", () => {
    Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
    expect(loadCalendarView()).toBe(DEFAULT_CALENDAR_VIEW);
    saveCalendarView("tiles");
    expect(loadCalendarView()).toBe("tiles");
    store.set("karasu-calendar-view", "poster");
    expect(loadCalendarView()).toBe(DEFAULT_CALENDAR_VIEW);
  });

  it("survives a storage that throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => { throw new Error("private"); }, setItem: () => { throw new Error("private"); } },
      configurable: true,
    });
    expect(loadCalendarView()).toBe(DEFAULT_CALENDAR_VIEW);
    expect(() => saveCalendarView("agenda")).not.toThrow();
  });

  it("knows its own vocabulary", () => {
    expect(isCalendarView("week")).toBe(true);
    expect(isCalendarView("list")).toBe(false);
  });
});
