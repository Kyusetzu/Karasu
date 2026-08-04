import { useTranslation } from "react-i18next";
import { useNowPlaying } from "@/stores/nowPlaying";
import { isTauri } from "@/api/anilist";
import { cn } from "@/lib/utils";

/**
 * The centre of the titlebar: what the detector can see, right now.
 *
 * This is the app quietly proving it is working, so it lives in the chrome and
 * never demands attention — no button, no colour change, no badge. It is also
 * `pointer-events-none` on purpose: it sits inside the drag region, and a
 * non-interactive element that swallowed the drag would make the middle third
 * of the titlebar unusable for moving the window.
 */
export default function DetectionPill() {
  const { t } = useTranslation();
  const current = useNowPlaying((s) => s.current);

  // Outside the Tauri shell nothing ever reports, so an idle pill would be a
  // permanent lie rather than a status.
  if (!isTauri) return null;

  const parts = current
    ? [
        current.process,
        current.matchedTitle ?? current.parsedTitle,
        current.episode != null
          ? t(
              current.mediaType === "MANGA" ? "common.chapter" : "common.episode",
              { n: current.episode },
            )
          : null,
      ].filter(Boolean)
    : [];

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 top-1/2 flex h-6 max-w-104 -translate-x-1/2",
        "-translate-y-1/2 items-center gap-1.5 rounded-full border border-hair",
        "bg-surface-900 px-2.5",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 animate-blip rounded-full",
          // Accent while something is actually playing, muted while merely
          // listening — a glance tells the two apart without reading the line.
          current ? "bg-accent-500" : "bg-ink-600",
        )}
      />
      <span className="truncate text-2xs font-medium tracking-[.03em] text-ink-500">
        {current ? parts.join(" · ") : t("nowPlaying.idle")}
      </span>
    </div>
  );
}
