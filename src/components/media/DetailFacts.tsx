import { useTranslation } from "react-i18next";
import { CalendarClock, Clock, Star } from "lucide-react";
import type { MediaDetail } from "@/api/queries";
import { countdown, formatLabel, mediaStatusLabel } from "@/lib/format";
import { formatMinutes, remainingMinutes } from "@/lib/estimate";
import { cn } from "@/lib/utils";

/** The detail header's facts as parts, so the desktop column and the phone's full-width block say the same things. */

/** Score, format, status, counts, duration, season and the main studios, in one wrapping line. */
export function MetaLine({ data, studios, className }: { data: MediaDetail; studios: string[]; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-300", className)}>
      {data.averageScore !== null && (
        <span className="flex items-center gap-1 text-gold">
          <Star className="size-3.5" fill="currentColor" /> {data.averageScore}%
        </span>
      )}
      {data.format && <span>{formatLabel(data.format, t)}</span>}
      {data.status && <span>{mediaStatusLabel(data.status, t)}</span>}
      {data.episodes && (
        <span>
          {data.episodes} {t("common.episodes")}
        </span>
      )}
      {data.chapters && (
        <span>
          {data.chapters} {t("common.chapters")}
        </span>
      )}
      {data.volumes && (
        <span>
          {data.volumes} {t("common.volumes")}
        </span>
      )}
      {data.duration && <span>{t("detail.minutes", { n: data.duration })}</span>}
      {data.seasonYear && (
        <span>
          {data.season ? `${t(`season.${data.season}`)} ` : ""}
          {data.seasonYear}
        </span>
      )}
      {studios.length > 0 && <span className="text-ink-500">{studios.join(", ")}</span>}
    </div>
  );
}

export function GenreChips({ genres, className }: { genres: string[]; className?: string }) {
  if (genres.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {genres.map((g) => (
        <span
          key={g}
          className="rounded-cover border border-hair bg-surface-850 px-2 py-0.5 text-2xs text-ink-300"
        >
          {g}
        </span>
      ))}
    </div>
  );
}

/** How long the rest of an anime takes to watch from the entry's progress; nothing once it is done or unknown. */
export function TimeLeft({ data, className }: { data: MediaDetail; className?: string }) {
  const { t } = useTranslation();
  if (data.type !== "ANIME") return null;
  const remaining = remainingMinutes(data, data.mediaListEntry?.progress ?? 0);
  if (remaining === null || remaining <= 0) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-sm text-ink-300", className)}>
      <Clock className="size-3.5 text-ink-500" />
      {t("detail.timeLeft", { time: formatMinutes(remaining, t) })}
    </p>
  );
}

/** The next episode's air time: a line in the desktop column, a bar with the countdown at its end on the phone. */
export function NextEpisode({ data, bar = false, className }: { data: MediaDetail; bar?: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const next = data.nextAiringEpisode;
  if (!next) return null;
  const date = new Date(next.airingAt * 1000).toLocaleString(i18n.language, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  // > 0, not truthiness: countdown returns "" once past, and at exactly zero 0 && renders a literal 0.
  const until = next.airingAt - Math.floor(Date.now() / 1000);
  const left = until > 0 ? countdown(until, t) : "";
  if (bar) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-control border border-accent-500/30 bg-accent-500/10 px-3 py-2 text-sm",
          className,
        )}
      >
        <CalendarClock aria-hidden className="size-4 shrink-0 text-accent-400" />
        <span className="min-w-0 flex-1 text-ink-100">{t("detail.nextEpisode", { n: next.episode, date })}</span>
        {left && <span className="shrink-0 text-xs text-ink-500">{left}</span>}
      </div>
    );
  }
  return (
    <p className={cn("text-sm text-accent-400", className)}>
      {t("detail.nextEpisode", { n: next.episode, date })}
      {left && <span className="ml-2 text-ink-500">({left})</span>}
    </p>
  );
}
