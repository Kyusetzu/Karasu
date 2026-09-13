import { useQueryClient } from "@tanstack/react-query";
import type { ListResult, MediaListEntry, MediaType } from "@/api/types";

/** The list entry for a media id from whichever list cache holds it; a read and never a fetch, for a failed screen. */
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
