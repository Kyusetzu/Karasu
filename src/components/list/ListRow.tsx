import { memo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCheck, Pencil, Play, Plus } from "lucide-react";
import { useLibrary } from "@/stores/library";
import {
  displayTitle,
  maxProgress,
  STATUS_ORDER,
  type MediaListEntry,
  type MediaListStatus,
} from "@/api/types";
import { IconButton } from "@/components/ui/icon-button";
import { TitleLockup } from "@/components/media/TitleLockup";
import { countdown, formatLabel, fuzzyDate, mediaStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SelectBox } from "./SelectBox";
import { TagChips } from "./TagChips";
import { ScoreSelect } from "./ScoreSelect";
import { canIncrement, PROGRESS_DROPDOWN_LIMIT } from "./shared";
import { shows, templateColumns, type Tier } from "./columns";

/** What one row can change without opening the editor. */
export type RowPatch = {
  progress?: number;
  progressVolumes?: number;
  score?: number;
  status?: MediaListStatus;
  repeat?: number;
};

const CELL =
  "h-8 rounded-inner border border-hair bg-surface-900 px-2 text-xs tabular-nums text-ink-300 transition-surface focus:border-accent-500 focus:outline-none";

/** One entry in detail, memoized like `GridCard`; the tracks come from `columns.ts`, never a `w-*` class here. */
export const ListRow = memo(function ListRow({
  entry,
  tier,
  variant = "thumbs",
  blurred,
  onQuickSave,
  onComplete,
  onEdit,
  selectMode,
  selected,
  focused,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  tier: Tier;
  /** `text` is the compact list: the same controls on one line, with the cover track collapsed. */
  variant?: "thumbs" | "text";
  /** Computed by the page, not read from the store here: a store subscription would re-render every memoized row. */
  blurred: boolean;
  onQuickSave: (entry: MediaListEntry, patch: RowPatch) => void;
  onComplete: (entry: MediaListEntry) => void;
  onEdit: (entry: MediaListEntry) => void;
  selectMode: boolean;
  selected: boolean;
  focused: boolean;
  onToggleSelect: (mediaId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const { media } = entry;
  const manga = media.type === "MANGA";
  const text = variant === "text";
  // One step down in the text list, so every control and the icon buttons share one height.
  const cell = cn(CELL, text && "h-7", "w-full");
  const max = maxProgress(media);
  const dropdown = max !== null && max <= PROGRESS_DROPDOWN_LIMIT;
  // Subscribe to the data, not `hasNext`: its identity never changes, so the row would never re-render after a scan.
  const episodes = useLibrary((s) => s.episodes[media.id]);
  const play = useLibrary((s) => s.play);
  const canPlayNext =
    !selectMode &&
    media.type === "ANIME" &&
    !!episodes?.some((e) => e > entry.progress);

  // Only one option shows until opened, so the rest mount on first interaction; hover fires well ahead of the click.
  const [progressOpened, setProgressOpened] = useState(false);
  const openProgress = () => setProgressOpened(true);
  const [volumesOpened, setVolumesOpened] = useState(false);

  /** What the tier gives no column to, as prose that truncates, so a narrow window drops columns without losing anything. */
  const secondary = [
    media.format ? formatLabel(media.format, t) : null,
    media.seasonYear
      ? media.season
        ? `${t(`season.${media.season}`, { defaultValue: media.season })} ${media.seasonYear}`
        : String(media.seasonYear)
      : null,
    !shows(tier, "status") ? mediaStatusLabel(media.status, t) : null,
    media.averageScore ? t("list.community", { n: media.averageScore }) : null,
    manga && !shows(tier, "volumes") && entry.progressVolumes
      ? t("common.progressVolumes", {
          n: entry.progressVolumes,
          total: media.volumes ?? "?",
        })
      : null,
    !shows(tier, "repeat") && entry.repeat
      ? t("list.repeatShort", { n: entry.repeat })
      : null,
    !shows(tier, "dates") && entry.startedAt?.year
      ? fuzzyDate(entry.startedAt, i18n.language)
      : null,
    media.nextAiringEpisode
      ? t("list.nextEpisode", {
          n: media.nextAiringEpisode.episode,
          when: countdown(
            media.nextAiringEpisode.airingAt - Math.floor(Date.now() / 1000),
            t,
          ),
        })
      : null,
    entry.private ? t("list.private") : null,
  ].filter(Boolean);

  // In select mode the row is the checkbox; navigating away mid-selection is never what the click meant.
  const rowClick = selectMode
    ? () => onToggleSelect(entry.mediaId)
    : undefined;

  return (
    <div
      data-media-id={media.id}
      data-media-type={media.type}
      data-media-title={displayTitle(media.title)}
      onClick={rowClick}
      className={cn(
        "grid items-center gap-x-2.5 border-b border-surface-950 px-3.5 transition-surface",
        text ? "py-1" : "py-2",
        selected ? "bg-accent-600/10" : "bg-surface-900 hover:bg-surface-850",
        focused && "outline-2 -outline-offset-2 outline-accent-500",
        selectMode && "cursor-pointer",
      )}
      style={{ gridTemplateColumns: templateColumns({ tier, selectMode, manga, cover: !text }) }}
    >
      {/* A zero-width track when not selecting, so no column shifts sideways on entering select mode. */}
      <div className="overflow-hidden">
        {selectMode && (
          <SelectBox
            checked={selected}
            onToggle={() => onToggleSelect(entry.mediaId)}
          />
        )}
      </div>

      {/* The cover carries the hero transition into the detail page; the text list keeps an empty 0px track instead. */}
      {text ? (
        <span />
      ) : (
        <Link
          to={`/media/${media.id}`}
          className="block"
          onClick={(e) => selectMode && e.preventDefault()}
          tabIndex={selectMode ? -1 : undefined}
        >
          {/* No reveal control, deliberately: at this size it would sit on the link it replaces, and the detail page has one. */}
          <img
            src={media.coverImage.large ?? ""}
            alt=""
            loading="lazy"
            className={cn(
              "aspect-[2/3] w-full rounded-inner bg-surface-800 object-cover",
              blurred && "blur-[6px]",
            )}
          />
        </Link>
      )}

      {text ? (
        // One line: the title keeps its whole width and the details beside it give way first, down to nothing.
        <Link
          to={`/media/${media.id}`}
          className="flex min-w-0 items-baseline gap-2"
          onClick={(e) => selectMode && e.preventDefault()}
          tabIndex={selectMode ? -1 : undefined}
        >
          <span className="max-w-full shrink-0 truncate text-ui font-medium text-ink-100">
            {displayTitle(media.title)}
          </span>
          {secondary.length > 0 && (
            <span className="min-w-0 flex-1 truncate text-2xs text-ink-600">
              {secondary.join(" · ")}
            </span>
          )}
        </Link>
      ) : (
        <Link
          to={`/media/${media.id}`}
          className="min-w-0"
          onClick={(e) => selectMode && e.preventDefault()}
          tabIndex={selectMode ? -1 : undefined}
        >
          <TitleLockup title={media.title} />
          {secondary.length > 0 && (
            <p className="mt-0.5 truncate text-2xs text-ink-600">
              {secondary.join(" · ")}
            </p>
          )}
        </Link>
      )}

      {/* Status is the most-changed field, so a control rather than a label wherever there is room for one. */}
      <div className="overflow-hidden">
        {shows(tier, "status") && (
          <select
            value={entry.status}
            onChange={(e) =>
              onQuickSave(entry, { status: e.target.value as MediaListStatus })
            }
            onClick={(e) => e.stopPropagation()}
            className={cell}
            aria-label={t("common.status")}
            title={t("common.status")}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`status.${media.type}.${s}`)}
              </option>
            ))}
          </select>
        )}
      </div>

      <ScoreSelect
        value={entry.score}
        onChange={(score) => onQuickSave(entry, { score })}
        className={cn("w-full", text && "h-7")}
      />

      <div onClick={(e) => e.stopPropagation()}>
        {dropdown ? (
          <select
            value={entry.progress}
            onChange={(e) =>
              onQuickSave(entry, { progress: Number(e.target.value) })
            }
            onPointerEnter={openProgress}
            onFocus={openProgress}
            onMouseDown={openProgress}
            className={cell}
            aria-label={t("common.progress")}
            title={t("common.progress")}
          >
            {progressOpened ? (
              Array.from({ length: max + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n} / {max}
                </option>
              ))
            ) : (
              <option value={entry.progress}>
                {entry.progress} / {max}
              </option>
            )}
          </select>
        ) : (
          // Keyed on the number so `tick` replays on every change, the progress counter acknowledging a +1.
          <span
            key={entry.progress}
            className="block animate-tick pr-1.5 text-right text-xs tabular-nums text-ink-300"
          >
            {entry.progress}
            {max ? ` / ${max}` : ""}
          </span>
        )}
      </div>

      {/* Volumes, manga's second axis; never sent for anime, since AniList would store a volume count on a TV series. */}
      <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {shows(tier, "volumes") && manga && (
          <select
            value={entry.progressVolumes ?? 0}
            onChange={(e) =>
              onQuickSave(entry, { progressVolumes: Number(e.target.value) })
            }
            onPointerEnter={() => setVolumesOpened(true)}
            onFocus={() => setVolumesOpened(true)}
            className={cell}
            aria-label={t("common.volumes")}
            title={t("common.volumes")}
          >
            {volumesOpened ? (
              Array.from({ length: (media.volumes ?? 50) + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n} / {media.volumes ?? "?"}
                </option>
              ))
            ) : (
              <option value={entry.progressVolumes ?? 0}>
                {entry.progressVolumes ?? 0} / {media.volumes ?? "?"}
              </option>
            )}
          </select>
        )}
      </div>

      <div className="overflow-hidden">
        {shows(tier, "repeat") && (
          <span
            className="block text-right text-xs tabular-nums text-ink-600"
            title={t(manga ? "entry.rereads" : "entry.rewatches")}
          >
            {entry.repeat ? `×${entry.repeat}` : ""}
          </span>
        )}
      </div>

      <div className="overflow-hidden">
        {shows(tier, "dates") && (
          <div className="text-2xs leading-tight tabular-nums text-ink-600">
            <p className="truncate">{fuzzyDate(entry.startedAt, i18n.language)}</p>
            <p className="truncate">
              {fuzzyDate(entry.completedAt, i18n.language)}
            </p>
          </div>
        )}
      </div>

      <div className="overflow-hidden">
        {shows(tier, "tags") && (
          <TagChips notes={entry.notes} max={3} className="justify-end" />
        )}
      </div>

      <div
        className="flex justify-end gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {canPlayNext && (
          <IconButton
            variant="ghost"
            size="xs"
            className="text-accent-400"
            onClick={() => play(media.id)}
            aria-label={t("common.playNext")}
            title={t("common.playNext")}
          >
            <Play className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          variant="surface"
          size="xs"
          onClick={() => onQuickSave(entry, { progress: entry.progress + 1 })}
          disabled={!canIncrement(entry)}
          aria-label={t("common.plusOne")}
          title={t("common.plusOne")}
        >
          <Plus className="size-3.5" />
        </IconButton>
        {entry.status !== "COMPLETED" && (
          <IconButton
            variant="success"
            size="xs"
            onClick={() => onComplete(entry)}
            aria-label={t("common.complete")}
            title={t("common.complete")}
          >
            <CheckCheck className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          variant="ghost"
          size="xs"
          onClick={() => onEdit(entry)}
          aria-label={t("common.edit")}
          title={t("common.edit")}
        >
          <Pencil className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
});
