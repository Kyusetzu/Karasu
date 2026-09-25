import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePullToSync } from "@/hooks/usePullToSync";
import { PULL_TRIGGER_PX } from "@/lib/pullToSync";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { usePresence } from "@/hooks/usePresence";

/** What the pill draws: how far it has travelled and which of its three states it is in. */
interface PillView {
  offset: number;
  armed: boolean;
  syncing: boolean;
}

/** The phone shell's pull indicator: it rides the finger down and turns accent once letting go would sync. */
export default function PullToSync() {
  const { t } = useTranslation();
  const { state, syncing, available } = usePullToSync();

  const armed = state.phase === "ready";
  const shown = available && (state.phase === "pulling" || armed || syncing);
  const { mounted } = usePresence(shown);
  // Taken while shown, because the state has already reset by the time the exit renders, and the pill fades as it stood.
  const last = useRef<PillView>({ offset: 0, armed: false, syncing: false });
  if (shown) last.current = { offset: syncing ? PULL_TRIGGER_PX : state.offset, armed, syncing };
  if (!mounted) return null;

  const reduced = prefersReducedMotion();
  const view = last.current;
  const label = view.syncing
    ? t("pull.syncing")
    : view.armed
      ? t("pull.release")
      : t("pull.hint");

  return (
    <div
      // Sits in the shell's floating layer: above the page, below every overlay, and never in the way of a touch.
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
      style={reduced ? undefined : { transform: `translateY(${view.offset}px)` }}
    >
      <div
        role="status"
        className={cn(
          "mt-2 flex items-center gap-2 rounded-full border border-hair bg-surface-900 px-3 py-1.5 shadow-float panel-wash",
          view.armed || view.syncing ? "text-accent-400" : "text-ink-500",
          !shown && "animate-fade-out",
        )}
      >
        <Spinner
          spinning={view.syncing}
          className="size-3.5"
          // The arrow turns with the pull, so the distance left to the threshold is legible without a label.
          style={
            reduced || view.syncing
              ? undefined
              : { transform: `rotate(${(view.offset / PULL_TRIGGER_PX) * 180}deg)` }
          }
        />
        <span className="text-2xs font-medium tracking-caption">{label}</span>
      </div>
    </div>
  );
}
