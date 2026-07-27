import type { Media } from "@/api/types";

/**
 * Joins the searchable titles. A plain space would let a query straddle two
 * of them — "Foo Bar" + "Baz Qux" would match "bar baz" — so they are joined
 * with a character no keyboard produces and no query can contain.
 */
const SEPARATOR = "\u0000";

/**
 * Lowercased, pre-joined search text for one entry.
 *
 * The list page builds this once per list change instead of lowercasing four
 * titles plus every synonym, for every entry, on every keystroke.
 */
export function searchHaystack(
  media: Pick<Media, "title" | "synonyms">,
): string {
  const { romaji, english, native } = media.title;
  return [romaji, english, native, ...media.synonyms]
    .filter(Boolean)
    .join(SEPARATOR)
    .toLowerCase();
}
