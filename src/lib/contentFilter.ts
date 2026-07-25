/**
 * Content filter. AniList flags genuinely explicit works with `isAdult`
 * (the "Hentai" genre); "Ecchi" is an ordinary genre and is *not* isAdult,
 * so hiding suggestive material needs the genre check on top.
 *
 * Everything filter-related lives here so no render site reimplements the
 * rules — a site that gets them subtly wrong is exactly how content leaks.
 */
export type ContentFilterLevel = "off" | "moderate" | "strict";

export const CONTENT_FILTER_LEVELS: ContentFilterLevel[] = [
  "off",
  "moderate",
  "strict",
];

/** Genres hidden at the strict level but allowed at moderate. */
const SUGGESTIVE_GENRES = ["ecchi"];

/** Shape every render site can supply; both fields are optional on purpose. */
export interface Filterable {
  isAdult?: boolean | null;
  genres?: string[] | null;
}

/** Whether `media` should be hidden at `level`. */
export function isBlocked(
  media: Filterable | null | undefined,
  level: ContentFilterLevel,
): boolean {
  if (level === "off" || !media) return false;
  if (media.isAdult) return true;
  if (level === "strict") {
    return (media.genres ?? []).some((g) =>
      SUGGESTIVE_GENRES.includes(g.toLowerCase()),
    );
  }
  return false;
}

/**
 * Whether a bare genre/tag *name* should be hidden. Aggregate views
 * (statistics, the year-in-review card) only have names to work with — no
 * media object to test — and "Hentai" appearing on a shareable image is the
 * most visible way this filter can fail.
 */
export function isBlockedGenre(
  name: string,
  level: ContentFilterLevel,
): boolean {
  if (level === "off") return false;
  const g = name.toLowerCase();
  if (g === "hentai") return true;
  return level === "strict" && SUGGESTIVE_GENRES.includes(g);
}

/** Server-side `isAdult` argument for Page.media, when it can be applied. */
export function adultQueryArg(level: ContentFilterLevel): boolean | undefined {
  return level === "off" ? undefined : false;
}

/** Narrows an unvalidated stored value to a level, defaulting to strict. */
export function toLevel(value: string | null | undefined): ContentFilterLevel {
  return value === "off" || value === "moderate" || value === "strict"
    ? value
    : "strict";
}
