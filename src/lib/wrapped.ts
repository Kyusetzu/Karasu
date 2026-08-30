import type { Season, WrappedEntry } from "@/api/queries";
import { displayTitle } from "@/api/types";

/**
 * What one card covers. Two different questions, named so neither is guessed:
 * a year is bucketed by *completion* (`completedAt.year` — "what I finished
 * in 2026"), a season by *broadcast* (`media.season`/`seasonYear` — "the
 * Winter 2026 shows I finished, whenever I finished them"). Broadcast is
 * what `/seasonal` and `SeasonPicker` mean by season, so the picker can be
 * reused without the word quietly changing meaning.
 */
export type WrappedPeriod =
  | { kind: "year"; year: number }
  | { kind: "season"; season: Season; year: number };

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
  period: WrappedPeriod,
  withMinutes: boolean,
  hideGenre: (name: string) => boolean,
): MediaYearStats {
  const rows = entries.filter((e) =>
    period.kind === "year"
      ? e.year === period.year
      : e.season === period.season && e.seasonYear === period.year,
  );

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
  period: WrappedPeriod,
  hideGenre: (name: string) => boolean = () => false,
): WrappedStats {
  return {
    anime: statsFor(anime, period, true, hideGenre),
    manga: statsFor(manga, period, false, hideGenre),
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

/** In-year display order, newest last — the broadcast calendar's own. */
const SEASON_ORDER: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

/**
 * Distinct broadcast seasons with at least one completed title, newest first
 * (year descending, Fall before Winter within one). Data-driven where the
 * seasonal page's picker is a rolling window — a completion list reaches
 * back a decade, and an empty season is not worth offering.
 */
export function availableSeasons(
  anime: WrappedEntry[],
  manga: WrappedEntry[],
): { season: Season; year: number }[] {
  const seen = new Set<string>();
  const out: { season: Season; year: number }[] = [];
  for (const e of [...anime, ...manga]) {
    if (!e.season || !e.seasonYear) continue;
    const key = `${e.seasonYear}-${e.season}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ season: e.season, year: e.seasonYear });
  }
  return out.sort(
    (a, b) =>
      b.year - a.year ||
      SEASON_ORDER.indexOf(b.season) - SEASON_ORDER.indexOf(a.season),
  );
}
