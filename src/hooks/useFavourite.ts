import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toggleFavourite, type FavouriteKind } from "@/api/social";
import type { MediaDetail } from "@/api/queries";
import { showToast } from "@/stores/toast";

/** Toggles a favourite optimistically; the filled heart is its own receipt, so only failure gets a toast. */
export function useFavourite(kind: FavouriteKind) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  /** Where this kind's detail lives: `Person` caches under its own key, and the two id namespaces must not be mixed. */
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
      // Only the profile's strip, never the detail entry just patched: that would refetch a full DETAIL_QUERY for one bit.
      void qc.invalidateQueries({ queryKey: ["social", "user"] });
    },
    onError: (_err, _vars, ctx) => {
      // The same key the patch used, not a rebuilt one: a rollback into a different entry is worse than none.
      if (ctx?.previous && ctx.key) qc.setQueryData(ctx.key, ctx.previous);
      showToast({
        kind: "error",
        text: t("detail.favouriteFailed"),
        detail: t("detail.favouriteFailedDetail"),
      });
    },
  });
}
