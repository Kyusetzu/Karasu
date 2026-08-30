import { memo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCheck, Pencil, Plus } from "lucide-react";
import { displayTitle, maxProgress, type MediaListEntry } from "@/api/types";
import { formatScore } from "@/lib/scoreFormat";
import { useScoreFormat } from "@/stores/auth";
import { IconButton } from "@/components/ui/icon-button";
import { TitleLockup } from "@/components/media/TitleLockup";
import { CoverCell, CoverMeta } from "@/components/media/CoverCell";
import { statusColorVar } from "@/lib/statusColors";
import { SelectBox } from "./SelectBox";
import { TagChips } from "./TagChips";
import { canIncrement } from "./shared";
/**
 * Memoized: a list of a few hundred cards re-rendered on every keystroke or
 * +1 is the single biggest cost on this page. The handlers take the entry
 * rather than closing over it so the props stay referentially stable.
 */

export const GridCard = memo(function GridCard({
  entry,
  unit,
  blurred,
  onPlusOne,
  onComplete,
  onEdit,
  selectMode,
  selected,
  focused,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  unit: string;
  /**
   * Computed by the page, not read from the store here.
   *
   * This component is memoized because a few hundred of these re-render on
   * every keystroke, and a `useContentFilter` subscription inside it would
   * re-render all of them whenever any part of that store moved. A boolean
   * prop compares shallowly and costs nothing.
   */
  blurred: boolean;
  onPlusOne: (entry: MediaListEntry) => void;
  onComplete: (entry: MediaListEntry) => void;
  onEdit: (entry: MediaListEntry) => void;
  selectMode: boolean;
  selected: boolean;
  focused: boolean;
  onToggleSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  const scoreFormat = useScoreFormat();
  const { media } = entry;
  const max = maxProgress(media);
  return (
    <CoverCell
      to={`/media/${media.id}`}
      cover={media.coverImage.large}
      // The badge shows through the veil, so a blurred cell reads as "18+,
      // hidden" rather than as artwork that failed to load.
      adult={media.isAdult === true}
      blurred={blurred}
      revealLabel={displayTitle(media.title)}
      // Every card in this grid is on the list by definition, so the ring is
      // never absent here — unlike a discovery grid, where its absence is the
      // useful signal. It is what makes a status legible without reading the
      // row, which is the point of a grid view.
      statusRing={statusColorVar(entry.status)}
      data-media-id={media.id}
      data-media-type={media.type}
      // The focused cell wears the same outline a selected one does. They
      // never mean the same thing, but they never appear for different
      // reasons either: both say "this is the one the next key acts on".
      selected={focused || (selectMode && selected)}
      // In select mode the cover *is* the checkbox target — navigating away
      // mid-selection is never what the click meant.
      onCoverClick={
        selectMode ? () => onToggleSelect(entry.mediaId) : undefined
      }
      coverLabel={t("bulk.select")}
      score={
        !selectMode && entry.score > 0
          ? formatScore(scoreFormat, entry.score)
          : undefined
      }
      progress={max ? { current: entry.progress, total: max } : null}
      overlay={
        selectMode ? (
          <SelectBox
            checked={selected}
            onToggle={() => onToggleSelect(entry.mediaId)}
            className="absolute left-2 top-2 z-20"
          />
        ) : (
          // Deepens the foot of the cover only while the actions are showing,
          // so the three circles have a ground without dimming every poster
          // in the grid permanently. `pointer-coarse:`: touch has no hover
          // state to reveal from, so on a coarse pointer the scrim and the
          // actions below are simply there — width is the wrong key for this,
          // since a touch laptop at desktop width has the same problem.
          <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100" />
        )
      }
      actions={
        // Suppressed entirely in select mode: one interaction model at a time.
        //
        // `group-focus-within` alongside `group-hover`: these buttons are
        // tabbable, so without it Tab moved focus onto controls that were fully
        // transparent — a focus ring around nothing, and no way to tell what
        // was about to be activated.
        !selectMode && (
          <div className="flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            <IconButton
              variant="onCover"
              size="sm"
              round
              onClick={() => onEdit(entry)}
              aria-label={t("common.edit")}
              title={t("common.edit")}
            >
              <Pencil className="size-3.5" />
            </IconButton>
            {entry.status !== "COMPLETED" && (
              // Hidden on coarse pointers, where all three buttons are
              // permanently visible and three 30px circles need ~110px of a
              // cover that is ~78px wide at the phone's 4-per-row default —
              // the row overflowed leftward and the cover's overflow-hidden
              // ate exactly the edit button. Two fit; complete is the one a
              // touch user can spare, since +1 on the last episode completes
              // and the editor is one tap away. A mouse keeps all three.
              <IconButton
                variant="onCover"
                size="sm"
                round
                onClick={() => onComplete(entry)}
                aria-label={t("common.complete")}
                title={t("common.complete")}
                className="text-success pointer-coarse:hidden"
              >
                <CheckCheck className="size-3.5" />
              </IconButton>
            )}
            {canIncrement(entry) && (
              <IconButton
                variant="accent"
                size="sm"
                round
                onClick={() => onPlusOne(entry)}
                aria-label={t("common.plusOne")}
                title={t("common.plusOne")}
              >
                <Plus className="size-4" />
              </IconButton>
            )}
          </div>
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
        {media.type === "MANGA" ? (
          // Chapters lead, volumes trail, on the one line anime spends on
          // episodes. `?` rather than a hidden total: an ongoing series
          // genuinely has no end count, and blanking it reads as a bug.
          <>
            {t("common.progressChapters", {
              n: entry.progress,
              total: media.chapters ?? "?",
            })}
            {" · "}
            {t("common.progressVolumes", {
              n: entry.progressVolumes ?? 0,
              total: media.volumes ?? "?",
            })}
          </>
        ) : (
          <>
            {entry.progress}
            {max ? ` / ${max}` : ""} {unit}
          </>
        )}
      </CoverMeta>
      <TagChips notes={entry.notes} />
    </CoverCell>
  );
});
