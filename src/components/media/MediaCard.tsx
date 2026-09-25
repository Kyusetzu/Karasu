import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { TitleLockup } from "@/components/media/TitleLockup";
import { CoverCell, CoverMeta } from "@/components/media/CoverCell";
import { saveListEntry } from "@/api/anilist";

import { formatLabel } from "@/lib/format";
import { displayTitle, type MediaListStatus } from "@/api/types";
import { statusColorVar } from "@/lib/statusColors";
import { useCachedEntry } from "@/hooks/useCachedEntry";
import { loadDefaultAddStatus } from "@/lib/defaultAddStatus";
import { withCompletion } from "@/lib/completion";
import { shouldBlur } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import type { MediaWithListStatus } from "@/api/queries";
import { useAuth } from "@/stores/auth";
import EntryEditModal, { type EntrySaveInput } from "@/components/media/EntryEditModal";
import { PresenceIf } from "@/components/ui/presence";

/** Card for discovery grids (search, season): quick add and full editing straight from the results. */
export default function MediaCard({
  media,
  focused = false,
}: {
  media: MediaWithListStatus;
  /** The roving keyboard cursor is on this card — see `useGridRoving`. */
  focused?: boolean;
}) {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const hasProfile = viewer !== null || mode === "local";
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const saveEntry = useMutation({
    mutationFn: (input: Parameters<typeof saveListEntry>[0]) =>
      saveListEntry(input, media),
    onSuccess: (result, input) => {
      // Only this card's collection: saving an anime cannot change the manga list, and the broad key refetched both.
      qc.invalidateQueries({ queryKey: ["mediaList", media.type] });
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

  /** Keep the local fallback: `mediaListEntry` is null in local mode, and the editor would write over the real entry. */
  const cached = useCachedEntry(0, media.type, media.id);
  const entry = media.mediaListEntry ?? cached ?? null;
  // Filled before `mutate`, so the stub patched from the variables shows the totals the write carried.
  const send = (input: EntrySaveInput | { mediaId: number; status: MediaListStatus }) =>
    saveEntry.mutate(withCompletion(input, media, media.type, entry?.status ?? null));
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);

  return (
    <CoverCell
      to={`/media/${media.id}`}
      // The roving cursor is not real DOM focus, so the ring is drawn rather than inherited from `:focus-visible`.
      className={focused ? "rounded-cover ring-2 ring-accent-500" : undefined}
      cover={media.coverImage.large}
      // Null when the title is not on the list, so an unlisted title has no ring rather than a grey one.
      statusRing={entry ? statusColorVar(entry.status) : null}
      score={media.averageScore != null ? `${media.averageScore}%` : null}
      adult={media.isAdult === true}
      blurred={shouldBlur(media, level, blurAdult)}
      revealLabel={displayTitle(media.title)}
      data-media-id={media.id}
      data-media-type={media.type}
      data-media-title={displayTitle(media.title)}
      actions={
        hasProfile && (
          <>
            {/* Below two circles' width a cover keeps one, the entry's own state rather than the editor. */}
            <IconButton
              variant="onCover"
              size="sm"
              round
              onClick={() => setEditing(true)}
              aria-label={t("common.edit")}
              title={t("common.edit")}
              className="@max-cover-pair:hidden"
            >
              <Pencil className="size-3.5" />
            </IconButton>
            {entry ? (
              // Tinted to match the ring, so the badge and the border say the same thing.
              <span
                className="grid size-7.5 place-items-center rounded-full text-surface-950"
                style={{ background: statusColorVar(entry.status) }}
                title={t(`status.${media.type}.${entry.status}`)}
              >
                <Check className="size-3.75" />
              </span>
            ) : (
              // The neutral circle: adding to Planning is not the same weight as a +1, and the accent is reserved for that.
              <IconButton
                variant="onCover"
                size="sm"
                round
                onClick={() =>
                  send({
                    mediaId: media.id,
                    status: loadDefaultAddStatus(),
                  })
                }
                disabled={saveEntry.isPending}
                aria-label={t("media.addDefault")}
                title={t("media.addDefault")}
              >
                <Plus className="size-4" />
              </IconButton>
            )}
          </>
        )
      }
    >
      <Link to={`/media/${media.id}`}>
        <TitleLockup
          title={media.title}
          clamp={2}
          tone="muted"
          className="mt-2"
        />
      </Link>
      <CoverMeta>
        {[formatLabel(media.format, t), media.seasonYear]
          .filter(Boolean)
          .join(" · ")}
      </CoverMeta>

      <PresenceIf when={editing}>
        {(leaving) => (
          <EntryEditModal
            leaving={leaving}
            media={media}
            entry={entry}
            onClose={() => setEditing(false)}
            onSave={(input: EntrySaveInput) => {
              send(input);
              setEditing(false);
            }}
          />
        )}
      </PresenceIf>
    </CoverCell>
  );
}
