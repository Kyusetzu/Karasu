import { memo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCheck, Pencil, Play, Plus } from "lucide-react";
import { useLibrary } from "@/stores/library";
import { maxProgress, type MediaListEntry } from "@/api/types";
import { IconButton } from "@/components/ui/icon-button";
import { TitleLockup } from "@/components/media/TitleLockup";
import { cn } from "@/lib/utils";
import { SelectBox } from "./SelectBox";
import { TagChips } from "./TagChips";
import { canIncrement, PROGRESS_DROPDOWN_LIMIT } from "./shared";
/** Memoized for the same reason as GridCard — see the note there. */
export const ListRow = memo(function ListRow({
  entry,
  onQuickSave,
  onComplete,
  onEdit,
  selectMode,
  selected,
  focused,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  onQuickSave: (
    entry: MediaListEntry,
    patch: { progress?: number; score?: number },
  ) => void;
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
  const dropdown = max !== null && max <= PROGRESS_DROPDOWN_LIMIT;
  // Subscribe to the *data*, not to `hasNext`. The selector used to return the
  // store's `hasNext` function, whose identity never changes — so the row never
  // re-rendered after a library scan and the play button stayed missing until
  // something else happened to re-render the list.
  const episodes = useLibrary((s) => s.episodes[media.id]);
  const play = useLibrary((s) => s.play);
  const canPlayNext =
    !selectMode &&
    media.type === "ANIME" &&
    !!episodes?.some((e) => e > entry.progress);

  // The progress dropdown can hold up to PROGRESS_DROPDOWN_LIMIT options. Only
  // one of them is visible before the user opens it, so mount the rest on first
  // interaction. Hover fires well ahead of the click; focus/mousedown are the
  // keyboard and fast-click fallbacks.
  const [progressOpened, setProgressOpened] = useState(false);
  const openProgress = () => setProgressOpened(true);

  return (
    <div
      data-media-id={media.id}
      data-media-type={media.type}
      className={cn(
        "flex items-center gap-3.5 border-b border-surface-950 px-3.5 py-2 transition-surface",
        selected ? "bg-accent-600/10" : "bg-surface-900 hover:bg-surface-850",
        focused && "outline-2 -outline-offset-2 outline-accent-500",
      )}
    >
      {selectMode && (
        <SelectBox
          checked={selected}
          onToggle={() => onToggleSelect(entry.mediaId)}
        />
      )}
      <Link to={`/media/${media.id}`} className="shrink-0">
        <img
          src={media.coverImage.large ?? ""}
          alt=""
          loading="lazy"
          className="h-13.5 w-9.5 rounded-[.3125rem] object-cover"
        />
      </Link>
      <Link to={`/media/${media.id}`} className="min-w-0 flex-1">
        <TitleLockup title={media.title} />
      </Link>

      {selectMode ? null : (
        <>
      {/* Fixed-width from here on, so the columns line up down the list even
          though every title above them is a different length. */}
      <TagChips notes={entry.notes} max={4} className="w-32 justify-end" />

      {/* Quick score */}
      <select
        value={entry.score}
        onChange={(e) => onQuickSave(entry, { score: Number(e.target.value) })}
        className="h-8 w-13 rounded-md border border-surface-800 bg-surface-900 px-1.5 text-xs text-gold transition-surface focus:border-accent-500 focus:outline-none"
        aria-label={t("common.score")}
        title={t("common.score")}
      >
        <option value={0}>–</option>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            ★ {n}
          </option>
        ))}
      </select>

      {/* Quick progress */}
      {dropdown ? (
        <select
          value={entry.progress}
          onChange={(e) =>
            onQuickSave(entry, { progress: Number(e.target.value) })
          }
          onPointerEnter={openProgress}
          onFocus={openProgress}
          onMouseDown={openProgress}
          className="h-8 w-18 rounded-md border border-surface-800 bg-surface-900 px-1.5 text-xs tabular-nums text-ink-300 transition-surface focus:border-accent-500 focus:outline-none"
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
        // Keyed on the number so `tick` replays when it changes. The token was
        // written for exactly this — "the progress counter acknowledging a
        // +1" — and had no consumer; incrementing simply substituted a digit.
        <span
          key={entry.progress}
          className="w-18 animate-tick pr-1.5 text-right text-xs tabular-nums text-ink-300"
        >
          {entry.progress}
          {max ? ` / ${max}` : ""}
        </span>
      )}

      <div className="flex gap-1">
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
        </>
      )}
    </div>
  );
});
