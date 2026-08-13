import { scoreScale, type ScoreFormat } from "./scoreFormat";

/**
 * Scores, on one scale — the account's own.
 *
 * Every list query asks AniList for `score(format: $scoreFormat)`, so entry
 * scores arrive in display units. The *statistics* endpoint does not follow
 * that: `meanScore` and `standardDeviation` always come back on AniList's
 * internal hundred-point scale, while the `scores` distribution comes back in
 * the user's display format. That asymmetry is why the statistics page once
 * reported a mean of 71 for a list the dashboard scored 6.5 — the same
 * number, twice as loud. Everything here converts the hundred-point half onto
 * the display scale at the boundary, so downstream code sees one scale.
 */

/** A value AniList returned on its hundred-point scale, in display units. */
export function toDisplayScale(f: ScoreFormat, score: number): number {
  return (score / 100) * scoreScale(f).max;
}

export interface ScoreBucket {
  score: number;
  count: number;
}

/**
 * A score distribution on the display scale, `max` being that scale's top.
 *
 * The distribution normally arrives already in the display format, so this is
 * usually the identity. The exception is transitional: the account's format
 * just changed and a cached response still carries the old scale, in which
 * case any bucket above `max` marks a hundred-point distribution — those
 * collapse proportionally, and the counts that land together are summed,
 * because 85 and 87 are both a 9 on a ten-point scale and drawing them as
 * separate columns would invent a distinction the user never made.
 */
export function normalizeDistribution(
  scores: ScoreBucket[],
  max = 10,
): ScoreBucket[] {
  if (scores.length === 0) return [];
  if (Math.max(...scores.map((s) => s.score)) <= max) return scores;

  const merged = new Map<number, number>();
  for (const { score, count } of scores) {
    const bucket = Math.min(max, Math.max(1, Math.round((score / 100) * max)));
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
 * number brought onto the display scale in one pass.
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
>(stats: T, format: ScoreFormat): T {
  const { max } = scoreScale(format);
  const out: Record<string, unknown> = {
    ...stats,
    meanScore: toDisplayScale(format, stats.meanScore),
    standardDeviation: toDisplayScale(format, stats.standardDeviation),
    scores: normalizeDistribution(stats.scores as ScoreBucket[], max),
  };
  for (const key of RANKED_KEYS) {
    const rows = (stats as Record<string, unknown>)[key];
    if (!Array.isArray(rows)) continue;
    out[key] = rows.map((row) =>
      row && typeof row === "object" && typeof (row as { meanScore?: unknown }).meanScore === "number"
        ? { ...row, meanScore: toDisplayScale(format, (row as { meanScore: number }).meanScore) }
        : row,
    );
  }
  return out as T;
}
