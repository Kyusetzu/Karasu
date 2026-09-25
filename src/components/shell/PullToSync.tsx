import { useTranslation } from "react-i18next";
import { usePullToSync } from "@/hooks/usePullToSync";
import { PULL_TRIGGER_PX } from "@/lib/pullToSync";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { usePresence } from "@/hooks/usePresence";
import { useRef } from "react";

/** The phone shell's pull indicator: it rides the finger down and turns accent once letting go would sync. */
export default function PullToSync() {
  const { t } = useTranslation();
  const { state, syncing, available } = usePullToSync();

  const armed = state.phase === "ready";
  const pulling = state.phase === "pulling" || armed;
  const { mounted, leaving } = usePresence(available && (pulling || syncing));
  // Where the pill last stood, so a release or a finished sync fades it out in place instead of snapping it to the top.
  const lastOffset = useRef(0);
  if (!mounted) return null;

  const reduced = prefersReducedMotion();
  const live = syncing ? PULL_TRIGGER_PX : state.offset;
  if (!leaving) lastOffset.current = live;
  const offset = leaving ? lastOffset.current : live;
  const label = syncing
    ? t("pull.syncing")
    : armed
      ? t("pull.release")
      : t("pull.hint");

  return (
    <div
      // Sits in the shell's floating layer: above the page, below every overlay, and never in the way of a touch.
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
      style={reduced ? undefined : { transform: `translateY(${offset}px)` }}
    >
      <div
        role="status"
        className={cn(
          "mt-2 flex items-center gap-2 rounded-full border border-hair bg-surface-900 px-3 py-1.5 shadow-float panel-wash",
          armed || syncing ? "text-accent-400" : "text-ink-500",
          leaving && "animate-fade-out",
        )}
      >
        <Spinner
          spinning={syncing}
          className="size-3.5"
          // The arrow turns with the pull, so the distance left to the threshold is legible without a label.
          style={
            reduced || syncing
              ? undefined
              : { transform: `rotate(${(offset / PULL_TRIGGER_PX) * 180}deg)` }
          }
        />
        <span className="text-2xs font-medium tracking-caption">{label}</span>
      </div>
    </div>
  );
}
