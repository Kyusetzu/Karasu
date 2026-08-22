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
import { displayTitle } from "@/api/types";
import { statusColorVar } from "@/lib/statusColors";
import { useCachedEntry } from "@/hooks/useCachedEntry";
import { shouldBlur } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import type { MediaWithListStatus } from "@/api/queries";
import { useAuth } from "@/stores/auth";
import EntryEditModal, { type EntrySaveInput } from "@/components/media/EntryEditModal";
import { PresenceIf } from "@/components/ui/presence";

/**
 * Card for discovery grids (search, season): quick add and full editing
 * (status/progress/score) straight from the results.
 */
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
      // Only the collection this card belongs to — saving an anime cannot
      // change the manga list, and the broad key refetched both.
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

  /**
   * The list entry, from AniList or — in the account-free profile — from the
   * local list.
   *
   * `mediaListEntry` is null for *every* title in local mode: `anilist_query`
   * sends no token there and AniList has never heard of the local list. Without
   * the fallback this card offered "add to Planning" for a title already being
   * watched, and handed `EntryEditModal` a null that it seeded PLANNING/0/0
   * from — which `local_save_entry` then wrote over the real entry.
   */
  const cached = useCachedEntry(0, media.type, media.id);
  const entry = media.mediaListEntry ?? cached ?? null;
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);

  return (
    <CoverCell
      to={`/media/${media.id}`}
      // The roving cursor is not real DOM focus — the card that has it may be
      // any of hundreds — so the ring is drawn rather than inherited from
      // `:focus-visible`. Same reasoning as the list view's.
      className={focused ? "rounded-[.625rem] ring-2 ring-accent-500" : undefined}
      cover={media.coverImage.large}
      // `mediaListEntry { status }` has been in `MEDIA_FIELDS` all along, so
      // every search and seasonal card already knew this and threw it away —
      // the only trace was a tooltip on the check circle below. Null when the
      // title is not on the list, which is the honest answer for a discovery
      // grid and is why not-on-list has no ring rather than a grey one.
      statusRing={entry ? statusColorVar(entry.status) : null}
      score={media.averageScore != null ? `${media.averageScore}%` : null}
      adult={media.isAdult === true}
      blurred={shouldBlur(media, level, blurAdult)}
      revealLabel={displayTitle(media.title)}
      data-media-id={media.id}
      data-media-type={media.type}
      actions={
        hasProfile && (
          <>
            <IconButton
              variant="onCover"
              size="sm"
              round
              onClick={() => setEditing(true)}
              aria-label={t("common.edit")}
              title={t("common.edit")}
            >
              <Pencil className="size-3.5" />
            </IconButton>
            {entry ? (
              // Tinted to match the ring, so the badge and the border are
              // saying the same thing. It was `bg-success` for every status —
              // one green check whether you had completed it or dropped it.
              <span
                className="grid size-7.5 place-items-center rounded-full text-surface-950"
                style={{ background: statusColorVar(entry.status) }}
                title={t(`status.${media.type}.${entry.status}`)}
              >
                <Check className="size-3.75" />
              </span>
            ) : (
              // Discovery grids get the neutral circle: adding to Planning is
              // not the same weight of action as +1 on something you are
              // actively watching, and the accent is reserved for that.
              <IconButton
                variant="onCover"
                size="sm"
                round
                onClick={() =>
                  saveEntry.mutate({ mediaId: media.id, status: "PLANNING" })
                }
                disabled={saveEntry.isPending}
                aria-label={t("media.addPlanning")}
                title={t("media.addPlanning")}
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
              saveEntry.mutate(input);
              setEditing(false);
            }}
          />
        )}
      </PresenceIf>
    </CoverCell>
  );
}
