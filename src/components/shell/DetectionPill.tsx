import { useTranslation } from "react-i18next";
import { useNowPlaying } from "@/stores/nowPlaying";
import { isTauri } from "@/api/anilist";
import { cn } from "@/lib/utils";

/** The centre of the titlebar: what the detector sees now; keep `pointer-events-none` so it does not swallow the drag. */
export default function DetectionPill() {
  const { t } = useTranslation();
  const current = useNowPlaying((s) => s.current);

  // Outside the Tauri shell nothing ever reports, so an idle pill would be a permanent lie rather than a status.
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
          // Accent while something is actually playing, muted while merely listening, so a glance tells them apart.
          current ? "bg-accent-500" : "bg-ink-600",
        )}
      />
      <span className="truncate text-2xs font-medium tracking-caption text-ink-500">
        {current ? parts.join(" · ") : t("nowPlaying.idle")}
      </span>
    </div>
  );
}
