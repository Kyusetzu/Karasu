import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchMediaList, flushQueue } from "@/api/anilist";
import type { MediaType } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";

/** The whole-app sync; the lists are fetched explicitly because invalidation only refetches active observers. */
export function useManualSync() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const [syncing, setSyncing] = useState(false);
  // A ref guards re-entry, since a held Ctrl+R fires repeatedly and the callback would close over a stale `syncing`.
  const busy = useRef(false);

  /** Local mode has nothing to sync; signed out has nobody to sync for. */
  const available = mode === "anilist" && viewer !== null;

  const sync = useCallback(async () => {
    const userId = useAuth.getState().viewer?.id;
    if (!userId || busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      // Drain first, so the lists fetched next already carry the queued edits; the order here is deliberate.
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
      await useAuth.getState().refreshViewer(); // The one cure for a stale cached scoreFormat changed on anilist.co.
      // The lists just fetched stay out of the invalidation, or an open list page refetches them at once.
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
