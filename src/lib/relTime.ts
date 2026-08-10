/**
 * "3m", "5h", "2d", then a date.
 *
 * Lived privately inside `Bell` until the activity feed needed the same thing.
 * Extracted rather than pasted, on the same grounds as `UserLockup`: the second
 * copy is where two versions start disagreeing about when a relative time stops
 * being useful.
 *
 * The thresholds are the interesting part and they were already chosen: minutes
 * up to an hour, hours up to a day, days up to a week, and past that an absolute
 * date — because "9d" is worse than a date once nobody is counting.
 *
 * `now` is a parameter so this is testable without mocking the clock. Callers
 * never pass it.
 */
export function relTime(
  ms: number,
  lang: string,
  nowLabel: string,
  now: number = Date.now(),
): string {
  const min = Math.floor((now - ms) / 60_000);
  // A timestamp in the future reads as "now" rather than as a negative age;
  // clock skew between the user's machine and AniList's is real and small.
  if (min < 1) return nowLabel;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString(lang);
}

/** The same, from AniList's unix *seconds*. Every timestamp in its API is one. */
export function relTimeFromSeconds(
  seconds: number,
  lang: string,
  nowLabel: string,
  now?: number,
): string {
  return relTime(seconds * 1000, lang, nowLabel, now);
}
