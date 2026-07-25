import { describe, expect, it } from "vitest";
import type { WrappedEntry } from "@/api/queries";
import { aggregate, availableYears } from "./wrapped";

const entry = (p: Partial<WrappedEntry> & { year: number }): WrappedEntry => ({
  mediaId: p.mediaId ?? Math.floor(Math.abs(Math.sin(p.year)) * 1e6),
  progress: p.progress ?? 0,
  score: p.score ?? 0,
  year: p.year,
  duration: p.duration ?? 24,
  genres: p.genres ?? [],
  isAdult: p.isAdult ?? false,
  title: p.title ?? { romaji: "T", english: null, native: null },
});

describe("aggregate", () => {
  const anime = [
    entry({ mediaId: 1, year: 2024, progress: 12, score: 8, duration: 24, genres: ["Action", "Drama"], title: { romaji: "A", english: null, native: null } }),
    entry({ mediaId: 2, year: 2024, progress: 24, score: 6, duration: 24, genres: ["Action"], title: { romaji: "B", english: null, native: null } }),
    entry({ mediaId: 3, year: 2023, progress: 10, score: 9, genres: ["Comedy"] }),
  ];
  const manga = [
    entry({ mediaId: 4, year: 2024, progress: 100, score: 7, genres: ["Romance"], title: { romaji: "M", english: null, native: null } }),
  ];

  it("counts and sums only the selected year", () => {
    const s = aggregate(anime, manga, 2024);
    expect(s.anime.count).toBe(2);
    expect(s.anime.units).toBe(36); // 12 + 24 episodes
    expect(s.anime.minutes).toBe(36 * 24);
    expect(s.manga.count).toBe(1);
    expect(s.manga.units).toBe(100); // chapters
    expect(s.manga.minutes).toBe(0); // no minutes for manga
  });

  it("ranks top genres by frequency", () => {
    const s = aggregate(anime, manga, 2024);
    expect(s.anime.topGenres[0]).toEqual({ name: "Action", count: 2 });
  });

  it("suppresses hidden genre names from the exported card", () => {
    const entries = [
      entry({ year: 2024, genres: ["Action", "Ecchi"] }),
      entry({ year: 2024, genres: ["Ecchi"] }),
    ];
    const s = aggregate(entries, [], 2024, (g) => g === "Ecchi");
    expect(s.anime.topGenres.map((g) => g.name)).toEqual(["Action"]);
  });

  it("averages only scored entries", () => {
    const s = aggregate(anime, manga, 2024);
    expect(s.anime.meanScore).toBeCloseTo(7, 5); // (8 + 6) / 2
  });

  it("orders top titles by score", () => {
    const s = aggregate(anime, manga, 2024);
    expect(s.anime.topTitles[0]).toBe("A"); // score 8 beats 6
  });

  it("is empty for a year with nothing", () => {
    const s = aggregate(anime, manga, 1999);
    expect(s.anime.count).toBe(0);
    expect(s.anime.meanScore).toBe(0);
    expect(s.anime.topGenres).toEqual([]);
  });
});

describe("availableYears", () => {
  it("returns distinct years newest first", () => {
    const a = [entry({ year: 2024 }), entry({ year: 2023 })];
    const m = [entry({ year: 2024 })];
    expect(availableYears(a, m)).toEqual([2024, 2023]);
  });
});
