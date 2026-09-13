/** "3m", "5h", "2d", then an absolute date past a week; `now` is a parameter only so tests need not mock the clock. */
export function relTime(
  ms: number,
  lang: string,
  nowLabel: string,
  now: number = Date.now(),
): string {
  const min = Math.floor((now - ms) / 60_000);
  // A timestamp in the future reads as "now" rather than as a negative age, because clock skew against AniList is real.
  if (min < 1) return nowLabel;
  if (min < 60) return narrow(lang, min, "minute");
  const h = Math.floor(min / 60);
  if (h < 24) return narrow(lang, h, "hour");
  const d = Math.floor(h / 24);
  if (d < 7) return narrow(lang, d, "day");
  return new Date(ms).toLocaleDateString(lang);
}

/** Narrow-unit `NumberFormat` per language and unit, cached because constructing one is the expensive part of every row. */
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
    // An unrecognised tag throws rather than falling back, and `lang` comes from the browser and a stored override.
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
