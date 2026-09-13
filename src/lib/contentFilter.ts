/** Every content-filter rule lives here so no render site reimplements one; "Ecchi" is a genre, not `isAdult`. */
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

export type BlockReason = "adult" | "suggestive";

/** Why `media` is hidden at `level`, or null; adult wins over suggestive so a title is never counted twice. */
export function blockReason(
  media: Filterable | null | undefined,
  level: ContentFilterLevel,
): BlockReason | null {
  if (level === "off" || !media) return null;
  if (media.isAdult) return "adult";
  if (
    level === "strict" &&
    (media.genres ?? []).some((g) => SUGGESTIVE_GENRES.includes(g.toLowerCase()))
  ) {
    return "suggestive";
  }
  return null;
}

/** Whether `media` should be hidden at `level`. */
export function isBlocked(
  media: Filterable | null | undefined,
  level: ContentFilterLevel,
): boolean {
  return blockReason(media, level) !== null;
}

/** Whether a bare genre/tag name is hidden, for aggregate views that have no media object to test. */
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

/** The variables fragment; keep `$isAdult` absent rather than null when unfiltered, or AniList returns zero results. */
export function adultVars(isAdult?: boolean): { isAdult?: boolean } {
  return isAdult === undefined ? {} : { isAdult };
}

/** Narrows an unvalidated stored value to a level, defaulting to strict. */
export function toLevel(value: string | null | undefined): ContentFilterLevel {
  return value === "off" || value === "moderate" || value === "strict"
    ? value
    : "strict";
}

/** Whether explicit artwork arrives blurred; kept apart from `isBlocked` and `isAdult`-only, since Ecchi is a genre. */
export function shouldBlur(
  media: Filterable | null | undefined,
  level: ContentFilterLevel,
  blurAdult: boolean,
): boolean {
  if (!blurAdult || !media?.isAdult) return false;
  // A blocked title is never rendered, but a render site that forgot `isBlocked` should still blur.
  return !isBlocked(media, level) || level !== "off";
}
