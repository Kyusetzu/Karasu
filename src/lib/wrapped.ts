import type { WrappedEntry } from "@/api/queries";
import { displayTitle } from "@/api/types";

/** Per-medium, per-year aggregate for the year-in-review card. */
export interface MediaYearStats {
  count: number;
  /** Episodes watched (anime) or chapters read (manga). */
  units: number;
  /** Minutes watched (anime only; 0 for manga). */
  minutes: number;
  meanScore: number;
  topGenres: { name: string; count: number }[];
  topTitles: string[];
}

export interface WrappedStats {
  anime: MediaYearStats;
  manga: MediaYearStats;
}

const TOP_GENRES = 5;
const TOP_TITLES = 5;

function statsFor(
  entries: WrappedEntry[],
  year: number,
  withMinutes: boolean,
  hideGenre: (name: string) => boolean,
): MediaYearStats {
  const rows = entries.filter((e) => e.year === year);

  const genres = new Map<string, number>();
  for (const e of rows) for (const g of e.genres) {
    if (hideGenre(g)) continue;
    genres.set(g, (genres.get(g) ?? 0) + 1);
  }

  const scored = rows.filter((e) => e.score > 0);
  return {
    count: rows.length,
    units: rows.reduce((s, e) => s + e.progress, 0),
    minutes: withMinutes
      ? rows.reduce((s, e) => s + e.progress * (e.duration ?? 24), 0)
      : 0,
    meanScore: scored.length
      ? scored.reduce((s, e) => s + e.score, 0) / scored.length
      : 0,
    topGenres: [...genres.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_GENRES)
      .map(([name, count]) => ({ name, count })),
    topTitles: [...rows]
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_TITLES)
      .map((e) => displayTitle(e.title)),
  };
}

/**
 * Aggregate a year across both media types. `hideGenre` suppresses individual
 * genre *names* from the top-genres bars — the card is exported and shared, so
 * a filtered genre label must not survive even when its entries are gone.
 */
export function aggregate(
  anime: WrappedEntry[],
  manga: WrappedEntry[],
  year: number,
  hideGenre: (name: string) => boolean = () => false,
): WrappedStats {
  return {
    anime: statsFor(anime, year, true, hideGenre),
    manga: statsFor(manga, year, false, hideGenre),
  };
}

/** Distinct completion years across both lists, newest first. */
export function availableYears(
  anime: WrappedEntry[],
  manga: WrappedEntry[],
): number[] {
  const set = new Set<number>();
  for (const e of [...anime, ...manga]) if (e.year) set.add(e.year);
  return [...set].sort((a, b) => b - a);
}
