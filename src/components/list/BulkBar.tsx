import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, X } from "lucide-react";
import {
  STATUS_ORDER,
  type MediaListStatus,
  type MediaType,
} from "@/api/types";
import ConfirmDialog from "@/components/overlays/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";
/** Sticky action bar for bulk edits over the current selection. */

export function BulkBar({
  type,
  count,
  onStatus,
  onScore,
  onDelete,
  onClear,
  names,
}: {
  type: MediaType;
  count: number;
  onStatus: (s: MediaListStatus) => void;
  onScore: (n: number) => void;
  onDelete: () => void;
  onClear: () => void;
  names: string[];
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = count === 0;

  return (
    // Same inset-well substance as the now-playing card, for the same reason:
    // it appears unprompted over content that is already there, and reading as
    // a different material is how it announces itself without a colour shout.
    <div className="inset-well well-edge relative mx-8 mb-5 flex flex-wrap items-center gap-2.5 overflow-hidden rounded-[.875rem] px-4.5 py-3">
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
        options={[
          { value: "0", label: "–" },
          ...Array.from({ length: 10 }, (_, i) => ({
            value: String(i + 1),
            label: `★ ${i + 1}`,
          })),
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

      {confirmDelete && (
        <ConfirmDialog
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
