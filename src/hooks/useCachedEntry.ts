import { useQuery } from "@tanstack/react-query";
import { fetchMediaList } from "@/api/anilist";
import type { MediaListEntry, MediaType } from "@/api/types";

/**
 * The user's list entry for one media, read out of the cache the list screens
 * already fill.
 *
 * `enabled: false` for the same reason as `useListSummary`: this subscribes to
 * the cache and never fetches. It is still a real observer, so an optimistic
 * save re-renders whatever is showing the entry — `getQueryData` would not.
 *
 * Returns `undefined` when the list has never been loaded this session, which
 * is indistinguishable here from "not on the list"; callers that need to tell
 * those apart should ask the entry's own screen instead.
 */
export function useCachedEntry(
  userId: number | undefined,
  type: MediaType | undefined,
  mediaId: number | undefined,
): MediaListEntry | undefined {
  const { data } = useQuery({
    queryKey: ["mediaList", type, userId],
    queryFn: () => fetchMediaList(userId as number, type as MediaType),
    enabled: false,
  });
  if (!mediaId) return undefined;
  return data?.lists.flatMap((g) => g.entries).find((e) => e.mediaId === mediaId);
}
