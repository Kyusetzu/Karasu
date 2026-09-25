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
import { cn } from "@/lib/utils";
import { SelectBox } from "./SelectBox";
import { TagChips } from "./TagChips";
import { canIncrement } from "./shared";
/** Memoized, since hundreds of cards re-render per keystroke; handlers take the entry so the props stay stable. */

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
  /** Computed by the page, not read from the store here: a store subscription would re-render every memoized card. */
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
  const plusOne = canIncrement(entry);
  const completable = entry.status !== "COMPLETED";
  return (
    <CoverCell
      to={`/media/${media.id}`}
      cover={media.coverImage.large}
      // The badge shows through the veil, so a blurred cell reads as hidden rather than as failed artwork.
      adult={media.isAdult === true}
      blurred={blurred}
      revealLabel={displayTitle(media.title)}
      // Every card here is on the list, so the ring is never absent; it makes the status legible without the row.
      statusRing={statusColorVar(entry.status)}
      data-media-id={media.id}
      data-media-type={media.type}
      data-media-title={displayTitle(media.title)}
      // The focused cell wears the selection outline: both say "this is the one the next key acts on".
      selected={focused || (selectMode && selected)}
      // In select mode the cover is the checkbox target; navigating away mid-selection is never what the click meant.
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
          // Scrim only while the actions show; `pointer-coarse:` rather than width, since touch has no hover to reveal from.
          <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100" />
        )
      }
      actions={
        // Suppressed in select mode; keep `group-focus-within`, or Tab lands on fully transparent buttons.
        !selectMode && (
          <div className="flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            {/* Below two circles' width a cover keeps one, the quick write rather than the way into the editor. */}
            <IconButton
              variant="onCover"
              size="sm"
              round
              onClick={() => onEdit(entry)}
              aria-label={t("common.edit")}
              title={t("common.edit")}
              className={cn(
                plusOne && "@max-cover-pair:hidden",
                !plusOne && completable && "not-pointer-coarse:@max-cover-pair:hidden",
              )}
            >
              <Pencil className="size-3.5" />
            </IconButton>
            {completable && (
              // Off on a phone, and wherever it would be the third circle on a cover too narrow for three.
              <IconButton
                variant="onCover"
                size="sm"
                round
                onClick={() => onComplete(entry)}
                aria-label={t("common.complete")}
                title={t("common.complete")}
                className={cn("text-success pointer-coarse:hidden", plusOne && "@max-cover-actions:hidden")}
              >
                <CheckCheck className="size-3.5" />
              </IconButton>
            )}
            {plusOne && (
              <IconButton
                variant="accentOnCover"
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
          // Chapters lead, volumes trail; `?` rather than a hidden total, since an ongoing series has no end count.
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
