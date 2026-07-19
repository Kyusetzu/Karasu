import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  displayTitle,
  maxProgress,
  STATUS_ORDER,
  type MediaListStatus,
  type MediaTitle,
  type MediaType,
} from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export interface EditableMedia {
  id: number;
  type: MediaType;
  title: MediaTitle;
  episodes: number | null;
  chapters?: number | null;
}

export interface EditableEntry {
  status: MediaListStatus;
  progress: number;
  score: number;
  repeat: number;
}

export interface EntrySaveInput {
  mediaId: number;
  status: MediaListStatus;
  progress: number;
  score: number;
  repeat: number;
}

/**
 * Shared edit dialog for list entries — usable from the list, the search
 * and the season browser. `entry === null` means "add to list".
 */
export default function EntryEditModal({
  media,
  entry,
  onClose,
  onSave,
  onDelete,
}: {
  media: EditableMedia;
  entry: EditableEntry | null;
  onClose: () => void;
  onSave: (input: EntrySaveInput) => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MediaListStatus>(
    entry?.status ?? "PLANNING",
  );
  const [progress, setProgress] = useState(entry?.progress ?? 0);
  const [score, setScore] = useState(entry?.score ?? 0);
  const [repeat, setRepeat] = useState(entry?.repeat ?? 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const max = maxProgress(media) ?? 99999;
  const rewatchLabel =
    media.type === "MANGA" ? t("entry.rereads") : t("entry.rewatches");

  return (
    <Modal title={displayTitle(media.title)} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{t("common.status")}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MediaListStatus)}
            className="h-9 w-full rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`status.${media.type}.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-ink-500">
              {maxProgress(media)
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
          <label className="block text-sm">
            <span className="mb-1 block text-ink-500">
              {t("list.scoreRange")}
            </span>
            <Input
              type="number"
              min={0}
              max={10}
              value={score}
              onChange={(e) =>
                setScore(Math.max(0, Math.min(10, Number(e.target.value))))
              }
            />
          </label>
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
        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
            confirmDelete ? (
              <Button variant="danger" size="sm" onClick={onDelete}>
                {t("common.confirmRemove")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-400"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} /> {t("common.remove")}
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
                onSave({ mediaId: media.id, status, progress, score, repeat })
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
