import type { Season, WrappedEntry } from "@/api/queries";
import { displayTitle, type MediaListGroup } from "@/api/types";

/** The completed entries of a cached list, as Wrapped wants them; the list already holds every field, so no request. */
export function fromList(lists: MediaListGroup[]): WrappedEntry[] {
  const seen = new Set<number>();
  const out: WrappedEntry[] = [];
  for (const group of lists) {
    // Custom lists repeat entries that the status lists already carry.
    if (group.isCustomList) continue;
    for (const e of group.entries) {
      if (e.status !== "COMPLETED" || seen.has(e.media.id)) continue;
      seen.add(e.media.id);
      out.push({
        mediaId: e.media.id,
        progress: e.progress,
        score: e.score,
        year: e.completedAt?.year ?? null,
        duration: e.media.duration ?? null,
        genres: e.media.genres ?? [],
        isAdult: e.media.isAdult ?? false,
        season: (e.media.season as Season | null) ?? null,
        seasonYear: e.media.seasonYear ?? null,
        title: e.media.title,
      });
    }
  }
  return out;
}

/** What one card covers: a year is bucketed by completion, a season by broadcast, as `SeasonPicker` means it. */
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

/** Aggregates a period across both media; `hideGenre` keeps a filtered genre label off the exported, shareable card. */
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

/** Distinct broadcast seasons with at least one completed title, newest first, since an empty season is not worth offering. */
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
