import { useTranslation } from "react-i18next";
import { Check, CloudUpload, TriangleAlert, X } from "lucide-react";
import { useToast, type Toast as ToastData } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MotionPresence, m } from "@/app/motion";
import { cn } from "@/lib/utils";

/** How far down, or how fast, a toast must be flicked before letting go dismisses it. */
const FLICK_PX = 40;
const FLICK_SPEED = 400;

/** The write receipt, bottom-centre: arrives on the soft spring, leaves quickly, and goes with a flick downwards. */
export default function Toast() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);
  const pause = useToast((s) => s.pause);
  const resume = useToast((s) => s.resume);
  const spoken = toast ? [toast.text, toast.detail].filter(Boolean).join(". ") : "";

  return (
    <>
      {/* Mounted for good, so a screen reader hears every receipt, the first one included. */}
      <div role="status" aria-live="polite" className="sr-only">
        {spoken}
      </div>

      <MotionPresence mode="wait">
        {toast && (
          <m.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", duration: 0.44, bounce: 0.22 } }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > FLICK_PX || info.velocity.y > FLICK_SPEED) dismiss();
            }}
            onPointerEnter={pause}
            onPointerLeave={resume}
            onFocus={pause}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
            }}
            className={cn(
              // `--shell-bottom` lifts this clear of the phone shell's bottom bar; on desktop it is 0px and nothing moves.
              "panel-wash panel-top pointer-events-auto fixed bottom-[calc(1.25rem+var(--shell-bottom,0px))] left-1/2 z-50 flex",
              // The centring is `translate`, which Motion's transform leaves alone.
              "max-w-[calc(100vw-4rem)] -translate-x-1/2 touch-none items-center gap-3",
              "rounded-panel border border-hair bg-surface-900 py-2.5 pl-3 pr-2.5 shadow-float",
            )}
          >
            <ToastBody toast={toast} onAction={dismiss} />
            <IconButton variant="ghost" size="sm" onClick={dismiss} aria-label={t("common.dismiss")}>
              <X className="size-3.5" />
            </IconButton>
          </m.div>
        )}
      </MotionPresence>
    </>
  );
}

function ToastBody({ toast, onAction }: { toast: ToastData; onAction: () => void }) {
  const error = toast.kind === "error";
  // Queued work gets neither the alarm nor the checkmark: it has not failed, and it has not landed either.
  const info = toast.kind === "info";
  return (
    <>
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          error ? "bg-danger/15 text-danger" : info ? "bg-surface-800 text-ink-300" : "bg-accent-500/15 text-accent-400",
        )}
      >
        {error ? (
          <TriangleAlert className="size-4" />
        ) : info ? (
          <CloudUpload className="size-4" />
        ) : (
          <Check className="size-4" strokeWidth={3} />
        )}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-ui font-medium text-ink-100">{toast.text}</span>
        {toast.detail && <span className="block truncate text-2xs text-ink-600">{toast.detail}</span>}
      </span>

      {toast.action && (
        <Button
          variant="outline"
          size="control"
          className="shrink-0"
          onClick={() => {
            toast.action?.run();
            onAction();
          }}
        >
          {toast.action.label}
        </Button>
      )}
    </>
  );
}
