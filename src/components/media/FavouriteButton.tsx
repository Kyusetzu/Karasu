import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import type { FavouriteKind } from "@/api/social";
import { useFavourite } from "@/hooks/useFavourite";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/utils";

/**
 * The favourite heart.
 *
 * Renders nothing without an AniList account, matching `FollowButton`: a
 * favourite lives on the account, and the local list has nowhere to put one.
 *
 * `isFavouriteBlocked` is AniList refusing the toggle for a particular entry
 * rather than a permissions problem on our side, so the control is shown
 * disabled with an explanation instead of vanishing — vanishing would read as
 * Karasu not supporting favourites for that title.
 */
export function FavouriteButton({
  kind,
  id,
  isFavourite,
  blocked,
}: {
  kind: FavouriteKind;
  id: number;
  isFavourite: boolean | null;
  blocked?: boolean | null;
}) {
  const { t } = useTranslation();
  const mode = useAuth((s) => s.mode);
  const fav = useFavourite(kind);

  if (mode !== "anilist") return null;

  const on = isFavourite === true;

  return (
    <button
      type="button"
      onClick={() => !blocked && fav.mutate({ id })}
      disabled={fav.isPending || blocked === true}
      aria-pressed={on}
      // The action, not the state — a control announced as "Favourited" implies
      // pressing it would favourite.
      aria-label={on ? t("detail.unfavouriteAria") : t("detail.favouriteAria")}
      title={blocked ? t("detail.favouriteBlocked") : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-surface",
        blocked
          ? "cursor-not-allowed border-surface-800 text-ink-600 opacity-55"
          : on
            ? "border-danger/50 text-danger hover:bg-danger/10"
            : "border-surface-700 text-ink-500 hover:border-surface-600 hover:text-ink-300",
      )}
    >
      <Heart className={cn("size-3.5", on && "fill-current")} />
      {on ? t("detail.favourited") : t("detail.favourite")}
    </button>
  );
}
