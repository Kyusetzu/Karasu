import { useTranslation } from "react-i18next";
import { Check, CloudUpload, TriangleAlert, X } from "lucide-react";
import { useToast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { usePresentValue } from "@/hooks/usePresence";

/** The write receipt, bottom-centre, keyed on the toast id so a replacement replays `riseIn` instead of swapping text. */
export default function Toast() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);
  // The last toast is retained through the exit so it leaves the way it arrived instead of vanishing mid-frame.
  const shown = usePresentValue(toast);

  if (!shown.value) return null;
  const current = shown.value;
  const error = current.kind === "error";
  // Queued work gets neither the alarm nor the checkmark: it has not failed, and it has not landed either.
  const info = current.kind === "info";

  return (
    <div
      key={current.id}
      role="status"
      aria-live="polite"
      className={cn(
        // `--shell-bottom` lifts this clear of the phone shell's bottom bar; on desktop it is 0px and nothing moves.
        "panel-wash panel-top pointer-events-auto fixed bottom-[calc(1.25rem+var(--shell-bottom,0px))] left-1/2 z-50 flex",
        "max-w-[calc(100vw-4rem)] items-center gap-3",
        // Keep -translate-x-1/2 as the centring; the exit animates opacity and a nested transform, never this one.
        "-translate-x-1/2",
        shown.leaving ? "animate-fade-out" : "animate-rise-in",
        "rounded-xl border border-surface-800 bg-surface-900 py-2.5 pl-3 pr-2.5 shadow-2xl",
      )}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          error
            ? "bg-danger/15 text-danger"
            : info
              ? "bg-surface-800 text-ink-300"
              : "bg-accent-500/15 text-accent-400",
        )}
      >
        {error ? (
          <TriangleAlert className="size-3.75" />
        ) : info ? (
          <CloudUpload className="size-3.75" />
        ) : (
          <Check className="size-3.75" strokeWidth={3} />
        )}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-[.8125rem] font-medium text-ink-100">
          {current.text}
        </span>
        {current.detail && (
          <span className="block truncate text-2xs text-ink-600">
            {current.detail}
          </span>
        )}
      </span>

      {current.action && (
        <Button
          variant="outline"
          size="control"
          className="shrink-0"
          onClick={() => {
            current.action?.run();
            dismiss();
          }}
        >
          {current.action.label}
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
