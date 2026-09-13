import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { cachedMediaList, isTauri } from "@/api/anilist";
import type { MediaType } from "@/api/types";

const TYPES: MediaType[] = ["ANIME", "MANGA"];

/** Paints the list from SQLite before any fetch, dated as Rust dates it, and follows Rust's background refreshes. */
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
          // Dated by the real fetch, so a copy Rust would serve anyway is not refetched for the sake of a stale stamp.
          qc.setQueryData(key, cached, { updatedAt: cached.fetchedAt * 1000 });
        })
        .catch(() => {});
    }

    // Rust refreshed a stale list behind a served copy; the refetch reads the fresh copy for no request.
    const registered = listen<{ userId: number; mediaType: MediaType }>("list-refreshed", (event) => {
      void qc.invalidateQueries({ queryKey: ["mediaList", event.payload.mediaType, event.payload.userId] });
    });

    return () => {
      cancelled = true;
      void registered.then((unlisten) => unlisten());
    };
  }, [qc, userId]);
}
