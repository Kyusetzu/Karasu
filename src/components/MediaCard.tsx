import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Plus, Star } from "lucide-react";
import { saveListEntry } from "@/api/anilist";
import { displayTitle } from "@/api/types";
import type { MediaWithListStatus } from "@/api/queries";
import { useAuth } from "@/stores/auth";

/** Karte für Discovery-Grids (Suche, Saison) mit Schnell-Hinzufügen. */
export default function MediaCard({ media }: { media: MediaWithListStatus }) {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const qc = useQueryClient();

  const addToList = useMutation({
    mutationFn: () =>
      saveListEntry({ mediaId: media.id, status: "PLANNING" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["animeList"] });
      // Discovery-Caches nur lokal patchen statt neu zu laden
      media.mediaListEntry = { id: 0, status: "PLANNING" };
    },
  });

  const onList = media.mediaListEntry !== null || addToList.isSuccess;

  return (
    <div className="group">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
        <Link to={`/anime/${media.id}`}>
          {media.coverImage.large && (
            <img
              src={media.coverImage.large}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          )}
        </Link>
        {media.averageScore !== null && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-amber-300">
            <Star size={11} fill="currentColor" /> {media.averageScore}%
          </span>
        )}
        {viewer &&
          (onList ? (
            <span
              className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-emerald-700/90 text-white"
              title={
                media.mediaListEntry
                  ? t(`status.${media.mediaListEntry.status}`)
                  : t("media.onList")
              }
            >
              <Check size={15} />
            </span>
          ) : (
            <button
              onClick={() => addToList.mutate()}
              disabled={addToList.isPending}
              className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-white opacity-0 transition-opacity hover:bg-accent-500 group-hover:opacity-100 disabled:opacity-50"
              aria-label={t("media.addPlanning")}
              title={t("media.addPlanning")}
            >
              <Plus size={16} />
            </button>
          ))}
      </div>
      <Link to={`/anime/${media.id}`}>
        <p className="mt-2 line-clamp-2 text-xs font-medium text-ink-300 group-hover:text-ink-100">
          {displayTitle(media.title)}
        </p>
      </Link>
      <p className="text-xs text-ink-600">
        {[media.format, media.seasonYear].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
