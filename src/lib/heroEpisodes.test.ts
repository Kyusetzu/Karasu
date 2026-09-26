import { describe, expect, it } from "vitest";
import { heroEpisodes } from "./heroEpisodes";

const media = (over: Partial<Parameters<typeof heroEpisodes>[0]> = {}) => ({
  status: "FINISHED",
  episodes: 12,
  nextAiringEpisode: null,
  ...over,
});

describe("heroEpisodes", () => {
  /** The case the hero got wrong: episode 14 airing next means 13 are out, not 14 of 14. */
  it("counts the aired episodes of a running show against its total", () => {
    expect(heroEpisodes(media({ status: "RELEASING", episodes: 14, nextAiringEpisode: { episode: 14 } }))).toEqual({
      key: "aired",
      n: 13,
      total: 14,
    });
  });

  it("counts the aired episodes alone when the total is not announced", () => {
    expect(heroEpisodes(media({ status: "RELEASING", episodes: null, nextAiringEpisode: { episode: 30 } }))).toEqual({
      key: "airedOpen",
      n: 29,
    });
  });

  it("gives a finished show its total", () => {
    expect(heroEpisodes(media())).toEqual({ key: "total", n: 12 });
  });

  /** Without a next episode there is nothing to count from, so the total is the honest answer. */
  it("falls back to the total for a running show with no episode scheduled", () => {
    expect(heroEpisodes(media({ status: "RELEASING", episodes: 24 }))).toEqual({ key: "total", n: 24 });
  });

  it("says nothing for a one-episode title or an unknown count", () => {
    expect(heroEpisodes(media({ episodes: 1 }))).toBeNull();
    expect(heroEpisodes(media({ episodes: null }))).toBeNull();
  });
});
