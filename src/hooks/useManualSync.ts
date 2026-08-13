import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchMediaList, flushQueue } from "@/api/anilist";
import type { MediaType } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";

/**
 * The whole-app sync behind the sidebar button and Ctrl+R.
 *
 * `invalidateQueries` alone cannot be it: invalidation only refetches
 * *active* observers, and the sidebar's own `useListSummary` watches the
 * list keys with `enabled: false` — so from any page that doesn't mount a
 * list, nothing would fetch and "Synced just now" would never move. The
 * fetches are driven explicitly instead, which is what advances
 * `dataUpdatedAt` wherever the user happens to be standing.
 *
 * Order matters: drain the offline queue, fetch both lists (the two
 * requests that carry the app), refresh the viewer (an account's
 * scoreFormat/avatar/name changed on anilist.co lands here — the one cure
 * for a stale cached format), then mark everything *else* stale. The lists
 * just fetched are excluded from that invalidation, or an open list page
 * would immediately refetch what it was handed one line earlier.
 *
 * Three AniList requests per click, behind an explicit user action — the
 * shared ~30/min budget is spent with somebody asking.
 */
export function useManualSync() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const [syncing, setSyncing] = useState(false);
  // A ref, not the state, guards re-entry: Ctrl+R held down fires repeatedly
  // and the callback would otherwise close over a stale `syncing`.
  const busy = useRef(false);

  /** Local mode has nothing to sync; signed out has nobody to sync for. */
  const available = mode === "anilist" && viewer !== null;

  const sync = useCallback(async () => {
    const userId = useAuth.getState().viewer?.id;
    if (!userId || busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      await flushQueue().catch(() => {});
      await Promise.all(
        (["ANIME", "MANGA"] as MediaType[]).map((type) =>
          qc.fetchQuery({
            queryKey: ["mediaList", type, userId],
            queryFn: () => fetchMediaList(userId, type),
            staleTime: 0,
          }),
        ),
      );
      await useAuth.getState().refreshViewer();
      await qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "mediaList",
      });
    } catch (e) {
      showToast({ kind: "error", text: t("sync.failed"), detail: String(e) });
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [qc, t]);

  return { sync, syncing, available };
}
