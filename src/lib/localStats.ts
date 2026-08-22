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

// --- Totals -----------------------------------------------------------------

export interface LocalTotals {
  count: number;
  /** Episodes watched or chapters read, summed across the list. */
  progressTotal: number;
  scored: number;
  /** Mean of the scored entries, display units; 0 when nothing is scored. */
  meanScore: number;
  byStatus: { status: string; count: number }[];
  /** Score → how many entries hold it, for the distribution columns. */
  scoreCounts: { score: number; count: number }[];
  releaseYears: { year: number; count: number }[];
}

/**
 * The figures AniList's statistics endpoint would return, counted from the
 * list instead.
 *
 * Every one of these is derivable from entries the app already holds, which is
 * the whole reason the account-free profile can have a statistics screen at
 * all. What is *not* here is what AniList precomputes and Karasu cannot:
 * minutes watched (no duration on a list entry), and the genre, tag, studio,
 * voice-actor and staff rankings, which need a join across every media the user
 * has ever touched.
 *
 * Deliberately not filtered: the caller has already applied the content filter,
 * the same way every other panel on that screen reads its pool.
 */
export function localTotals(entries: MediaListEntry[]): LocalTotals {
  const byStatus = new Map<string, number>();
  const scores = new Map<number, number>();
  const years = new Map<number, number>();
  let progressTotal = 0;
  let scoreSum = 0;
  let scored = 0;

  for (const e of entries) {
    byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
    progressTotal += e.progress ?? 0;
    if (e.score > 0) {
      scored += 1;
      scoreSum += e.score;
      scores.set(e.score, (scores.get(e.score) ?? 0) + 1);
    }
    // `seasonYear` rather than `startDate`: the list query carries it, and it
    // is the year the *title* is from — which is what a release-year chart is
    // asking. A missing one is left out rather than bucketed as 0.
    const year = e.media.seasonYear;
    if (year) years.set(year, (years.get(year) ?? 0) + 1);
  }

  return {
    count: entries.length,
    progressTotal,
    scored,
    meanScore: scored > 0 ? scoreSum / scored : 0,
    byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
    scoreCounts: [...scores]
      .map(([score, count]) => ({ score, count }))
      .sort((a, b) => a.score - b.score),
    releaseYears: [...years]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
  };
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

// --- AniList's own activity history, at day resolution -------------------

/**
 * AniList's five intensity buckets, as it actually reports them.
 *
 * `level` on `activityHistory` came back as **1, 3, 5, 7, 9** across the
 * accounts measured — five odd steps, which is why `Heatmap`'s five opacities
 * map onto it one-for-one. Taking AniList's bucket rather than re-deriving
 * thresholds from `amount` is the same decision `normalizeStatsBlock` makes:
 * when the API has already answered a question, answering it again locally is
 * how the two come to disagree.
 */
export const HISTORY_LEVELS = [1, 3, 5, 7, 9] as const;

/**
 * Which day a history bucket belongs to, as a UTC midnight.
 *
 * **The dates are not UTC days.** Measured across two accounts, every `date`
 * sits either exactly on UTC midnight or exactly 82,800s (23:00) before one —
 * and an account whose range crosses late March carries both. That is the
 * signature of midnight in **Europe/London**: UTC in winter, UTC+1 in summer.
 *
 * So a bucket stamped 23:00Z on 16 July is London's 17 July, and reading it
 * with `getUTCDate` would put it on the 16th while reading it in the viewer's
 * local time would put it wherever the viewer happens to be — off by one for
 * anyone west of London. Rounding to the nearest UTC day recovers the London
 * date from both spellings and depends on no timezone at all.
 */
export function historyDay(dateSeconds: number): number {
  return Math.round(dateSeconds / 86400) * 86400;
}

/** One cell of the day grid. `null` pads the first and last weeks. */
export interface HeatmapDay {
  /** UTC midnight of the day this cell is, in seconds. */
  day: number;
  amount: number;
  /** AniList's own bucket, 1–9. Zero for a day with no activity. */
  level: number;
}

export interface DayHeatmap {
  /** Columns, oldest first. Each is seven cells, Monday first. */
  weeks: (HeatmapDay | null)[][];
  /** Column index where each month's first cell falls, for the top axis. */
  months: { column: number; month: number }[];
  total: number;
  /** The range actually covered, as UTC midnights. */
  from: number;
  to: number;
}

/**
 * AniList's activity history as a week × weekday grid — the shape its own
 * profile draws.
 *
 * Returns `null` when there is nothing to draw, which is also what local mode
 * always gets: `activityHistory` belongs to an account, so there is no local
 * equivalent and `activityHeatmap`'s month grid stays the fallback rather than
 * being replaced by an empty one.
 *
 * Note what the range is *not*: a fixed year. Two accounts measured spanned 34
 * and 186 days, both ending at the same date, so whether AniList caps the
 * window or those accounts are simply that old could not be established. The
 * grid therefore draws exactly the range it was given rather than padding out
 * to a year that may be a fiction.
 */
export function dayHeatmapFromHistory(
  history: { date: number; amount: number; level?: number | null }[] | null | undefined,
): DayHeatmap | null {
  const byDay = new Map<number, { amount: number; level: number }>();
  let total = 0;
  for (const entry of history ?? []) {
    if (!Number.isFinite(entry?.date) || !Number.isFinite(entry?.amount)) continue;
    const amount = Math.max(0, Math.trunc(entry.amount));
    if (amount === 0) continue;
    const day = historyDay(entry.date);
    const level = Number.isFinite(entry.level) ? Math.max(1, Math.trunc(entry.level as number)) : 1;
    const prev = byDay.get(day);
    // A duplicate day keeps the louder of the two rather than the later one.
    byDay.set(day, {
      amount: (prev?.amount ?? 0) + amount,
      level: Math.max(prev?.level ?? 0, level),
    });
    total += amount;
  }
  if (total === 0) return null;

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const from = days[0];
  const to = days[days.length - 1];

  // Monday-first, because that is what a week is in every locale this app
  // ships. `getUTCDay` is Sunday-first, hence the rotation.
  const weekdayOf = (day: number) => (new Date(day * 1000).getUTCDay() + 6) % 7;
  const start = from - weekdayOf(from) * 86400;

  const weeks: (HeatmapDay | null)[][] = [];
  const months: { column: number; month: number }[] = [];
  // Keyed by year and month, so January twice over is two labels; and a month
  // stays *unlabelled* until a column is free for it. Advancing a "last month
  // seen" cursor instead loses any month that begins in a column another month
  // already claimed — February starting on a Sunday vanished entirely.
  const labelled = new Set<number>();
  for (let day = start, column = 0; day <= to; column += 1) {
    const week: (HeatmapDay | null)[] = [];
    for (let i = 0; i < 7; i += 1, day += 86400) {
      if (day < from || day > to) {
        week.push(null);
        continue;
      }
      const hit = byDay.get(day);
      week.push({ day, amount: hit?.amount ?? 0, level: hit?.level ?? 0 });
      const when = new Date(day * 1000);
      const key = when.getUTCFullYear() * 12 + when.getUTCMonth();
      // One label per column, and the leftmost column each month can have.
      if (!labelled.has(key) && !months.some((m) => m.column === column)) {
        labelled.add(key);
        months.push({ column, month: when.getUTCMonth() });
      }
    }
    weeks.push(week);
  }

  return { weeks, months, total, from, to };
}
