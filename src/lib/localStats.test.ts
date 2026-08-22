import { describe, expect, it } from "vitest";
import {
  activityHeatmap,
  dayHeatmapFromHistory,
  historyDay,
  localTotals,
  scoreDelta,
  seasonalHistory,
} from "./localStats";
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

describe("localTotals", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: 1,
      mediaId: 1,
      status: "CURRENT",
      score: 0,
      progress: 0,
      media: { id: 1, seasonYear: null },
      ...over,
    }) as unknown as MediaListEntry;

  it("counts what AniList's endpoint would, from the list itself", () => {
    const out = localTotals([
      row({ mediaId: 1, status: "COMPLETED", score: 8, progress: 12 }),
      row({ mediaId: 2, status: "COMPLETED", score: 6, progress: 24 }),
      row({ mediaId: 3, status: "CURRENT", score: 0, progress: 3 }),
    ]);
    expect(out.count).toBe(3);
    expect(out.progressTotal).toBe(39);
    expect(out.scored).toBe(2);
    expect(out.meanScore).toBe(7);
    expect(out.byStatus).toContainEqual({ status: "COMPLETED", count: 2 });
    expect(out.byStatus).toContainEqual({ status: "CURRENT", count: 1 });
  });

  /**
   * The same rule the rest of this file follows: an unscored entry is an
   * absence, not a zero. Averaging it in drags the mean toward an opinion
   * nobody holds.
   */
  it("leaves the unscored out of the mean and the distribution", () => {
    const out = localTotals([row({ score: 0 }), row({ mediaId: 2, score: 9 })]);
    expect(out.meanScore).toBe(9);
    expect(out.scoreCounts).toEqual([{ score: 9, count: 1 }]);
  });

  it("orders scores and years ascending, and skips media with no year", () => {
    const out = localTotals([
      row({ mediaId: 1, score: 9, media: { id: 1, seasonYear: 2021 } }),
      row({ mediaId: 2, score: 5, media: { id: 2, seasonYear: 2019 } }),
      row({ mediaId: 3, score: 9, media: { id: 3, seasonYear: null } }),
    ]);
    expect(out.scoreCounts).toEqual([
      { score: 5, count: 1 },
      { score: 9, count: 2 },
    ]);
    expect(out.releaseYears).toEqual([
      { year: 2019, count: 1 },
      { year: 2021, count: 1 },
    ]);
  });

  it("has an empty answer rather than a divide by zero", () => {
    const out = localTotals([]);
    expect(out.count).toBe(0);
    expect(out.meanScore).toBe(0);
    expect(out.byStatus).toEqual([]);
  });
});

describe("dayHeatmapFromHistory", () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

  /**
   * The measurement this exists for. AniList's `date` values sit either on UTC
   * midnight or 82,800s before one, and an account spanning late March carries
   * both — midnight in Europe/London, which is UTC in winter and UTC+1 in
   * summer. Rounding recovers the London date from either spelling without
   * consulting a timezone.
   */
  it("reads both spellings of a day bucket as the same day", () => {
    expect(historyDay(day("2026-01-05"))).toBe(day("2026-01-05"));
    // 23:00Z on the 16th is London's 17th.
    expect(historyDay(day("2026-07-17") - 3600)).toBe(day("2026-07-17"));
  });

  it("returns null when there is nothing to draw", () => {
    expect(dayHeatmapFromHistory(null)).toBeNull();
    expect(dayHeatmapFromHistory([])).toBeNull();
    expect(dayHeatmapFromHistory([{ date: day("2026-01-05"), amount: 0 }])).toBeNull();
  });

  it("lays the days out in Monday-first weeks", () => {
    // 2026-01-05 is a Monday; 2026-01-11 the Sunday that closes that week.
    const grid = dayHeatmapFromHistory([
      { date: day("2026-01-05"), amount: 3, level: 3 },
      { date: day("2026-01-11"), amount: 1, level: 1 },
    ])!;

    expect(grid.weeks).toHaveLength(1);
    expect(grid.weeks[0]).toHaveLength(7);
    expect(grid.weeks[0][0]).toMatchObject({ amount: 3, level: 3 });
    expect(grid.weeks[0][6]).toMatchObject({ amount: 1, level: 1 });
    // A day inside the range with no activity is a cell, not a gap.
    expect(grid.weeks[0][3]).toMatchObject({ amount: 0, level: 0 });
    expect(grid.total).toBe(4);
  });

  /** A week that starts mid-range is padded, so every column is seven tall. */
  it("pads the days before the first one with nulls", () => {
    // 2026-01-07 is a Wednesday, so Mon and Tue lead with padding.
    const grid = dayHeatmapFromHistory([
      { date: day("2026-01-07"), amount: 2, level: 5 },
    ])!;
    expect(grid.weeks[0][0]).toBeNull();
    expect(grid.weeks[0][1]).toBeNull();
    expect(grid.weeks[0][2]).toMatchObject({ amount: 2 });
    expect(grid.weeks[0][3]).toBeNull();
  });

  it("labels each month once, at the column it starts in", () => {
    const grid = dayHeatmapFromHistory([
      { date: day("2026-01-26"), amount: 1, level: 1 },
      { date: day("2026-02-09"), amount: 1, level: 1 },
    ])!;
    const months = grid.months.map((m) => m.month);
    expect(months).toEqual([0, 1]);
    expect(new Set(grid.months.map((m) => m.column)).size).toBe(grid.months.length);
  });

  /** Two rows for one day is not a shape AniList has shown, so it is folded
   *  rather than trusted to be absent. */
  it("folds a repeated day instead of dropping one", () => {
    const grid = dayHeatmapFromHistory([
      { date: day("2026-01-05"), amount: 2, level: 1 },
      { date: day("2026-01-05"), amount: 3, level: 7 },
    ])!;
    expect(grid.weeks[0][0]).toMatchObject({ amount: 5, level: 7 });
    expect(grid.total).toBe(5);
  });
});
