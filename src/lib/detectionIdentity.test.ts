import { describe, expect, it } from "vitest";
import { episodeLabel, joinMeta, metaParts, nativeLine } from "@/lib/detectionIdentity";

describe("episodeLabel", () => {
  it("names the season only when the source carried one", () => {
    expect(episodeLabel({ mediaType: "ANIME", season: 2, episode: 5 })).toEqual({
      kind: "seasonEpisode",
      season: 2,
      episode: 5,
    });
    // Jellyfin drops season 1 and a fansub name has none: the label is the episode alone, not "S1".
    expect(episodeLabel({ mediaType: "ANIME", season: null, episode: 5 })).toEqual({
      kind: "episode",
      episode: 5,
    });
  });

  it("counts chapters for manga whatever the season field says", () => {
    expect(episodeLabel({ mediaType: "MANGA", season: 3, episode: 12 })).toEqual({
      kind: "chapter",
      chapter: 12,
    });
  });

  it("has nothing to say without a number", () => {
    expect(episodeLabel({ mediaType: "ANIME", season: 2, episode: null })).toBeNull();
  });
});

describe("nativeLine", () => {
  const title = { romaji: "Sousou no Frieren", english: "Frieren", native: "葬送のフリーレン" };

  it("shows the native title under a different shown one", () => {
    expect(nativeLine(title, "Frieren")).toBe("葬送のフリーレン");
  });

  it("does not repeat the shown title, and copes with no title at all", () => {
    expect(nativeLine(title, "葬送のフリーレン")).toBeNull();
    expect(nativeLine({ ...title, native: "  " }, "Frieren")).toBeNull();
    expect(nativeLine(null, "Frieren")).toBeNull();
  });
});

describe("metaParts", () => {
  const media = { format: "TV", season: "FALL", seasonYear: 2023, episodes: 28, chapters: 140 };

  it("counts episodes for anime and chapters for manga", () => {
    expect(metaParts(media, "ANIME")).toEqual({
      format: "TV",
      season: "FALL",
      seasonYear: 2023,
      total: { kind: "episodes", n: 28 },
    });
    expect(metaParts({ ...media, format: "MANGA" }, "MANGA")?.total).toEqual({
      kind: "chapters",
      n: 140,
    });
  });

  it("leaves an unknown or zero count out rather than claiming it", () => {
    expect(metaParts({ ...media, episodes: null }, "ANIME")?.total).toBeNull();
    expect(metaParts({ ...media, chapters: 0 }, "MANGA")?.total).toBeNull();
    expect(metaParts({ ...media, chapters: undefined }, "MANGA")?.total).toBeNull();
  });

  it("is null without an entry to read", () => {
    expect(metaParts(null, "ANIME")).toBeNull();
    expect(metaParts(undefined, "ANIME")).toBeNull();
  });
});

describe("joinMeta", () => {
  it("joins what is there with the middle dot and drops the rest", () => {
    expect(joinMeta(["TV", null, "Fall 2023", undefined, "", "28 ep."])).toBe("TV · Fall 2023 · 28 ep.");
    expect(joinMeta([null, ""])).toBe("");
  });
});
