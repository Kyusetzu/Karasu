import { useQueryClient } from "@tanstack/react-query";
import type { ListResult, MediaListEntry, MediaType } from "@/api/types";

/**
 * The list entry for a media id, from whichever list cache already holds it.
 *
 * Deliberately a *read* and never a fetch: `getQueriesData` looks at what
 * TanStack already has and asks the network for nothing. It exists for the
 * one moment that matters — a screen whose own query just failed — so
 * triggering a request there would be asking again for the thing that was
 * refused.
 *
 * Distinct from `useCachedEntry`, which is gated to local mode and takes the
 * type and user id it looks under. Here neither is known: the detail page
 * learns whether a title is anime or manga *from* the query that failed, so
 * this searches every `["mediaList", …]` cache and reports which one answered.
 *
 * The entry carries its own `media` object — LIST_QUERY's reduced one, with
 * the title, the cover and the episode count, but no banner and no studios.
 * That is enough to say what a title is and to edit your progress on it, which
 * is what an offline detail page is for.
 */
export function useCachedMedia(mediaId: number | undefined): {
  entry: MediaListEntry;
  mediaType: MediaType;
  userId: number;
} | null {
  const qc = useQueryClient();
  if (!mediaId) return null;

  for (const [key, data] of qc.getQueriesData<ListResult>({
    queryKey: ["mediaList"],
  })) {
    const entry = data?.lists
      .flatMap((g) => g.entries)
      .find((e) => e.mediaId === mediaId);
    if (!entry) continue;
    // `["mediaList", mediaType, userId]` — the shape every list screen builds.
    const [, mediaType, userId] = key as [string, MediaType, number];
    if (!mediaType || typeof userId !== "number") continue;
    return { entry, mediaType, userId };
  }
  return null;
}
