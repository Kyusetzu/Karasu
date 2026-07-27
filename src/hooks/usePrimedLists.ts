import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cachedMediaList, isTauri } from "@/api/anilist";
import type { MediaType } from "@/api/types";

const TYPES: MediaType[] = ["ANIME", "MANGA"];

/**
 * Paints the list from SQLite while the real fetch is still in flight.
 *
 * `fetch_media_list` always awaits AniList, so without this a cold start shows
 * a loading state for a full round trip even though a complete list is already
 * on disk. Priming the query cache from SQLite lets the first frame render real
 * content, and the refetch swaps in fresh data underneath.
 *
 * This has to be `setQueryData`, not `placeholderData`: the cached list arrives
 * over an async IPC call, and `placeholderData` is required to be synchronous.
 *
 * **`updatedAt: 0` is load-bearing.** It backdates the entry so it is already
 * stale, which is what keeps the mounting `useQuery` firing its own refetch.
 * Without it TanStack treats the primed value as fresh and suppresses the
 * network call for the whole `staleTime` — the list would silently stop
 * updating for five minutes after every launch.
 *
 * Priming is racy by nature and that is fine: if a query is already in flight
 * the observer simply renders this data as soon as it lands and the real
 * response overwrites it a moment later.
 */
export function usePrimedLists(userId: number | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!isTauri || !userId) return;
    let cancelled = false;

    for (const mediaType of TYPES) {
      cachedMediaList(userId, mediaType)
        .then((cached) => {
          if (cancelled || !cached) return;
          const key = ["mediaList", mediaType, userId];
          // Never clobber a response that already arrived.
          if (qc.getQueryData(key)) return;
          qc.setQueryData(key, cached, { updatedAt: 0 });
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [qc, userId]);
}
