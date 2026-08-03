import { useTranslation } from "react-i18next";
import { Check, TriangleAlert, X } from "lucide-react";
import { useToast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/**
 * The write receipt, bottom-centre.
 *
 * Keyed on the toast id so a replacement replays `riseIn` rather than silently
 * swapping its text — a receipt that changes without moving is one you can miss
 * while looking straight at it.
 */
export default function Toast() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);

  if (!toast) return null;
  const error = toast.kind === "error";

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={cn(
        "panel-wash panel-top pointer-events-auto fixed bottom-5 left-1/2 z-50 flex",
        "max-w-[calc(100vw-4rem)] -translate-x-1/2 animate-rise-in items-center gap-3",
        "rounded-xl border border-surface-800 bg-surface-900 py-2.5 pl-3 pr-2.5 shadow-2xl",
      )}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          error ? "bg-danger/15 text-danger" : "bg-accent-500/15 text-accent-400",
        )}
      >
        {error ? (
          <TriangleAlert className="size-3.75" />
        ) : (
          <Check className="size-3.75" strokeWidth={3} />
        )}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-[.8125rem] font-medium text-ink-100">
          {toast.text}
        </span>
        {toast.detail && (
          <span className="block truncate text-2xs text-ink-600">
            {toast.detail}
          </span>
        )}
      </span>

      {toast.action && (
        <Button
          variant="outline"
          size="control"
          className="shrink-0"
          onClick={() => {
            toast.action?.run();
            dismiss();
          }}
        >
          {toast.action.label}
        </Button>
      )}

      <IconButton
        variant="ghost"
        size="sm"
        onClick={dismiss}
        aria-label={t("common.dismiss")}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}
