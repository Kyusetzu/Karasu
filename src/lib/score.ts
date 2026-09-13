import { scoreScale, type ScoreFormat } from "./scoreFormat";

/** Statistics mix a hundred-point `meanScore` with a display-format distribution; this brings both onto the display scale. */

/** A value AniList returned on its hundred-point scale, in display units. */
export function toDisplayScale(f: ScoreFormat, score: number): number {
  return (score / 100) * scoreScale(f).max;
}

export interface ScoreBucket {
  score: number;
  count: number;
}

/** A distribution on the display scale: a bucket above `max` marks a stale hundred-point payload, collapsed and summed. */
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

/** Chart columns, every step present: fractions aggregate, `score <= 0` is unscored, above `max` means deciles. */
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

/** One `userStatistics` block with every ranked key's numeric `meanScore` normalized, so no list can be missed by name. */
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
