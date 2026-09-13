import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchMediaList } from "@/api/anilist";
import type { ListResult, MediaType } from "@/api/types";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";

const TYPES: MediaType[] = ["ANIME", "MANGA"];

export interface ListSummary {
  /** Entries the user actually has, per type — `null` until the list lands. */
  counts: Record<MediaType, number | null>;
  /** Edits sitting in the offline queue, unsent. */
  pending: number;
  /** When the newest of the two lists last came back, or `null`. */
  syncedAt: number | null;
}

/** Counts the way MediaList filters, so the sidebar number and the rows on screen can never disagree. */
function countEntries(
  data: ListResult | undefined,
  level: ReturnType<typeof useContentFilter.getState>["level"],
): number | null {
  if (!data) return null;
  let total = 0;
  for (const group of data.lists) {
    if (group.isCustomList) continue;
    for (const entry of group.entries) if (!isBlocked(entry.media, level)) total++;
  }
  return total;
}

/** A read-only view of the two list queries for the sidebar; keep `enabled: false`, or it refetches both lists. */
export function useListSummary(userId: number | undefined): ListSummary {
  const level = useContentFilter((s) => s.level);

  const results = useQueries({
    queries: TYPES.map((mediaType) => ({
      queryKey: ["mediaList", mediaType, userId],
      queryFn: () => fetchMediaList(userId as number, mediaType),
      enabled: false,
    })),
  });

  const [anime, manga] = results;

  // Nothing else re-renders the sidebar between navigations, so the relative time ticks on its own.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const syncedAt =
    Math.max(anime.dataUpdatedAt, manga.dataUpdatedAt) || null;

  return useMemo(
    () => ({
      counts: {
        ANIME: countEntries(anime.data, level),
        MANGA: countEntries(manga.data, level),
      },
      pending: Math.max(anime.data?.pending ?? 0, manga.data?.pending ?? 0),
      syncedAt,
    }),
    [anime.data, manga.data, level, syncedAt],
  );
}
