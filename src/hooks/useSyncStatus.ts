import { useQuery } from "@tanstack/react-query";
import { isTauri, syncStatus } from "@/api/anilist";
import type { SyncStatus } from "@/api/types";

/**
 * Polls the sync state while the panel is open.
 *
 * `enabled` is the whole design. The command touches SQLite and two in-process
 * values and costs no AniList request, so a second is a fine interval — but it
 * is still a Tauri round-trip per tick, and there is nothing to look at when the
 * panel is closed. Nothing here polls in the background.
 *
 * `refetchInterval` rather than a `setInterval`: a countdown that keeps running
 * while the window is in the tray is a countdown nobody reads, and TanStack
 * already stops on blur unless told otherwise.
 *
 * No `staleTime`. This is a live reading, and a cached one is the failure mode —
 * "draining" left on screen after the drain finished is exactly the lie the
 * panel is meant to end.
 */
export function useSyncStatus(open: boolean) {
  return useQuery<SyncStatus>({
    queryKey: ["syncStatus"],
    queryFn: syncStatus,
    enabled: open && isTauri,
    refetchInterval: 1_000,
    staleTime: 0,
    // A failed status read is a state to render, not one to retry into. The
    // panel says so, and the next tick tries again anyway.
    retry: false,
  });
}
