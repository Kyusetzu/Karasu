import { describe, expect, it } from "vitest";
import { conflicts, localWins, type MergeSide } from "./mergeDecision";

const side = (over: Partial<MergeSide> = {}): MergeSide => ({
  status: "CURRENT",
  progress: 3,
  scoreRaw: 0,
  updatedAt: 1_000,
  ...over,
});

describe("conflicts", () => {
  it("sees no conflict when both sides say the same thing", () => {
    expect(conflicts(side(), side())).toBe(false);
  });

  it("compares each tracked field", () => {
    expect(conflicts(side(), side({ status: "COMPLETED" }))).toBe(true);
    expect(conflicts(side(), side({ progress: 4 }))).toBe(true);
    expect(conflicts(side(), side({ scoreRaw: 80 }))).toBe(true);
  });

  /**
   * The reason the interface takes a raw score. A local ★8 reaches this
   * function as 80 and so does an online 80 on a hundred-point account; the
   * comparison would otherwise call every scored entry on such an account a
   * conflict and offer to overwrite it.
   */
  it("ignores a differing timestamp on its own", () => {
    expect(conflicts(side(), side({ updatedAt: 99_999 }))).toBe(false);
  });
});

describe("localWins", () => {
  it("pushes a row AniList does not have", () => {
    expect(localWins(side(), null, "newest")).toBe(true);
    expect(localWins(side(), null, "anilist")).toBe(true);
  });

  it("leaves an identical row alone whatever the strategy", () => {
    for (const s of ["newest", "local", "anilist"] as const) {
      expect(localWins(side(), side(), s)).toBe(false);
    }
  });

  it("obeys an explicit side", () => {
    const online = side({ progress: 50, updatedAt: 9_000 });
    expect(localWins(side(), online, "local")).toBe(true);
    expect(localWins(side(), online, "anilist")).toBe(false);
  });

  /**
   * The data-loss case this whole module was extracted for: a local row left
   * at episode 3 must not overwrite an account that has since reached 50.
   */
  it("keeps the newer side under the newest strategy", () => {
    const stale = side({ progress: 3, updatedAt: 1_000 });
    const fresh = side({ progress: 50, updatedAt: 9_000 });
    expect(localWins(stale, fresh, "newest")).toBe(false);
    expect(localWins(fresh, stale, "newest")).toBe(true);
  });

  /** A tie goes to the local side — it is the one being merged away. */
  it("breaks a tie towards local", () => {
    expect(localWins(side({ progress: 3 }), side({ progress: 50 }), "newest")).toBe(true);
  });
});
