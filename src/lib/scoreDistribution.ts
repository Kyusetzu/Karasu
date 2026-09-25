import { fromRaw, scoreOptions, scoreScale, type ScoreFormat } from "@/lib/scoreFormat";

/** AniList's community score histogram brought onto the account's own scale, for the detail page's score control. */

export interface ScoreBucket {
  /** The score this bar sets, in the account's display units. */
  value: number;
  /** How many people gave a score that lands on this bar. */
  amount: number;
}

/** AniList reports ten buckets on the hundred-point scale, 10 to 100. */
const RAW_BUCKETS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** One bar per score a tap can set: the format's own steps where it has them, the ten buckets where it is continuous. */
export function scoreBuckets(
  format: ScoreFormat,
  distribution: readonly { score: number; amount: number }[] | null | undefined,
): ScoreBucket[] {
  const values = scoreOptions(format) ?? RAW_BUCKETS.map((raw) => fromRaw(format, raw));
  const amounts = new Map(values.map((v) => [v, 0]));
  for (const { score, amount } of distribution ?? []) {
    const value = fromRaw(format, score);
    if (amounts.has(value) && Number.isFinite(amount) && amount > 0) amounts.set(value, amounts.get(value)! + amount);
  }
  return values.map((value) => ({ value, amount: amounts.get(value)! }));
}

/** The total behind the bars; zero means there is no community picture to draw. */
export function totalVotes(buckets: readonly ScoreBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.amount, 0);
}

/** The community mean on the display scale, from AniList's hundred-point average. */
export function meanScore(format: ScoreFormat, average: number | null | undefined): number | null {
  if (average == null || !Number.isFinite(average) || average <= 0) return null;
  return (Math.min(100, average) / 100) * scoreScale(format).max;
}

/** Where the mean sits along the row of bars, 0 to 1 of its width, measured between the first and last bar centres. */
export function meanPosition(buckets: readonly ScoreBucket[], mean: number): number {
  const n = buckets.length;
  if (n === 0 || !Number.isFinite(mean)) return 0.5;
  if (n === 1) return 0.5;
  const first = buckets[0].value;
  const last = buckets[n - 1].value;
  const along = Math.min(1, Math.max(0, (mean - first) / (last - first)));
  return (0.5 + along * (n - 1)) / n;
}
