import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toggleFavourite, type FavouriteKind } from "@/api/social";
import type { MediaDetail } from "@/api/queries";
import { showToast } from "@/stores/toast";

/**
 * Favourite and unfavourite, optimistically.
 *
 * Like the heart on an activity, the filled state is its own receipt and its own
 * undo, so there is no toast on success — only on failure, which is the case the
 * interface has already claimed worked.
 *
 * `ToggleFavourite` returns the viewer's entire favourites connection, which is
 * far more than a heart needs, so the patch is driven by the call succeeding
 * rather than by the response. That makes the optimistic value the final value —
 * the one place in this feature where those are the same — which is fine because
 * the server holds exactly one bit and the toggle is what set it.
 *
 * The profile's favourites strip reads a different query, so it is invalidated
 * rather than patched: it is twelve entries behind a tab, nobody is looking at it
 * at the moment of the click, and reconstructing its ordering locally would mean
 * duplicating AniList's.
 */
export function useFavourite(kind: FavouriteKind) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  /**
   * Where this kind's detail actually lives.
   *
   * `["mediaDetail", id]` is where `AnimeDetail` caches, but `Person` caches
   * under `["person", kind, id]` — so on a character, staff or studio page the
   * heart patched a *media* entry keyed by a character id and never touched the
   * one on screen. Two separate id namespaces, so it was silent both ways: the
   * heart did not fill, and an unrelated media detail could be edited.
   */
  const cacheKey = (id: number): unknown[] =>
    kind === "anime" || kind === "manga"
      ? ["mediaDetail", id]
      : ["person", kind, id];

  return useMutation({
    mutationFn: (vars: { id: number }) => toggleFavourite(kind, vars.id),
    onMutate: async ({ id }) => {
      const key = cacheKey(id);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MediaDetail>(key);
      qc.setQueryData<MediaDetail>(key, (old) =>
        old ? { ...old, isFavourite: !old.isFavourite } : old,
      );
      return { previous, key };
    },
    onSuccess: () => {
      // Only the profile's strip, and only the *lists*, not the detail entry we
      // just patched — invalidating that would refetch a full DETAIL_QUERY to
      // learn one boolean we already know.
      void qc.invalidateQueries({ queryKey: ["social", "user"] });
    },
    onError: (_err, _vars, ctx) => {
      // The same key the patch used, not a rebuilt one — a rollback that
      // restores into a different entry than it edited is worse than none.
      if (ctx?.previous && ctx.key) qc.setQueryData(ctx.key, ctx.previous);
      showToast({
        kind: "error",
        text: t("detail.favouriteFailed"),
        detail: t("detail.favouriteFailedDetail"),
      });
    },
  });
}
