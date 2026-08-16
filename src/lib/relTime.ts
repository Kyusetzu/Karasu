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
  if (min < 60) return narrow(lang, min, "minute");
  const h = Math.floor(min / 60);
  if (h < 24) return narrow(lang, h, "hour");
  const d = Math.floor(h / 24);
  if (d < 7) return narrow(lang, d, "day");
  return new Date(ms).toLocaleDateString(lang);
}

/**
 * `3m` / `5h` / `2d`, in the reader's language.
 *
 * These were hardcoded English abbreviations sitting directly beside a
 * translated "now" — so a German bell read "vor kurzem", then "3m", "5h", "2d",
 * of which exactly one was German.
 *
 * `NumberFormat` with a narrow unit rather than `RelativeTimeFormat`, which is
 * the more obvious tool: the latter renders "3m ago" / "vor 3 Min.", and these
 * sit in a bell row, an activity header and a comment byline where the width is
 * the constraint. This keeps "3m" and gives "3 Min." — terse in both, and no
 * new keys, which is what makes it worth doing at all rather than inventing
 * three more strings per locale.
 *
 * Cached per language: `relTime` runs on every row of several lists, and
 * constructing a formatter is by far the expensive part of this function.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function narrow(lang: string, value: number, unit: "minute" | "hour" | "day"): string {
  const key = `${lang}:${unit}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.NumberFormatOptions = {
      style: "unit",
      unit,
      unitDisplay: "narrow",
    };
    // An unrecognised tag throws rather than falling back, and `lang` comes
    // from the browser and from a stored override.
    try {
      f = new Intl.NumberFormat(lang, options);
    } catch {
      f = new Intl.NumberFormat("en", options);
    }
    formatters.set(key, f);
  }
  return f.format(value);
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
