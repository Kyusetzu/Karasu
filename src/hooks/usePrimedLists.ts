import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cachedMediaList, isTauri } from "@/api/anilist";
import type { MediaType } from "@/api/types";

const TYPES: MediaType[] = ["ANIME", "MANGA"];

/** Paints the list from SQLite while the real fetch is in flight; `placeholderData` cannot, since IPC is async. */
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
          // Keep `updatedAt: 0`; it backdates the entry to stale so the mounting `useQuery` still refetches.
          qc.setQueryData(key, cached, { updatedAt: 0 });
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [qc, userId]);
}
