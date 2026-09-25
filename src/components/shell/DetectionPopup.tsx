import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp, GripHorizontal } from "lucide-react";
import DetectionSurface, { ScrobbleActions } from "@/components/media/DetectionSurface";
import { DecodedImage } from "@/components/media/DecodedImage";
import { IconButton } from "@/components/ui/icon-button";
import { useNowPlaying } from "@/stores/nowPlaying";
import { usePresentValue } from "@/hooks/usePresence";
import { usePhoneShell } from "@/hooks/usePhoneShell";
import { useDetectionDrag } from "@/hooks/useDetectionDrag";
import { useDetectionMedia } from "@/hooks/useDetectionMedia";
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
  const phone = usePhoneShell();
  const card = useRef<HTMLDivElement>(null);
  // The phone keeps the dock above its bottom bar; only the desktop card is a window that can be moved.
  const drag = useDetectionDrag(card, !phone);
  const media = useDetectionMedia(shown.value?.mediaId ?? null);

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
  const free = !phone && drag.position !== null;
  const cover = media?.coverImage.large ?? null;
  const heading = t(playing.mediaType === "MANGA" ? "nowPlaying.headingManga" : "nowPlaying.heading", {
    process: playing.process.replace(".exe", ""),
  });

  const toggle = () => {
    const next: DetectionView = compact ? "expanded" : "compact";
    setView(next);
    saveDetectionView(next);
  };

  const chevron = (
    <IconButton
      size="xs"
      onClick={toggle}
      aria-expanded={!compact}
      aria-label={t(compact ? "nowPlaying.expand" : "nowPlaying.collapse")}
      title={t(compact ? "nowPlaying.expand" : "nowPlaying.collapse")}
      className={cn("text-ink-600", compact && "absolute right-1.5 top-1.5")}
    >
      {compact ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </IconButton>
  );

  return (
    <div
      ref={card}
      // Not a dialog: it arrives unprompted, so it takes no focus and sets no `data-overlay`, and list keys keep working.
      className={cn(
        "pointer-events-auto overflow-hidden rounded-[.875rem] border border-hair bg-surface-900 shadow-float panel-wash",
        free ? "fixed z-30" : "relative w-88 max-w-full",
        shown.leaving ? "animate-rise-out" : "animate-rise-in",
      )}
      style={
        free
          ? { left: drag.position!.left, top: drag.position!.top, width: drag.width }
          : phone
            ? undefined
            : { width: drag.width }
      }
      role="region"
      aria-label={t("nowPlaying.title")}
    >
      {cover && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <DecodedImage
            src={cover}
            loadedOpacity={0.35}
            className="h-full w-full scale-110 object-cover blur-2xl"
          />
          <div className="absolute inset-0 bg-surface-900/55" />
          <div className="cover-scrim absolute inset-0" />
        </div>
      )}
      {scrobble.phase === "watching" && !shown.leaving && !compact && (
        <span
          aria-hidden
          className="animate-idle-glow pointer-events-none absolute inset-0 rounded-[.875rem]"
        />
      )}
      {!compact && (
        <div
          {...drag.handleProps}
          title={phone ? undefined : t("nowPlaying.dragHint")}
          className={cn(
            "relative flex h-8 select-none items-center gap-2 pl-3 pr-1.5",
            !phone && "cursor-grab touch-none",
            drag.dragging && "cursor-grabbing",
          )}
        >
          <span className="size-1.5 shrink-0 animate-blip rounded-full bg-accent-500" />
          <p className="min-w-0 flex-1 truncate text-2xs font-medium uppercase tracking-[.09em] text-accent-400">
            {heading}
          </p>
          <ScrobbleActions playing={playing} />
          {!phone && <GripHorizontal aria-hidden className="size-3.5 shrink-0 text-ink-600" />}
          {chevron}
        </div>
      )}
      <div
        {...(compact ? drag.handleProps : {})}
        className={cn("relative", compact ? "px-3 py-2 pr-8" : "px-3 pb-3", compact && !phone && "touch-none")}
      >
        <DetectionSurface playing={playing} variant={view} media={media} />
      </div>
      {compact && chevron}
      {!phone && (
        <div
          {...drag.edgeProps("left")}
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize touch-none select-none"
        />
      )}
      {free && (
        <div
          {...drag.edgeProps("right")}
          aria-hidden
          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none select-none"
        />
      )}
    </div>
  );
}
