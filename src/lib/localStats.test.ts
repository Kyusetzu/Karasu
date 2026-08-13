import { describe, expect, it } from "vitest";
import { activityHeatmap, scoreDelta, seasonalHistory } from "./localStats";
import type { MediaListEntry } from "@/api/types";

const entry = (
  mediaId: number,
  score: number,
  averageScore: number | null,
  title = `Show ${mediaId}`,
) =>
  ({
    id: mediaId,
    mediaId,
    score,
    media: {
      id: mediaId,
      title: { romaji: title, english: null, native: null },
      averageScore,
    },
  }) as unknown as MediaListEntry;

describe("scoreDelta", () => {
  it("compares on one scale: mine is ten-point, the community's is hundred-point", () => {
    const out = scoreDelta([entry(1, 8, 70)]);
    expect(out).not.toBeNull();
    expect(out!.meanMine).toBe(8);
    expect(out!.meanCommunity).toBe(7);
    expect(out!.meanDelta).toBe(1);
  });

  it("excludes the unscored and the unrated rather than counting them as zero", () => {
    const out = scoreDelta([
      entry(1, 8, 70),
      entry(2, 0, 80), // user never scored it
      entry(3, 7, null), // AniList has no mean
    ]);
    expect(out!.count).toBe(1);
  });

  it("returns null when nothing is comparable — a panel that draws from it can hide", () => {
    expect(scoreDelta([])).toBeNull();
    expect(scoreDelta([entry(1, 0, 70)])).toBeNull();
  });

  it("splits disagreements by direction, biggest first, capped at top", () => {
    const out = scoreDelta(
      [
        entry(1, 3, 80, "overrated-a"), // -5
        entry(2, 5, 80, "overrated-b"), // -3
        entry(3, 10, 60, "hidden-gem"), // +4
        entry(4, 8, 70, "slightly-up"), // +1
        entry(5, 7, 70, "agreed"), // 0
      ],
      1,
    );
    expect(out!.harshest.map((r) => r.title)).toEqual(["overrated-a"]);
    expect(out!.kindest.map((r) => r.title)).toEqual(["hidden-gem"]);
    // Zero-delta agreement appears on neither side.
    expect([...out!.harshest, ...out!.kindest].some((r) => r.delta === 0)).toBe(false);
  });

  it("counts each title once, however many custom lists repeat it", () => {
    const out = scoreDelta([entry(1, 8, 70), entry(1, 8, 70)]);
    expect(out!.count).toBe(1);
  });
});

const dated = (
  mediaId: number,
  startedAt: { year: number | null; month: number | null } | null,
  completedAt: { year: number | null; month: number | null } | null = null,
) =>
  ({
    id: mediaId,
    mediaId,
    score: 0,
    startedAt: startedAt ? { ...startedAt, day: null } : null,
    completedAt: completedAt ? { ...completedAt, day: null } : null,
    media: { id: mediaId, title: { romaji: "x", english: null, native: null } },
  }) as unknown as MediaListEntry;

describe("activityHeatmap", () => {
  it("puts each dated event in its month cell, starts and completions both", () => {
    const out = activityHeatmap([
      dated(1, { year: 2024, month: 3 }, { year: 2024, month: 5 }),
      dated(2, { year: 2024, month: 3 }),
    ]);
    expect(out).not.toBeNull();
    const y = out!.years.find((x) => x.year === 2024)!;
    expect(y.months[2]).toBe(2); // two March events
    expect(y.months[4]).toBe(1); // one May completion
    expect(out!.total).toBe(3);
    expect(out!.max).toBe(2);
  });

  it("skips a year-only date rather than pinning it to January", () => {
    // A fabricated cell reads exactly like a real one — the fuzzy-date rule.
    const out = activityHeatmap([
      dated(1, { year: 2019, month: null }),
      dated(2, { year: 2020, month: 6 }),
    ]);
    expect(out!.total).toBe(1);
    expect(out!.years.some((y) => y.year === 2019)).toBe(false);
  });

  it("keeps only the newest maxYears, oldest first", () => {
    const out = activityHeatmap(
      [
        dated(1, { year: 2019, month: 1 }),
        dated(2, { year: 2021, month: 1 }),
        dated(3, { year: 2023, month: 1 }),
      ],
      2,
    );
    expect(out!.years.map((y) => y.year)).toEqual([2021, 2023]);
  });

  it("has nothing to draw from an undated list", () => {
    expect(activityHeatmap([dated(1, null)])).toBeNull();
  });
});

describe("seasonalHistory", () => {
  const seasonal = (mediaId: number, season: string | null, score = 0) =>
    ({
      id: mediaId,
      mediaId,
      score,
      media: { id: mediaId, season, title: { romaji: "x", english: null, native: null } },
    }) as unknown as MediaListEntry;

  it("counts unique titles per season, in broadcast order", () => {
    const out = seasonalHistory([
      seasonal(1, "FALL"),
      seasonal(2, "WINTER"),
      seasonal(3, "FALL"),
      seasonal(3, "FALL"), // custom-list repeat
    ]);
    expect(out.map((s) => s.season)).toEqual(["WINTER", "FALL"]);
    expect(out.find((s) => s.season === "FALL")!.count).toBe(2);
  });

  it("averages only the scores that exist", () => {
    const out = seasonalHistory([
      seasonal(1, "SPRING", 8),
      seasonal(2, "SPRING", 0),
      seasonal(3, "SPRING", 6),
    ]);
    expect(out[0].meanScore).toBe(7);
  });

  it("leaves seasonless media outside the question", () => {
    expect(seasonalHistory([seasonal(1, null)])).toEqual([]);
  });
});
