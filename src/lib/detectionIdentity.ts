/** The parts of the now-playing card's identity lines; keys and numbers, so the component owns every sentence. */
import type { Media, MediaTitle, MediaType } from "@/api/types";

export type EpisodeLabel =
  | { kind: "seasonEpisode"; season: number; episode: number }
  | { kind: "episode"; episode: number }
  | { kind: "chapter"; chapter: number };

/** The season only when the source carried one: Jellyfin drops season 1 and a bare release name has none. */
export function episodeLabel(p: {
  mediaType: MediaType;
  season: number | null;
  episode: number | null;
}): EpisodeLabel | null {
  if (p.episode === null) return null;
  if (p.mediaType === "MANGA") return { kind: "chapter", chapter: p.episode };
  if (p.season !== null) return { kind: "seasonEpisode", season: p.season, episode: p.episode };
  return { kind: "episode", episode: p.episode };
}

/** The native title under the shown one, unless it is the shown one, as `TitleLockup` decides for a card. */
export function nativeLine(title: MediaTitle | null | undefined, shown: string): string | null {
  const native = title?.native?.trim();
  return native && native !== shown ? native : null;
}

export interface MetaParts {
  format: string | null;
  season: string | null;
  seasonYear: number | null;
  total: { kind: "episodes" | "chapters"; n: number } | null;
}

/** What the AniList entry says about the work itself; a manga counts chapters, an anime episodes, unknown counts nothing. */
export function metaParts(
  media: Pick<Media, "format" | "season" | "seasonYear" | "episodes" | "chapters"> | null | undefined,
  mediaType: MediaType,
): MetaParts | null {
  if (!media) return null;
  const count = mediaType === "MANGA" ? (media.chapters ?? null) : media.episodes;
  return {
    format: media.format,
    season: media.season,
    seasonYear: media.seasonYear,
    total: count ? { kind: mediaType === "MANGA" ? "chapters" : "episodes", n: count } : null,
  };
}

/** Joins the rendered parts with the middle dot every meta line in the app uses, dropping the empty ones. */
export function joinMeta(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(" · ");
}
