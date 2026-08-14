import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  displayTitle,
  maxProgress,
  STATUS_ORDER,
  type FuzzyDate,
  type MediaListStatus,
  type MediaTitle,
  type MediaType,
} from "@/api/types";
import { fuzzyDate } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { ScoreBars } from "@/components/ui/score-bars";
import TagEditor from "@/components/media/TagEditor";
import { parseNotes, serializeNotes } from "@/lib/tags";

export interface EditableMedia {
  id: number;
  type: MediaType;
  title: MediaTitle;
  episodes: number | null;
  chapters?: number | null;
  volumes?: number | null;
}

export interface EditableEntry {
  status: MediaListStatus;
  progress: number;
  progressVolumes?: number;
  score: number;
  repeat: number;
  notes: string | null;
  private?: boolean;
  hiddenFromStatusLists?: boolean | null;
  startedAt?: FuzzyDate | null;
  completedAt?: FuzzyDate | null;
}

export interface EntrySaveInput {
  mediaId: number;
  status: MediaListStatus;
  progress: number;
  progressVolumes?: number;
  score: number;
  repeat: number;
  notes: string;
  private?: boolean;
  hiddenFromStatusLists?: boolean;
  startedAt?: FuzzyDate;
  completedAt?: FuzzyDate;
}

/** What AniList takes to *clear* a fuzzy date — all parts null. */
const CLEARED_DATE: FuzzyDate = { year: null, month: null, day: null };

/**
 * A fuzzy date behind a native date input. The picker speaks full dates
 * only; a partial value AniList already holds ("2019", "March 2024") shows
 * as a caption underneath and survives untouched until the user picks or
 * clears — at which point full-or-nothing is what gets written.
 */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FuzzyDate | null;
  onChange: (d: FuzzyDate | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const full =
    value?.year && value.month && value.day
      ? `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
      : "";
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={full}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return onChange(null);
            const [year, month, day] = v.split("-").map(Number);
            onChange({ year, month, day });
          }}
          className="min-w-0 flex-1"
        />
        {value?.year != null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t("entry.clearDate")}
          </Button>
        )}
      </div>
      {value?.year != null && !full && (
        <span className="mt-1 block text-2xs text-ink-600">
          {t("entry.partialDate", { date: fuzzyDate(value, i18n.language) })}
        </span>
      )}
    </label>
  );
}

/**
 * Shared edit dialog for list entries — usable from the list, the search
 * and the season browser. `entry === null` means "add to list".
 */
export default function EntryEditModal({
  leaving,
  media,
  entry,
  onClose,
  onSave,
  onDelete,
  tagSuggestions = [],
}: {
  /** On its way out — supplied by `Presence`. */
  leaving?: boolean;
  media: EditableMedia;
  entry: EditableEntry | null;
  onClose: () => void;
  onSave: (input: EntrySaveInput) => void;
  onDelete?: () => void;
  tagSuggestions?: string[];
}) {
  const { t } = useTranslation();
  const mode = useAuth((s) => s.mode);
  const initial = parseNotes(entry?.notes);
  const [status, setStatus] = useState<MediaListStatus>(
    entry?.status ?? "PLANNING",
  );
  const [progress, setProgress] = useState(entry?.progress ?? 0);
  const [volumes, setVolumes] = useState(entry?.progressVolumes ?? 0);
  const [score, setScore] = useState(entry?.score ?? 0);
  const [repeat, setRepeat] = useState(entry?.repeat ?? 0);
  const [notes, setNotes] = useState(initial.notes);
  const [tags, setTags] = useState(initial.tags);
  const [priv, setPriv] = useState(entry?.private ?? false);
  const [hidden, setHidden] = useState(entry?.hiddenFromStatusLists ?? false);
  const [started, setStarted] = useState<FuzzyDate | null>(entry?.startedAt ?? null);
  const [completed, setCompleted] = useState<FuzzyDate | null>(entry?.completedAt ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Sent only when touched: a caller that never loaded a date must not have
  // this dialog silently clear it on an unrelated save.
  const startedDirty = started !== (entry?.startedAt ?? null);
  const completedDirty = completed !== (entry?.completedAt ?? null);
  // The local list stores none of these — the controls would be a lie there.
  const anilist = mode === "anilist";
  const max = maxProgress(media) ?? 99999;
  // Manga is tracked on two axes and always has been on AniList. A volume
  // count is not derivable from chapters — series split them differently, and
  // plenty of readers only track one of the two.
  const isManga = media.type === "MANGA";
  const maxVolumes = media.volumes ?? 99999;
  const rewatchLabel =
    media.type === "MANGA" ? t("entry.rereads") : t("entry.rewatches");

  return (
    <Modal title={displayTitle(media.title)} onClose={onClose} leaving={leaving}>
      <div className="space-y-4">
        {/* Six pills, not a dropdown. Status is the most-changed field here and
            a dropdown hides five of its six options behind a click. */}
        <div className="text-sm">
          <span className="mb-1.5 block text-ink-500">{t("common.status")}</span>
          <div className="flex flex-wrap gap-0.75">
            {STATUS_ORDER.map((s) => (
              <Pill
                key={s}
                active={status === s}
                onClick={() => setStatus(s)}
              >
                {t(`status.${media.type}.${s}`)}
              </Pill>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-ink-500">
                {isManga
                  ? t("common.chapters")
                  : maxProgress(media)
                    ? t("list.progressMax", { max })
                    : t("common.progress")}
              </span>
              <Input
                type="number"
                min={0}
                max={max}
                value={progress}
                onChange={(e) =>
                  setProgress(Math.max(0, Math.min(max, Number(e.target.value))))
                }
              />
            </label>
            {isManga && (
              <label className="block text-sm">
                <span className="mb-1 block text-ink-500">
                  {t("common.volumes")}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={maxVolumes}
                  value={volumes}
                  onChange={(e) =>
                    setVolumes(
                      Math.max(0, Math.min(maxVolumes, Number(e.target.value))),
                    )
                  }
                />
              </label>
            )}
          </div>
          <div className="text-sm">
            <span className="mb-1.5 block text-ink-500">
              {t("common.score")}
            </span>
            <ScoreBars value={score} onChange={setScore} />
          </div>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{rewatchLabel}</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={repeat}
              onChange={(e) => setRepeat(Math.max(0, Number(e.target.value)))}
              className="w-24"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRepeat((r) => r + 1)}
            >
              {t("entry.addRepeat")}
            </Button>
          </div>
        </label>
        {anilist && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <DateField label={t("entry.startDate")} value={started} onChange={setStarted} />
              <DateField
                label={t("entry.finishDate")}
                value={completed}
                onChange={setCompleted}
              />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
                <input
                  type="checkbox"
                  checked={priv}
                  onChange={(e) => setPriv(e.target.checked)}
                  className="size-3.5 accent-accent-500"
                />
                {t("entry.private")}
              </label>
              <label
                className="flex cursor-pointer items-center gap-2 text-sm text-ink-300"
                title={t("entry.hiddenHint")}
              >
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="size-3.5 accent-accent-500"
                />
                {t("entry.hidden")}
              </label>
            </div>
          </>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{t("tags.label")}</span>
          <TagEditor
            tags={tags}
            onChange={setTags}
            suggestions={tagSuggestions}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{t("entry.notes")}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t("entry.notesPlaceholder")}
            className="w-full resize-y rounded-lg border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
          />
        </label>
        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
            confirmDelete ? (
              <Button variant="danger" size="sm" onClick={onDelete}>
                {t("common.confirmRemove")}
              </Button>
            ) : (
              <Button
                variant="dangerGhost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" /> {t("common.remove")}
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() =>
                onSave({
                  mediaId: media.id,
                  status,
                  progress,
                  // Never sent for anime: AniList accepts it there and would
                  // store a volume count on a TV series.
                  ...(isManga ? { progressVolumes: volumes } : {}),
                  score,
                  repeat,
                  notes: serializeNotes(notes, tags),
                  ...(anilist
                    ? {
                        private: priv,
                        hiddenFromStatusLists: hidden,
                        // A cleared date is written as all-null parts — that
                        // is AniList's own "remove the date" spelling.
                        ...(startedDirty ? { startedAt: started ?? CLEARED_DATE } : {}),
                        ...(completedDirty
                          ? { completedAt: completed ?? CLEARED_DATE }
                          : {}),
                      }
                    : {}),
                })
              }
            >
              {entry ? t("common.save") : t("common.add")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
