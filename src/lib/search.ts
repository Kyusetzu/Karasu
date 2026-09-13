import type { Media } from "@/api/types";

/** One entry's searchable names as separate docs for `lib/fuzzy`, never joined, so a query cannot straddle two names. */
export function searchTitles(
  media: Pick<Media, "title" | "synonyms">,
): string[] {
  const { romaji, english, native } = media.title;
  return [romaji, english, native, ...media.synonyms].filter(
    (x): x is string => Boolean(x),
  );
}
