import { describe, expect, it } from "vitest";
import { meanPosition, meanScore, scoreBuckets, totalVotes } from "./scoreDistribution";

/** Sparks of Tomorrow's real distribution, measured on AniList on 2026-09-25. */
const SPARKS = [36, 27, 56, 100, 189, 294, 684, 926, 944, 522].map((amount, i) => ({ score: (i + 1) * 10, amount }));

describe("scoreBuckets", () => {
  it("gives the ten-point scale one bar per point", () => {
    const bars = scoreBuckets("POINT_10", SPARKS);
    expect(bars.map((b) => b.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(bars[7]).toEqual({ value: 8, amount: 926 });
    expect(totalVotes(bars)).toBe(3778);
  });

  it("pairs the buckets for five stars", () => {
    const bars = scoreBuckets("POINT_5", SPARKS);
    expect(bars.map((b) => b.value)).toEqual([1, 2, 3, 4, 5]);
    expect(bars.map((b) => b.amount)).toEqual([36 + 27, 56 + 100, 189 + 294, 684 + 926, 944 + 522]);
  });

  /** The smiley scale is not linear: AniList reads up to 35 as sad and up to 60 as neutral. */
  it("folds the buckets onto the three smileys the way AniList reads them", () => {
    const bars = scoreBuckets("POINT_3", SPARKS);
    expect(bars.map((b) => b.amount)).toEqual([36 + 27 + 56, 100 + 189 + 294, 684 + 926 + 944 + 522]);
  });

  it("keeps the ten buckets for the continuous scales, valued in their own units", () => {
    expect(scoreBuckets("POINT_100", SPARKS).map((b) => b.value)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(scoreBuckets("POINT_10_DECIMAL", SPARKS)[7]).toEqual({ value: 8, amount: 926 });
  });

  it("draws empty bars for a title nobody has scored yet", () => {
    const bars = scoreBuckets("POINT_10", null);
    expect(bars).toHaveLength(10);
    expect(totalVotes(bars)).toBe(0);
  });

  it("ignores a bucket that is broken or off the scale", () => {
    const bars = scoreBuckets("POINT_10", [{ score: 80, amount: -4 }, { score: 0, amount: 3 }, { score: 70, amount: Number.NaN }]);
    expect(totalVotes(bars)).toBe(0);
  });
});

describe("meanScore", () => {
  it("converts AniList's hundred-point average onto the display scale", () => {
    expect(meanScore("POINT_10", 76)).toBeCloseTo(7.6);
    expect(meanScore("POINT_100", 76)).toBe(76);
    expect(meanScore("POINT_5", 76)).toBeCloseTo(3.8);
  });

  it("has none without an average", () => {
    expect(meanScore("POINT_10", null)).toBeNull();
    expect(meanScore("POINT_10", 0)).toBeNull();
  });
});

describe("meanPosition", () => {
  const bars = scoreBuckets("POINT_10", SPARKS);

  it("puts a mean between the centres of the bars it falls between", () => {
    // 7.6 lies six tenths of the way from bar 7's centre to bar 8's.
    expect(meanPosition(bars, 7.6)).toBeCloseTo(0.71);
  });

  it("lands on a bar's centre for a whole mean, and stays on the row at the ends", () => {
    expect(meanPosition(bars, 1)).toBeCloseTo(0.05);
    expect(meanPosition(bars, 10)).toBeCloseTo(0.95);
    expect(meanPosition(bars, 0.2)).toBeCloseTo(0.05);
    expect(meanPosition(bars, 12)).toBeCloseTo(0.95);
  });
});
