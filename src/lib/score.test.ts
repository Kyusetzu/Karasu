import { describe, expect, it } from "vitest";
import { normalizeDistribution, normalizeStatsBlock, toDisplayScale } from "./score";

describe("toDisplayScale", () => {
  it("brings AniList's hundred-point statistics onto the display scale", () => {
    // The live account's own numbers: a mean the dashboard shows as 7.1.
    expect(toDisplayScale("POINT_10", 70.64)).toBeCloseTo(7.064, 5);
    expect(toDisplayScale("POINT_10", 18.6)).toBeCloseTo(1.86, 5);
  });

  it("scales to whatever the format's maximum is", () => {
    expect(toDisplayScale("POINT_100", 70.64)).toBeCloseTo(70.64, 5);
    expect(toDisplayScale("POINT_5", 70)).toBeCloseTo(3.5, 5);
    expect(toDisplayScale("POINT_3", 60)).toBeCloseTo(1.8, 5);
  });
});

describe("normalizeDistribution", () => {
  it("leaves a ten-point distribution untouched", () => {
    const scores = [
      { score: 7, count: 93 },
      { score: 9, count: 82 },
      { score: 10, count: 47 },
    ];
    expect(normalizeDistribution(scores)).toEqual(scores);
  });

  it("leaves a five-point distribution on its own scale", () => {
    // Stretching it would put counts on scores the user cannot give.
    const scores = [
      { score: 1, count: 2 },
      { score: 5, count: 40 },
    ];
    expect(normalizeDistribution(scores)).toEqual(scores);
  });

  it("leaves a hundred-point distribution alone when the display scale is 100", () => {
    const scores = [
      { score: 85, count: 4 },
      { score: 100, count: 2 },
    ];
    expect(normalizeDistribution(scores, 100)).toEqual(scores);
  });

  it("collapses a hundred-point distribution by tens", () => {
    const out = normalizeDistribution([
      { score: 100, count: 5 },
      { score: 70, count: 30 },
      { score: 10, count: 1 },
    ]);
    expect(out).toEqual([
      { score: 1, count: 1 },
      { score: 7, count: 30 },
      { score: 10, count: 5 },
    ]);
  });

  it("sums the buckets that land on the same score", () => {
    // 85 and 87 are both a 9; two columns would invent a distinction the
    // user never made.
    expect(normalizeDistribution([
      { score: 85, count: 4 },
      { score: 87, count: 6 },
      { score: 94, count: 3 },
      { score: 96, count: 2 },
    ])).toEqual([
      // 85, 87 and 94 all round to 9; only 96 reaches 10.
      { score: 9, count: 13 },
      { score: 10, count: 2 },
    ]);
  });

  it("keeps every bucket inside 1–max", () => {
    for (const max of [10, 5, 3]) {
      for (const { score } of normalizeDistribution(
        [
          { score: 100, count: 1 },
          { score: max + 2, count: 1 },
        ],
        max,
      )) {
        expect(score).toBeGreaterThanOrEqual(1);
        expect(score).toBeLessThanOrEqual(max);
      }
    }
  });

  it("has nothing to say about an empty list", () => {
    expect(normalizeDistribution([])).toEqual([]);
  });
});

describe("normalizeStatsBlock", () => {
  const block = {
    count: 100,
    meanScore: 70.6,
    standardDeviation: 18.6,
    scores: [{ score: 85, count: 4 }],
    genres: [{ genre: "Action", count: 40, meanScore: 72 }],
    startYears: [{ startYear: 2024, count: 30, meanScore: 68 }],
    lengths: [{ length: "13-26", count: 20, meanScore: 74 }],
    formats: [{ format: "TV", count: 80 }],
    voiceActors: [{ voiceActor: { id: 1 }, count: 5, meanScore: 80 }],
  };

  it("normalizes every ranked list that carries a meanScore — startYears and lengths included", () => {
    // The trap this function exists for: the old per-list spelling covered
    // only the lists the screen rendered, so startYears/lengths arrived
    // hundred-point, fetched and waiting for someone to render them raw.
    const out = normalizeStatsBlock(block, "POINT_10");
    expect(out.meanScore).toBeCloseTo(7.06, 2);
    expect(out.standardDeviation).toBeCloseTo(1.86, 2);
    expect(out.genres[0].meanScore).toBeCloseTo(7.2, 5);
    expect(out.startYears[0].meanScore).toBeCloseTo(6.8, 5);
    expect(out.lengths[0].meanScore).toBeCloseTo(7.4, 5);
    expect(out.voiceActors[0].meanScore).toBeCloseTo(8.0, 5);
  });

  it("scales to the account's format, distribution included", () => {
    const out = normalizeStatsBlock(block, "POINT_5");
    expect(out.meanScore).toBeCloseTo(3.53, 2);
    expect(out.genres[0].meanScore).toBeCloseTo(3.6, 5);
    // 85/100 → round(4.25) = 4 on a five-point scale.
    expect(out.scores).toEqual([{ score: 4, count: 4 }]);
  });

  it("keeps a hundred-point account's numbers hundred-point", () => {
    const out = normalizeStatsBlock(block, "POINT_100");
    expect(out.meanScore).toBeCloseTo(70.6, 5);
    expect(out.scores).toEqual([{ score: 85, count: 4 }]);
  });

  it("leaves a count-only list untouched rather than inventing a NaN", () => {
    const out = normalizeStatsBlock(block, "POINT_10");
    expect(out.formats[0]).toEqual({ format: "TV", count: 80 });
    expect("meanScore" in out.formats[0]).toBe(false);
  });

  it("collapses the distribution and keeps non-score fields intact", () => {
    const out = normalizeStatsBlock(block, "POINT_10");
    expect(out.scores).toEqual([{ score: 9, count: 4 }]);
    expect(out.count).toBe(100);
    expect(out.startYears[0].startYear).toBe(2024);
  });

  it("does not mutate its input — the query cache holds the original", () => {
    const before = JSON.stringify(block);
    normalizeStatsBlock(block, "POINT_10");
    expect(JSON.stringify(block)).toBe(before);
  });
});
