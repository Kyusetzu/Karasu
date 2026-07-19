import type { TFunction } from "i18next";

/** Remaining watch time in minutes for an anime entry, or null if unknown. */
export function remainingMinutes(
  media: { episodes: number | null; duration?: number | null },
  progress: number,
): number | null {
  const episodes = media.episodes;
  const duration = media.duration ?? null;
  if (episodes == null || duration == null) return null;
  return Math.max(0, episodes - progress) * duration;
}

/** Human-readable duration ("3d 4h" / "12h 30m" / "45m"), localized. */
export function formatMinutes(total: number, t: TFunction): string {
  if (total <= 0) return t("time.none");
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = Math.round(total % 60);
  if (days > 0) return t("time.dh", { d: days, h: hours });
  if (hours > 0) return t("time.hm", { h: hours, m: minutes });
  return t("time.m", { m: minutes });
}
