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

/**
 * The columns the score-distribution chart draws, `max` being the display
 * scale's top (`scoreScale(format).max`).
 *
 * The payload only carries the buckets in use, and possibly in fractions
 * (a POINT_10_DECIMAL account can hold an 8.5 bucket) — so exact-matching
 * integer steps drew an empty chart for those accounts. Counts are
 * aggregated instead: rounded onto integer steps for scales up to ten, and
 * onto ten decile columns for the hundred-point scale, which must not be
 * drawn as a hundred columns.
 *
 * Rules that look defensive and are not:
 * - a `score <= 0` bucket is "unscored", not a low score — dropped, never
 *   clamped into column 1;
 * - a bucket *above* `max` means the cached payload predates a format
 *   change; the data wins over the prop (escalate to deciles) because
 *   clamping would pile 11–100 into one bar and dropping would blank the
 *   chart. The reverse staleness is undetectable from the data alone and
 *   self-heals on refetch.
 *
 * Every step is returned, zero counts included — a gap must read as "none
 * at this score", not as a missing column.
 */
export function distributionColumns(
  data: { score?: number | null; count: number }[],
  max: number,
): { step: number; count: number }[] {
  const scored = data.filter((d) => (d.score ?? 0) > 0);
  if (scored.length === 0) return [];
  if (scored.some((d) => (d.score as number) > max)) max = 100;

  const decile = max > 10;
  const width = decile ? 10 : 1;
  const stepOf = (s: number) =>
    decile
      ? Math.min(100, Math.ceil(s / 10) * 10)
      : Math.max(1, Math.min(max, Math.round(s)));

  const counts = new Map<number, number>();
  for (const d of scored) {
    const step = stepOf(d.score as number);
    counts.set(step, (counts.get(step) ?? 0) + d.count);
  }
  return Array.from({ length: decile ? 10 : max }, (_, i) => {
    const step = (i + 1) * width;
    return { step, count: counts.get(step) ?? 0 };
  });
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
