import { memo, type MouseEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Pencil, Plus } from "lucide-react";
import { displayTitle, maxProgress, type MediaListEntry } from "@/api/types";
import { formatScore } from "@/lib/scoreFormat";
import { countdown, formatLabel } from "@/lib/format";
import { useScoreFormat } from "@/stores/auth";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { SelectBox } from "./SelectBox";
import { canIncrement } from "./shared";

/** Row height estimates for the virtualizer, border included; the real heights are measured. */
export const PHONE_ROW_PX = { thumbs: 81, text: 47 } as const;

/** One entry on a phone, where the table's fixed tracks cannot fit: the title gets the width, the numbers one line. */
export const PhoneRow = memo(function PhoneRow({
  entry,
  variant,
  unit,
  blurred,
  onPlusOne,
  onEdit,
  selectMode,
  selected,
  focused,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  /** `thumbs` carries a small cover and a two-line title; `text` is one title line and no art at all. */
  variant: "thumbs" | "text";
  unit: string;
  /** Computed by the page, not read from the store here: a store subscription would re-render every memoized row. */
  blurred: boolean;
  onPlusOne: (entry: MediaListEntry) => void;
  onEdit: (entry: MediaListEntry) => void;
  selectMode: boolean;
  selected: boolean;
  focused: boolean;
  onToggleSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  const scoreFormat = useScoreFormat();
  const { media } = entry;
  const thumbs = variant === "thumbs";
  const manga = media.type === "MANGA";
  const max = maxProgress(media);

  // Progress leads because it is what a +1 changes; the rest trails and truncates rather than wrapping the row taller.
  const meta = [
    manga
      ? t("common.progressChapters", { n: entry.progress, total: media.chapters ?? "?" })
      : `${entry.progress}${max ? ` / ${max}` : ""} ${unit}`,
    manga && (entry.progressVolumes || media.volumes)
      ? t("common.progressVolumes", { n: entry.progressVolumes ?? 0, total: media.volumes ?? "?" })
      : null,
    entry.score > 0 ? `★ ${formatScore(scoreFormat, entry.score)}` : null,
    media.format ? formatLabel(media.format, t) : null,
    media.nextAiringEpisode
      ? t("list.nextEpisode", {
          n: media.nextAiringEpisode.episode,
          when: countdown(media.nextAiringEpisode.airingAt - Math.floor(Date.now() / 1000), t),
        })
      : null,
  ].filter(Boolean);

  // In select mode the row is the checkbox; navigating away mid-selection is never what the tap meant.
  const guard = (e: MouseEvent) => {
    if (selectMode) e.preventDefault();
  };

  return (
    <div
      data-media-id={media.id}
      data-media-type={media.type}
      data-media-title={displayTitle(media.title)}
      onClick={selectMode ? () => onToggleSelect(entry.mediaId) : undefined}
      className={cn(
        "flex min-w-0 items-center gap-3 border-b border-surface-950 px-3 transition-surface",
        thumbs ? "py-2" : "py-1.5",
        selected ? "bg-accent-600/10" : "bg-surface-900",
        focused && "outline-2 -outline-offset-2 outline-accent-500",
        selectMode && "cursor-pointer",
      )}
    >
      {selectMode && (
        <SelectBox checked={selected} onToggle={() => onToggleSelect(entry.mediaId)} />
      )}

      {/* One link for the cover and every line, so a long press on the text opens the sheet rather than a selection. */}
      <Link
        to={`/media/${media.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
        onClick={guard}
        tabIndex={selectMode ? -1 : undefined}
      >
        {thumbs && (
          <img
            src={media.coverImage.large ?? ""}
            alt=""
            loading="lazy"
            className={cn(
              "aspect-[2/3] h-16 shrink-0 rounded-inner bg-surface-800 object-cover",
              blurred && "blur-[6px]",
            )}
          />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-ui font-medium leading-snug text-ink-100",
              thumbs ? "line-clamp-2" : "truncate",
            )}
          >
            {displayTitle(media.title)}
          </span>
          <span className="mt-0.5 block truncate text-2xs tabular-nums text-ink-600">{meta.join(" · ")}</span>
        </span>
      </Link>

      {!selectMode && (
        // Stacked beside a cover, where the height is spare and the width is not; side by side on a text line.
        <div
          className={cn("flex shrink-0 gap-1", thumbs ? "flex-col" : "items-center")}
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            variant="accent"
            size="sm"
            round
            onClick={() => onPlusOne(entry)}
            disabled={!canIncrement(entry)}
            aria-label={t("common.plusOne")}
            title={t("common.plusOne")}
          >
            <Plus className="size-4" />
          </IconButton>
          <IconButton
            variant="surface"
            size="sm"
            round
            onClick={() => onEdit(entry)}
            aria-label={t("common.edit")}
            title={t("common.edit")}
          >
            <Pencil className="size-3.5" />
          </IconButton>
        </div>
      )}
    </div>
  );
});
