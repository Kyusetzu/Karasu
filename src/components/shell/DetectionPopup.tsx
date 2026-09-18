import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp } from "lucide-react";
import DetectionSurface from "@/components/media/DetectionSurface";
import { useNowPlaying } from "@/stores/nowPlaying";
import { usePresentValue } from "@/hooks/usePresence";
import { isTauri } from "@/api/anilist";
import {
  loadDetectionView,
  saveDetectionView,
  type DetectionView,
} from "@/lib/detectionView";
import { cn } from "@/lib/utils";

/** Detection wherever the user is, since the detector does not stop when they leave the overview. */
export default function DetectionPopup() {
  const { t } = useTranslation();
  const current = useNowPlaying((s) => s.current);
  const scrobble = useNowPlaying((s) => s.scrobble);
  // Retained through the exit so the card animates away with its title rather than emptying first.
  const shown = usePresentValue(current);
  const [view, setView] = useState<DetectionView>(loadDetectionView);
  const qc = useQueryClient();

  // Only the changed type, read from the store at fire time; keep the broad-key fallback or an absent type never refreshes.
  useEffect(() => {
    if (!isTauri) return;
    const registered = listen("scrobble-done", () => {
      const mediaType = useNowPlaying.getState().current?.mediaType;
      qc.invalidateQueries({
        queryKey: mediaType ? ["mediaList", mediaType] : ["mediaList"],
      });
    });
    return () => {
      // Await the registration itself: under StrictMode the cleanup runs before it settles and a variable is still empty.
      registered.then((un) => un());
    };
  }, [qc]);

  if (!shown.value) return null;
  const playing = shown.value;
  const compact = view === "compact";

  const toggle = () => {
    const next: DetectionView = compact ? "expanded" : "compact";
    setView(next);
    saveDetectionView(next);
  };

  return (
    <div
      // Not a dialog: it arrives unprompted, so it takes no focus and sets no `data-overlay`, and list keys keep working.
      className={cn(
        "pointer-events-auto relative w-full overflow-hidden rounded-[.875rem] border border-hair bg-surface-900 shadow-2xl panel-wash",
        compact ? "px-3 py-2" : "px-4.5 py-4",
        shown.leaving ? "animate-rise-out" : "animate-rise-in",
      )}
      // A detection the pointer is over is a detection being read, so the target is named for a screen reader too.
      aria-label={t("nowPlaying.title")}
    >
      {/* Its own element: the card's `animation` is spoken for by the entrance and exit. */}
      {scrobble.phase === "watching" && !shown.leaving && !compact && (
        <span
          aria-hidden
          className="animate-idle-glow pointer-events-none absolute inset-0 rounded-[.875rem]"
        />
      )}
      <div className={cn(compact ? "pr-6" : "pr-7")}>
        <DetectionSurface playing={playing} variant={view} />
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!compact}
        aria-label={t(compact ? "nowPlaying.expand" : "nowPlaying.collapse")}
        title={t(compact ? "nowPlaying.expand" : "nowPlaying.collapse")}
        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-200"
      >
        {compact ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
    </div>
  );
}
