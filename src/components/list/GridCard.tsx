import { memo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCheck, Pencil, Plus } from "lucide-react";
import { maxProgress, type MediaListEntry } from "@/api/types";
import { IconButton } from "@/components/ui/icon-button";
import { TitleLockup } from "@/components/media/TitleLockup";
import { CoverCell, CoverMeta } from "@/components/media/CoverCell";
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
  onPlusOne: (entry: MediaListEntry) => void;
  onComplete: (entry: MediaListEntry) => void;
  onEdit: (entry: MediaListEntry) => void;
  selectMode: boolean;
  selected: boolean;
  focused: boolean;
  onToggleSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  return (
    <CoverCell
      to={`/media/${media.id}`}
      cover={media.coverImage.large}
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
      score={!selectMode && entry.score > 0 ? entry.score : undefined}
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
          // in the grid permanently.
          <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-0 transition-opacity group-hover:opacity-100" />
        )
      }
      actions={
        // Suppressed entirely in select mode: one interaction model at a time.
        !selectMode && (
          <div className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
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
              <IconButton
                variant="onCover"
                size="sm"
                round
                onClick={() => onComplete(entry)}
                aria-label={t("common.complete")}
                title={t("common.complete")}
                className="text-success"
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
