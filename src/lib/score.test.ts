import { describe, expect, it } from "vitest";
import { normalizeDistribution, toTenPoint } from "./score";

describe("toTenPoint", () => {
  it("brings AniList's hundred-point statistics onto the app's scale", () => {
    // The live account's own numbers: a mean the dashboard shows as 7.1.
    expect(toTenPoint(70.64)).toBeCloseTo(7.064, 5);
    expect(toTenPoint(18.6)).toBeCloseTo(1.86, 5);
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

  it("keeps every bucket inside 1–10", () => {
    for (const { score } of normalizeDistribution([
      { score: 3, count: 1 },
      { score: 100, count: 1 },
      { score: 12, count: 1 },
    ])) {
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }
  });

  it("has nothing to say about an empty list", () => {
    expect(normalizeDistribution([])).toEqual([]);
  });
});
