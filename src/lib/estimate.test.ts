import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { formatMinutes, remainingMinutes } from "./estimate";

// Echoing stub: returns "key(paramsJSON)" so we can assert what was chosen.
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key) as unknown as TFunction;

describe("remainingMinutes", () => {
  it("multiplies remaining episodes by duration", () => {
    expect(remainingMinutes({ episodes: 12, duration: 24 }, 3)).toBe(216);
  });

  it("is zero when already finished (never negative)", () => {
    expect(remainingMinutes({ episodes: 12, duration: 24 }, 20)).toBe(0);
  });

  it("returns null when episodes or duration is unknown", () => {
    expect(remainingMinutes({ episodes: null, duration: 24 }, 0)).toBeNull();
    expect(remainingMinutes({ episodes: 12, duration: null }, 0)).toBeNull();
    expect(remainingMinutes({ episodes: 12 }, 0)).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("picks the day+hour form past 24h", () => {
    expect(formatMinutes(1440 + 120, t)).toBe('time.dh({"d":1,"h":2})');
  });

  it("picks the hour+minute form under a day", () => {
    expect(formatMinutes(150, t)).toBe('time.hm({"h":2,"m":30})');
  });

  it("picks the minutes-only form under an hour", () => {
    expect(formatMinutes(45, t)).toBe('time.m({"m":45})');
  });

  it("returns the empty form at or below zero", () => {
    expect(formatMinutes(0, t)).toBe("time.none");
  });
});
