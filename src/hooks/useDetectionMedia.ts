import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mediaByIds } from "@/api/queries";
import type { Media } from "@/api/types";
import { findCachedMedia } from "@/hooks/useCachedMedia";

const DAY_MS = 24 * 3600 * 1000;

/** The entry's media for the card: the list cache first, and one allowlisted request only for a title off the list. */
export function useDetectionMedia(mediaId: number | null): Media | null {
  const qc = useQueryClient();
  // Subscribed rather than read once: the card can mount before the list lands, and it must pick the cover up then.
  const cached = useSyncExternalStore(
    useCallback((notify: () => void) => qc.getQueryCache().subscribe(notify), [qc]),
    () => findCachedMedia(qc, mediaId ?? undefined)?.entry.media ?? null,
  );
  const fetched = useQuery({
    queryKey: ["detectionMedia", mediaId],
    queryFn: () => mediaByIds([mediaId!]).then((m) => m[0] ?? null),
    enabled: mediaId !== null && cached === null,
    staleTime: DAY_MS,
    gcTime: DAY_MS,
  });
  return cached ?? fetched.data ?? null;
}
