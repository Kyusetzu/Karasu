import type { TFunction } from "i18next";

/** The closed format enum per medium; one definition, or the list and search filters drift. */
export const MEDIA_FORMATS = {
  ANIME: ["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"],
  MANGA: ["MANGA", "NOVEL", "ONE_SHOT"],
} as const;

/** AniList media-format enum values we have explicit labels for. */
const KNOWN = new Set<string>([...MEDIA_FORMATS.ANIME, ...MEDIA_FORMATS.MANGA]);

/** Human-readable label for a media format; an unknown enum value is title-cased so it never leaks raw into the UI. */
export function formatLabel(
  format: string | null | undefined,
  t: TFunction,
): string {
  if (!format) return "";
  if (KNOWN.has(format)) return t(`format.${format}`);
  return titleCase(format);
}

/** `LIGHT_NOVEL` → "Light Novel". */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const KNOWN_STATUS = new Set([
  "FINISHED",
  "RELEASING",
  "NOT_YET_RELEASED",
  "CANCELLED",
  "HIATUS",
]);

/** Airing/publishing status of the work, distinct from the user's list status under `status.*`. */
export function mediaStatusLabel(
  status: string | null | undefined,
  t: TFunction,
): string {
  if (!status) return "";
  if (KNOWN_STATUS.has(status)) return t(`mediaStatus.${status}`);
  return titleCase(status);
}

const KNOWN_SOURCE = new Set([
  "ORIGINAL",
  "MANGA",
  "LIGHT_NOVEL",
  "VISUAL_NOVEL",
  "VIDEO_GAME",
  "OTHER",
  "NOVEL",
  "DOUJINSHI",
  "ANIME",
  "WEB_NOVEL",
  "LIVE_ACTION",
  "GAME",
  "COMIC",
  "MULTIMEDIA_PROJECT",
  "PICTURE_BOOK",
]);

/** What the work was adapted from (`LIGHT_NOVEL` → "Light Novel"). */
export function sourceLabel(
  source: string | null | undefined,
  t: TFunction,
): string {
  if (!source) return "";
  if (KNOWN_SOURCE.has(source)) return t(`source.${source}`);
  return titleCase(source);
}

/** Manhwa/Manhua are `countryOfOrigin`, not formats; one list here so MediaList and Search spell them alike. */
export const ORIGINS = ["JP", "KR", "CN", "TW"] as const;

/** Literal switch, so `i18nKeys.test.ts` sees every key. */
export function originLabel(
  origin: (typeof ORIGINS)[number],
  t: (k: string) => string,
): string {
  switch (origin) {
    case "JP":
      return t("list.originJP");
    case "KR":
      return t("list.originKR");
    case "CN":
      return t("list.originCN");
    case "TW":
      return t("list.originTW");
  }
}

/** AniList fuzzy dates have independently-nullable parts. */
export function fuzzyDate(
  date: { year: number | null; month: number | null; day: number | null } | null,
  locale: string,
): string {
  if (!date?.year) return "";
  if (!date.month) return String(date.year);
  // Day 1 is a stand-in when the day is unknown; it is not displayed then.
  const d = new Date(date.year, date.month - 1, date.day ?? 1);
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    ...(date.day ? { day: "numeric" } : {}),
  });
}

/** Coarse countdown to the next episode, at most two units: a glanceable value, not a ticking clock. */
export function countdown(secondsUntil: number, t: TFunction): string {
  if (secondsUntil <= 0) return "";
  const days = Math.floor(secondsUntil / 86400);
  const hours = Math.floor((secondsUntil % 86400) / 3600);
  const minutes = Math.floor((secondsUntil % 3600) / 60);
  if (days > 0) return t("detail.countdownDh", { d: days, h: hours });
  if (hours > 0) return t("detail.countdownHm", { h: hours, m: minutes });
  return t("detail.countdownM", { m: minutes });
}
