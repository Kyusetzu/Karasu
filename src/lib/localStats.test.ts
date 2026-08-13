import { describe, expect, it } from "vitest";
import { scoreDelta } from "./localStats";
import type { MediaListEntry } from "@/api/types";

const entry = (
  mediaId: number,
  score: number,
  averageScore: number | null,
  title = `Show ${mediaId}`,
) =>
  ({
    id: mediaId,
    mediaId,
    score,
    media: {
      id: mediaId,
      title: { romaji: title, english: null, native: null },
      averageScore,
    },
  }) as unknown as MediaListEntry;

describe("scoreDelta", () => {
  it("compares on one scale: mine is ten-point, the community's is hundred-point", () => {
    const out = scoreDelta([entry(1, 8, 70)]);
    expect(out).not.toBeNull();
    expect(out!.meanMine).toBe(8);
    expect(out!.meanCommunity).toBe(7);
    expect(out!.meanDelta).toBe(1);
  });

  it("excludes the unscored and the unrated rather than counting them as zero", () => {
    const out = scoreDelta([
      entry(1, 8, 70),
      entry(2, 0, 80), // user never scored it
      entry(3, 7, null), // AniList has no mean
    ]);
    expect(out!.count).toBe(1);
  });

  it("returns null when nothing is comparable — a panel that draws from it can hide", () => {
    expect(scoreDelta([])).toBeNull();
    expect(scoreDelta([entry(1, 0, 70)])).toBeNull();
  });

  it("splits disagreements by direction, biggest first, capped at top", () => {
    const out = scoreDelta(
      [
        entry(1, 3, 80, "overrated-a"), // -5
        entry(2, 5, 80, "overrated-b"), // -3
        entry(3, 10, 60, "hidden-gem"), // +4
        entry(4, 8, 70, "slightly-up"), // +1
        entry(5, 7, 70, "agreed"), // 0
      ],
      1,
    );
    expect(out!.harshest.map((r) => r.title)).toEqual(["overrated-a"]);
    expect(out!.kindest.map((r) => r.title)).toEqual(["hidden-gem"]);
    // Zero-delta agreement appears on neither side.
    expect([...out!.harshest, ...out!.kindest].some((r) => r.delta === 0)).toBe(false);
  });

  it("counts each title once, however many custom lists repeat it", () => {
    const out = scoreDelta([entry(1, 8, 70), entry(1, 8, 70)]);
    expect(out!.count).toBe(1);
  });
});
