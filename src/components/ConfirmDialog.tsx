import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The dialog that guards a destructive action.
 *
 * It names what will be destroyed. "Are you sure?" asks the user to remember
 * what they selected thirty seconds ago on a screen the dialog is covering;
 * listing the first titles and the count answers it for them, which is the
 * only thing that makes the extra click worth asking for.
 */
export default function ConfirmDialog({
  title,
  names = [],
  extra,
  note,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** The first few things this will destroy, spelled out. */
  names?: string[];
  /** How many more there are beyond `names`. */
  extra?: number;
  note?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[110] grid animate-fade-in place-items-center bg-[rgba(4,5,8,.55)] p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-96 animate-settle rounded-xl border border-hair bg-surface-900 p-5 shadow-2xl panel-wash">
        <div className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-danger/16 text-danger">
            <AlertTriangle className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
            {names.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-ink-500">
                {names.map((name) => (
                  <li key={name} className="truncate">
                    {name}
                  </li>
                ))}
                {!!extra && extra > 0 && (
                  <li className="text-ink-600">{t("confirm.andMore", { n: extra })}</li>
                )}
              </ul>
            )}
            {note && (
              <p className="mt-2 text-2xs leading-relaxed text-ink-600">{note}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="control" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" size="control" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
