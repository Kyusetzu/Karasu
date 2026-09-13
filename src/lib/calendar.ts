import type { MediaListEntry, MediaListStatus } from "@/api/types";

/** The calendar's date arithmetic, done through local `Date` methods because epoch arithmetic breaks across DST. */

/** Unix seconds of the local Monday 00:00 of the week containing `nowMs`. */
export function weekStartOf(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  // getDay is Sunday-first; the calendar is Monday-first, as a week of airing anime is.
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

/** Distributes items into one sorted bucket per day, dropping rather than clamping anything outside the given days. */
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

/** The list's own `nextAiringEpisode` data projected into `(gt, lt]`, soonest first — one episode per show. */
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
