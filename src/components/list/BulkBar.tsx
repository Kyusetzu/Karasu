import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, X } from "lucide-react";
import {
  STATUS_ORDER,
  type MediaListStatus,
  type MediaType,
} from "@/api/types";
import ConfirmDialog from "@/components/overlays/ConfirmDialog";
import { PresenceIf } from "@/components/ui/presence";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { bulkScoreOptions } from "./ScoreSelect";
import { useScoreFormat } from "@/stores/auth";
import { cn } from "@/lib/utils";
/** Sticky action bar for bulk edits over the current selection. */

export function BulkBar({
  type,
  count,
  onStatus,
  onScore,
  onProgress,
  onRepeat,
  onPrivate,
  onDelete,
  onClear,
  names,
}: {
  type: MediaType;
  count: number;
  onStatus: (s: MediaListStatus) => void;
  onScore: (n: number) => void;
  /** Set the same progress across the selection. Mostly used to reset to 0. */
  onProgress: (n: number) => void;
  onRepeat: (n: number) => void;
  onPrivate: (hidden: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
  names: string[];
}) {
  const { t } = useTranslation();
  const scoreFormat = useScoreFormat();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = count === 0;

  return (
    // Same inset-well substance as the now-playing card, for the same reason:
    // it appears unprompted over content that is already there, and reading as
    // a different material is how it announces itself without a colour shout.
    // `--animate-rise-in` names "the bulk bar" as a consumer and never had
    // one: entering select mode simply pushed the list up by the height of
    // a bar that was suddenly there.
    <div className="inset-well well-edge relative mx-8 mb-5 flex animate-rise-in flex-wrap items-center gap-2.5 overflow-hidden rounded-[.875rem] px-4.5 py-3">
      <span className="text-[.8125rem] font-semibold tabular-nums text-ink-100">
        {t("bulk.selected", { count })}
      </span>
      <span className="h-4 w-px bg-surface-700" />

      <FilterSelect
        label={t("bulk.setStatus")}
        value=""
        placeholder="—"
        onChange={(v) => v && onStatus(v as MediaListStatus)}
        options={STATUS_ORDER.map((s) => ({
          value: s,
          label: t(`status.${type}.${s}`),
        }))}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      <FilterSelect
        label={t("bulk.setScore")}
        value=""
        placeholder="—"
        onChange={(v) => v !== "" && onScore(Number(v))}
        options={[{ value: "0", label: "–" }, ...bulkScoreOptions(scoreFormat)]}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      {/* Every control here sets one value across the whole selection, which is
          what `UpdateMediaListEntries` does in one request. Progress offers only
          0 and 1 on purpose: "set them all to episode 137" is not a thing anyone
          wants, but "reset these to unwatched" and "mark these as started" are.

          Notes and tags are deliberately absent even though the mutation accepts
          `notes` — tags are serialized into that field, so one bulk write would
          erase every selected entry's tags. */}
      <FilterSelect
        label={t("bulk.setProgress")}
        value=""
        placeholder="—"
        onChange={(v) => v !== "" && onProgress(Number(v))}
        options={[
          { value: "0", label: t("bulk.progressReset") },
          { value: "1", label: t("bulk.progressOne") },
        ]}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      <FilterSelect
        label={t("bulk.setRepeat")}
        value=""
        placeholder="—"
        onChange={(v) => v !== "" && onRepeat(Number(v))}
        options={Array.from({ length: 6 }, (_, i) => ({
          value: String(i),
          label: i === 0 ? t("bulk.repeatNone") : `×${i}`,
        }))}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      <FilterSelect
        label={t("bulk.setPrivate")}
        value=""
        placeholder="—"
        onChange={(v) => v !== "" && onPrivate(v === "1")}
        options={[
          { value: "1", label: t("bulk.privateOn") },
          { value: "0", label: t("bulk.privateOff") },
        ]}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      <Button
        variant="dangerGhost"
        size="control"
        disabled={disabled}
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="size-3.5" /> {t("common.remove")}
      </Button>

      <PresenceIf when={confirmDelete}>
        {(leaving) => (
        <ConfirmDialog
          leaving={leaving}
          title={t(count === 1 ? "confirm.removeOne" : "confirm.removeMany", {
            count,
          })}
          names={names.slice(0, 3)}
          extra={count - 3}
          note={t("confirm.removeNote")}
          confirmLabel={t("common.remove")}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
        )}
      </PresenceIf>

      <Button
        variant="ghost"
        size="control"
        className="ml-auto"
        onClick={onClear}
      >
        <X className="size-3.5" /> {t("bulk.done")}
      </Button>
    </div>
  );
}
