import type { FuzzyDate, MediaListEntry } from "@/api/types";
import { displayTitle } from "@/api/types";

/**
 * Statistics AniList cannot answer, computed from the cached list.
 *
 * `LIST_QUERY` already carries per-entry scores, the community's
 * `averageScore`, fuzzy start/completion dates and season facts — enough for
 * whole tabs that cost **zero requests** and work offline. Everything here is
 * pure over the entries the caller already holds; the content filter runs at
 * the call site, on the same filtered pool every other panel reads.
 *
 * Scores: the user's arrive in the account's display format, the community's
 * is hundred-point (`averageScore`) — brought onto the display scale here, at
 * the boundary, like `normalizeStatsBlock` does for the statistics endpoint.
 */

export interface DeltaRow {
  mediaId: number;
  title: string;
  /** The user's score, in display units. */
  mine: number;
  /** The community mean, brought onto the same scale. */
  community: number;
  /** `mine - community` — negative means harsher than the crowd. */
  delta: number;
}

export interface ScoreDeltaSummary {
  /** Entries that carry both scores — the honest denominator. */
  count: number;
  meanMine: number;
  meanCommunity: number;
  /** Mean of the per-entry deltas. */
  meanDelta: number;
  /** The user's biggest downward disagreements, most negative first. */
  harshest: DeltaRow[];
  /** The biggest upward ones, most positive first. */
  kindest: DeltaRow[];
}

/**
 * How the user's scores sit against the community's, for the titles where
 * both exist. Unscored entries and titles AniList has no mean for are
 * excluded rather than counted as zero — a zero *is* the absence here, and
 * averaging it in would drag the mean toward an opinion nobody holds.
 */
export function scoreDelta(
  entries: MediaListEntry[],
  top = 5,
  /** The display scale's maximum, from `scoreScale(format).max`. */
  max = 10,
): ScoreDeltaSummary | null {
  const seen = new Set<number>();
  const rows: DeltaRow[] = [];
  for (const e of entries) {
    if (seen.has(e.mediaId)) continue;
    seen.add(e.mediaId);
    const community = e.media.averageScore;
    if (!e.score || e.score <= 0 || community == null || community <= 0) continue;
    const communityScaled = (community / 100) * max;
    rows.push({
      mediaId: e.mediaId,
      title: displayTitle(e.media.title),
      mine: e.score,
      community: communityScaled,
      delta: e.score - communityScaled,
    });
  }
  if (rows.length === 0) return null;

  const mean = (pick: (r: DeltaRow) => number) =>
    rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
  const byDelta = [...rows].sort((a, b) => a.delta - b.delta);

  return {
    count: rows.length,
    meanMine: mean((r) => r.mine),
    meanCommunity: mean((r) => r.community),
    meanDelta: mean((r) => r.delta),
    harshest: byDelta.filter((r) => r.delta < 0).slice(0, top),
    kindest: byDelta
      .filter((r) => r.delta > 0)
      .reverse()
      .slice(0, top),
  };
}

// --- Activity heatmap -------------------------------------------------------

export interface HeatmapYear {
  year: number;
  /** Events per calendar month, index 0 = January. */
  months: number[];
}

export interface ActivityHeatmap {
  /** Oldest first, at most `maxYears` of them. */
  years: HeatmapYear[];
  /** The busiest cell, for the intensity scale. */
  max: number;
  total: number;
}

/**
 * When the list was actually worked on: every start and every completion with
 * a known year *and* month becomes one event in its cell.
 *
 * Fuzzy-date honesty is the whole trick here — AniList dates are legitimately
 * partial ("2019", "March 2024"), and a year-only date is **skipped**, never
 * pinned to January: a fabricated cell reads exactly like a real one and
 * poisons the picture. Both dates count, deliberately — starting and
 * finishing are both activity, and a show begun in March and finished in May
 * was worked on in both months.
 */
export function activityHeatmap(
  entries: MediaListEntry[],
  maxYears = 8,
): ActivityHeatmap | null {
  const byYear = new Map<number, number[]>();
  let total = 0;
  const record = (d: FuzzyDate | null) => {
    if (!d?.year || !d.month || d.month < 1 || d.month > 12) return;
    const months = byYear.get(d.year) ?? Array.from({ length: 12 }, () => 0);
    months[d.month - 1] += 1;
    byYear.set(d.year, months);
    total += 1;
  };
  for (const e of entries) {
    record(e.startedAt);
    record(e.completedAt);
  }
  if (total === 0) return null;

  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-maxYears)
    .map(([year, months]) => ({ year, months }));
  const max = Math.max(...years.flatMap((y) => y.months), 1);
  return { years, max, total };
}

// --- Seasonal habits --------------------------------------------------------

export const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export type SeasonName = (typeof SEASONS)[number];

export interface SeasonCount {
  season: SeasonName;
  count: number;
  /** Mean of the user's own scores in that season, display units; 0 = unscored. */
  meanScore: number;
}

/**
 * Which broadcast seasons the list is drawn from, with how the user scored
 * each — "am I a fall person". Seasonless media (most manga, some films) are
 * simply outside the question rather than a fifth bucket.
 */
export function seasonalHistory(entries: MediaListEntry[]): SeasonCount[] {
  const seen = new Set<number>();
  const counts = new Map<SeasonName, { count: number; scoreSum: number; scored: number }>();
  for (const e of entries) {
    const season = e.media.season as SeasonName | null;
    if (!season || !SEASONS.includes(season) || seen.has(e.mediaId)) continue;
    seen.add(e.mediaId);
    const bucket = counts.get(season) ?? { count: 0, scoreSum: 0, scored: 0 };
    bucket.count += 1;
    if (e.score > 0) {
      bucket.scoreSum += e.score;
      bucket.scored += 1;
    }
    counts.set(season, bucket);
  }
  return SEASONS.filter((s) => counts.has(s)).map((season) => {
    const b = counts.get(season)!;
    return {
      season,
      count: b.count,
      meanScore: b.scored > 0 ? b.scoreSum / b.scored : 0,
    };
  });
}
