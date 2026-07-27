import { describe, expect, it } from "vitest";
import type { MediaWithListStatus } from "@/api/queries";
import type { MediaListEntry, MediaListStatus, MediaType } from "@/api/types";
import {
  pickSeeds,
  rankRecommendations,
  seedWeight,
  type RawRecommendation,
} from "./recommend";

const entry = (
  p: Partial<MediaListEntry> & { mediaId: number },
): MediaListEntry =>
  ({
    id: p.mediaId,
    mediaId: p.mediaId,
    status: p.status ?? ("COMPLETED" as MediaListStatus),
    score: p.score ?? 0,
    progress: 0,
    repeat: 0,
    notes: null,
    updatedAt: p.updatedAt ?? 0,
    media: { id: p.mediaId } as MediaListEntry["media"],
  }) as MediaListEntry;

const media = (id: number, type: MediaType = "ANIME"): MediaWithListStatus =>
  ({ id, type, genres: [], isAdult: false }) as unknown as MediaWithListStatus;

const rec = (
  seedId: number,
  rating: number,
  id: number,
  type: MediaType = "ANIME",
): RawRecommendation => ({ seedId, rating, media: media(id, type) });

describe("pickSeeds", () => {
  it("uses only completed entries", () => {
    const seeds = pickSeeds([
      entry({ mediaId: 1, status: "COMPLETED" }),
      entry({ mediaId: 2, status: "CURRENT" }),
      entry({ mediaId: 3, status: "PLANNING" }),
      entry({ mediaId: 4, status: "DROPPED" }),
    ]);
    expect(seeds.map((s) => s.mediaId)).toEqual([1]);
  });

  it("orders by score, then by how recently it was touched", () => {
    const seeds = pickSeeds([
      entry({ mediaId: 1, score: 5 }),
      entry({ mediaId: 2, score: 10 }),
      entry({ mediaId: 3, score: 8, updatedAt: 100 }),
      entry({ mediaId: 4, score: 8, updatedAt: 900 }),
    ]);
    expect(seeds.map((s) => s.mediaId)).toEqual([2, 4, 3, 1]);
  });

  it("de-duplicates ids appearing in several custom lists", () => {
    const seeds = pickSeeds([
      entry({ mediaId: 7, score: 9 }),
      entry({ mediaId: 7, score: 9 }),
    ]);
    expect(seeds).toHaveLength(1);
  });

  it("respects the cap, keeping the best-liked", () => {
    // Scores cycle 0..9, so there are exactly four 9s among the 40.
    const many = Array.from({ length: 40 }, (_, i) =>
      entry({ mediaId: i + 1, score: i % 10 }),
    );
    const seeds = pickSeeds(many, 5);
    expect(seeds.map((s) => s.score)).toEqual([9, 9, 9, 9, 8]);
  });

  /**
   * Pins the reason RecommendedSection sorts the ids before using them as a
   * query key. Any save bumps `updatedAt`, which reshuffles entries inside a
   * score tie — so the raw seed order is unstable and would mint a new cache
   * key, and a fresh AniList request, for a byte-identical result.
   */
  it("reorders within a score tie when updatedAt changes", () => {
    const before = pickSeeds([
      entry({ mediaId: 1, score: 8, updatedAt: 100 }),
      entry({ mediaId: 2, score: 8, updatedAt: 50 }),
    ]);
    const after = pickSeeds([
      entry({ mediaId: 1, score: 8, updatedAt: 100 }),
      entry({ mediaId: 2, score: 8, updatedAt: 200 }),
    ]);
    expect(before.map((s) => s.mediaId)).toEqual([1, 2]);
    expect(after.map((s) => s.mediaId)).toEqual([2, 1]);
  });
});

describe("seedWeight", () => {
  it("treats an unscored entry as a 7/10", () => {
    expect(seedWeight(0)).toBe(seedWeight(7));
    expect(seedWeight(0)).toBeGreaterThan(seedWeight(6));
    expect(seedWeight(10)).toBeGreaterThan(seedWeight(4));
  });
});

describe("rankRecommendations", () => {
  const seeds = [
    { mediaId: 1, score: 10 },
    { mediaId: 2, score: 10 },
  ];
  const base = { seeds, exclude: new Set<number>(), type: "ANIME" as MediaType };

  it("drops down-voted recommendations", () => {
    // AniList lets users vote a pairing down; a negative rating means "these
    // are nothing alike" and must not count as support.
    const out = rankRecommendations(
      [rec(1, -50, 100), rec(1, 0, 101), rec(1, 10, 102)],
      base,
    );
    expect(out.map((r) => r.media.id)).toEqual([102]);
  });

  it("never suggests something already on the list", () => {
    const out = rankRecommendations([rec(1, 500, 100), rec(1, 10, 101)], {
      ...base,
      exclude: new Set([100]),
    });
    expect(out.map((r) => r.media.id)).toEqual([101]);
  });

  it("drops the other media type", () => {
    // An anime's recommendations can include the manga it was adapted from.
    const out = rankRecommendations(
      [rec(1, 500, 100, "MANGA"), rec(1, 10, 101, "ANIME")],
      base,
    );
    expect(out.map((r) => r.media.id)).toEqual([101]);
  });

  it("applies the caller's content filter", () => {
    const out = rankRecommendations([rec(1, 500, 100), rec(1, 10, 101)], {
      ...base,
      isHidden: (m) => m.id === 100,
    });
    expect(out.map((r) => r.media.id)).toEqual([101]);
  });

  it("adds up support across seeds", () => {
    // 60 + 60 beats a single 100.
    const out = rankRecommendations(
      [rec(1, 60, 100), rec(2, 60, 100), rec(1, 100, 101)],
      base,
    );
    expect(out.map((r) => r.media.id)).toEqual([100, 101]);
    expect(out[0].seedCount).toBe(2);
  });

  it("weights a seed by how much the user liked it", () => {
    // Same rating from both, but seed 2 was scored 2/10 and seed 1 10/10.
    const out = rankRecommendations([rec(1, 100, 100), rec(2, 100, 101)], {
      ...base,
      seeds: [
        { mediaId: 1, score: 10 },
        { mediaId: 2, score: 2 },
      ],
    });
    expect(out.map((r) => r.media.id)).toEqual([100, 101]);
    expect(out[0].weight).toBeGreaterThan(out[1].weight);
  });

  it("reports the strongest seed for the 'because you finished' label", () => {
    const out = rankRecommendations([rec(1, 20, 100), rec(2, 900, 100)], base);
    expect(out[0].topSeedId).toBe(2);
  });

  it("ignores nodes from a seed that isn't in the seed set", () => {
    expect(rankRecommendations([rec(999, 500, 100)], base)).toEqual([]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => rec(1, 100 - i, 200 + i));
    expect(rankRecommendations(many, { ...base, limit: 4 })).toHaveLength(4);
  });
});
