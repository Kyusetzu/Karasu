import type { Media } from "@/api/types";

/**
 * The searchable names of one entry — every title variant plus the synonyms,
 * in display order, holes dropped.
 *
 * `lib/fuzzy` scores each name on its own, which is what keeps a query from
 * matching across two adjacent names — the straddle bug the old NUL-joined
 * haystack existed to prevent, now prevented structurally.
 */
export function searchTitles(
  media: Pick<Media, "title" | "synonyms">,
): string[] {
  const { romaji, english, native } = media.title;
  return [romaji, english, native, ...media.synonyms].filter(
    (x): x is string => Boolean(x),
  );
}
