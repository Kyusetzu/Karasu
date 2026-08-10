import { describe, expect, it } from "vitest";
import { relTime, relTimeFromSeconds } from "./relTime";

// A fixed clock, so the thresholds are asserted rather than approximated.
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const rel = (ms: number) => relTime(ms, "en", "now", NOW);

describe("relTime", () => {
  it("says now for anything under a minute", () => {
    expect(rel(NOW)).toBe("now");
    expect(rel(ago(59_000))).toBe("now");
  });

  it("counts minutes up to an hour", () => {
    expect(rel(ago(MIN))).toBe("1m");
    expect(rel(ago(59 * MIN))).toBe("59m");
  });

  it("counts hours up to a day", () => {
    expect(rel(ago(HOUR))).toBe("1h");
    expect(rel(ago(23 * HOUR + 59 * MIN))).toBe("23h");
  });

  it("counts days up to a week", () => {
    expect(rel(ago(DAY))).toBe("1d");
    expect(rel(ago(6 * DAY))).toBe("6d");
  });

  it("switches to a date at a week, where a day count stops helping", () => {
    const out = rel(ago(7 * DAY));
    expect(out).not.toMatch(/^\d+[mhd]$/);
    expect(out).toBe(new Date(ago(7 * DAY)).toLocaleDateString("en"));
  });

  it("reads a future timestamp as now rather than a negative age", () => {
    // Clock skew between the user's machine and AniList's is real and small.
    expect(rel(NOW + 5 * MIN)).toBe("now");
  });

  it("formats the date in the requested language", () => {
    const old = ago(30 * DAY);
    expect(relTime(old, "de", "now", NOW)).toBe(new Date(old).toLocaleDateString("de"));
  });
});

describe("relTimeFromSeconds", () => {
  it("takes AniList's unix seconds", () => {
    expect(relTimeFromSeconds(Math.floor(ago(2 * HOUR) / 1000), "en", "now", NOW)).toBe("2h");
  });

  it("agrees with the milliseconds form", () => {
    const secs = Math.floor(ago(3 * DAY) / 1000);
    expect(relTimeFromSeconds(secs, "en", "now", NOW)).toBe(
      relTime(secs * 1000, "en", "now", NOW),
    );
  });
});
