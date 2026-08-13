import type { MediaListEntry, MediaListStatus } from "@/api/types";

/**
 * The calendar's date arithmetic, pure and local.
 *
 * Everything here works in the user's local timezone through the `Date`
 * object, never by adding 86 400s to an epoch: "which weekday does this
 * episode land on" is a local question, and a DST transition makes one day of
 * the week 23 or 25 hours long. `setDate`/`setHours` absorb that; arithmetic
 * on seconds does not.
 */

/** Unix seconds of the local Monday 00:00 of the week containing `nowMs`. */
export function weekStartOf(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  // getDay is Sunday-first; the calendar is Monday-first, as a week of airing
  // anime is (the weekend is the destination, not the start).
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Math.floor(d.getTime() / 1000);
}

/** `startSec` moved by `n` local days, staying at local midnight across DST. */
export function addDays(startSec: number, n: number): number {
  const d = new Date(startSec * 1000);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** The seven local midnights of the week starting at `startSec`. */
export function weekDays(startSec: number): number[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startSec, i));
}

/** The local midnight of the day containing `sec`. */
export function localMidnight(sec: number): number {
  const d = new Date(sec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Distributes items into one bucket per day, each bucket sorted by time.
 *
 * An item outside every given day is dropped rather than clamped — the weekly
 * query windows are half-open at midnight, and an episode airing one second
 * past the week belongs to the next page, not to a stretched Sunday.
 */
export function bucketByLocalDay<T extends { airingAt: number }>(
  items: T[],
  days: number[],
): T[][] {
  const index = new Map(days.map((day, i) => [day, i]));
  const out: T[][] = days.map(() => []);
  for (const item of [...items].sort((a, b) => a.airingAt - b.airingAt)) {
    const i = index.get(localMidnight(item.airingAt));
    if (i !== undefined) out[i].push(item);
  }
  return out;
}

/** An upcoming episode of a show on the list — the zero-request lens. */
export interface ListAiring {
  mediaId: number;
  episode: number;
  airingAt: number;
  entry: MediaListEntry;
}

/**
 * The list's own airing data projected into a window: entries in the given
 * statuses whose `nextAiringEpisode` lands in `(gt, lt]`, soonest first.
 *
 * One episode per show is this source's honest limit — the cached list
 * carries only the *next* episode, which is also why the window is a week and
 * not a month. The default statuses match the Dashboard digest; the calendar
 * passes PLANNING too, because a planned premiere is exactly what a calendar
 * is for.
 */
export function fromList(
  entries: MediaListEntry[],
  gt: number,
  lt: number,
  statuses: MediaListStatus[] = ["CURRENT", "REPEATING"],
): ListAiring[] {
  return entries
    .filter(
      (e) =>
        statuses.includes(e.status) &&
        e.media.nextAiringEpisode &&
        e.media.nextAiringEpisode.airingAt > gt &&
        e.media.nextAiringEpisode.airingAt <= lt,
    )
    .map((e) => ({
      mediaId: e.mediaId,
      episode: e.media.nextAiringEpisode!.episode,
      airingAt: e.media.nextAiringEpisode!.airingAt,
      entry: e,
    }))
    .sort((a, b) => a.airingAt - b.airingAt);
}
