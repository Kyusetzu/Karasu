/**
 * Scores, on one scale.
 *
 * Karasu shows ten-point scores everywhere, because every list query asks
 * AniList for `score(format: POINT_10)`. Its *statistics* endpoint does not
 * follow that: `meanScore` and `standardDeviation` always come back on
 * AniList's internal hundred-point scale, while the `scores` distribution comes
 * back in whatever format the user has chosen to see. That asymmetry is why the
 * statistics page was reporting a mean of 71 for a list the dashboard scored
 * 6.5 — the same number, twice as loud.
 */

/** A value AniList returned on its hundred-point scale, as a ten-point one. */
export function toTenPoint(score: number): number {
  return score / 10;
}

export interface ScoreBucket {
  score: number;
  count: number;
}

/**
 * A score distribution on the ten-point scale.
 *
 * A bucket above 10 can only mean the user scores out of 100, so those collapse
 * by tens — and the counts that land together are summed, because 85 and 87 are
 * both a 9 and drawing them as separate columns would invent a distinction the
 * user never made.
 *
 * A three- or five-point list is left alone. It is its own scale, not a tenth
 * of anything, and stretching it would put counts on scores nobody can give.
 */
export function normalizeDistribution(scores: ScoreBucket[]): ScoreBucket[] {
  if (scores.length === 0) return [];
  if (Math.max(...scores.map((s) => s.score)) <= 10) return scores;

  const merged = new Map<number, number>();
  for (const { score, count } of scores) {
    const bucket = Math.min(10, Math.max(1, Math.round(score / 10)));
    merged.set(bucket, (merged.get(bucket) ?? 0) + count);
  }
  return [...merged]
    .sort((a, b) => a[0] - b[0])
    .map(([score, count]) => ({ score, count }));
}

/** Every ranked-category key a `userStatistics` block can carry. */
const RANKED_KEYS = [
  "genres",
  "tags",
  "staff",
  "voiceActors",
  "studios",
  "startYears",
  "lengths",
  "formats",
  "statuses",
  "releaseYears",
  "countries",
] as const;

/**
 * One `userStatistics` block (anime or manga), with **every** hundred-point
 * number brought onto the ten-point scale in one pass.
 *
 * The old per-list spelling in `queries.ts` normalized exactly the lists the
 * screen rendered at the time — which is how `startYears.meanScore` and
 * `lengths.meanScore` were fetched for years and never normalized, a trap the
 * statistics overhaul would have walked straight into. This walks every ranked
 * key instead, and only touches a row that actually carries a numeric
 * `meanScore`, so a count-only list (`formats` today) passes through untouched
 * rather than gaining a `NaN`.
 */
export function normalizeStatsBlock<
  T extends {
    meanScore: number;
    standardDeviation: number;
    scores: { score?: number; count: number }[];
  },
>(stats: T): T {
  const out: Record<string, unknown> = {
    ...stats,
    meanScore: toTenPoint(stats.meanScore),
    standardDeviation: toTenPoint(stats.standardDeviation),
    scores: normalizeDistribution(stats.scores as ScoreBucket[]),
  };
  for (const key of RANKED_KEYS) {
    const rows = (stats as Record<string, unknown>)[key];
    if (!Array.isArray(rows)) continue;
    out[key] = rows.map((row) =>
      row && typeof row === "object" && typeof (row as { meanScore?: unknown }).meanScore === "number"
        ? { ...row, meanScore: toTenPoint((row as { meanScore: number }).meanScore) }
        : row,
    );
  }
  return out as T;
}
