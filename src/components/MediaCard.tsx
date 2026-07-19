import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Plus, Star } from "lucide-react";
import { saveListEntry } from "@/api/anilist";
import { displayTitle } from "@/api/types";
import type { MediaWithListStatus } from "@/api/queries";
import { useAuth } from "@/stores/auth";
import EntryEditModal, { type EntrySaveInput } from "@/components/EntryEditModal";

/**
 * Card for discovery grids (search, season): quick add and full editing
 * (status/progress/score) straight from the results.
 */
export default function MediaCard({ media }: { media: MediaWithListStatus }) {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const saveEntry = useMutation({
    mutationFn: saveListEntry,
    onSuccess: (result, input) => {
      qc.invalidateQueries({ queryKey: ["mediaList"] });
      // Patch the discovery cache locally instead of refetching (rate limit)
      media.mediaListEntry = {
        id: result.entry?.id ?? media.mediaListEntry?.id ?? 0,
        status: input.status ?? media.mediaListEntry?.status ?? "PLANNING",
        progress: input.progress ?? media.mediaListEntry?.progress ?? 0,
        score: input.score ?? media.mediaListEntry?.score ?? 0,
        repeat: input.repeat ?? media.mediaListEntry?.repeat ?? 0,
        notes: input.notes ?? media.mediaListEntry?.notes ?? null,
      };
    },
  });

  const entry = media.mediaListEntry;

  return (
    <div className="group">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
        <Link to={`/media/${media.id}`}>
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
        {viewer && (
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <button
              onClick={() => setEditing(true)}
              className="grid h-8 w-8 place-items-center rounded-full bg-surface-900/90 text-ink-300 opacity-0 transition-opacity hover:bg-surface-800 hover:text-ink-100 group-hover:opacity-100"
              aria-label={t("common.edit")}
              title={t("common.edit")}
            >
              <Pencil size={14} />
            </button>
            {entry ? (
              <span
                className="grid h-8 w-8 place-items-center rounded-full bg-emerald-700/90 text-white"
                title={t(`status.${media.type}.${entry.status}`)}
              >
                <Check size={15} />
              </span>
            ) : (
              <button
                onClick={() =>
                  saveEntry.mutate({ mediaId: media.id, status: "PLANNING" })
                }
                disabled={saveEntry.isPending}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-white opacity-0 transition-opacity hover:bg-accent-500 group-hover:opacity-100 disabled:opacity-50"
                aria-label={t("media.addPlanning")}
                title={t("media.addPlanning")}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      <Link to={`/media/${media.id}`}>
        <p className="mt-2 line-clamp-2 text-xs font-medium text-ink-300 group-hover:text-ink-100">
          {displayTitle(media.title)}
        </p>
      </Link>
      <p className="text-xs text-ink-600">
        {[media.format, media.seasonYear].filter(Boolean).join(" · ")}
      </p>

      {editing && (
        <EntryEditModal
          media={media}
          entry={entry}
          onClose={() => setEditing(false)}
          onSave={(input: EntrySaveInput) => {
            saveEntry.mutate(input);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
