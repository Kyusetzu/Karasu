import { describe, expect, it } from "vitest";
import {
  conflicts,
  hasResidual,
  localWins,
  residual,
  type MergeExtras,
  type MergeSide,
} from "./mergeDecision";

const side = (over: Partial<MergeSide> = {}): MergeSide => ({
  status: "CURRENT",
  progress: 3,
  scoreRaw: 0,
  updatedAt: 1_000,
  ...over,
});

/** An AniList row as AniList actually spells an empty one. */
const bare = (over: Partial<MergeExtras> = {}): MergeExtras => ({
  progressVolumes: 0,
  repeat: 0,
  notes: null,
  private: false,
  startedAt: null,
  completedAt: null,
  ...over,
});

/** A local row as the local list actually spells an empty one. */
const localBare = (over: Partial<MergeExtras> = {}): MergeExtras => ({
  ...bare({ notes: "", ...over }),
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

describe("residual", () => {
  /**
   * The defect: `conflicts` weighs three fields, the merge deletes the local
   * row on the strength of that answer, and the other six went with it while
   * the tally said "merged". A row agreeing on status, progress and score can
   * still be the only place a rewatch count or a start date exists.
   */
  it("reports what only the local row holds", () => {
    const out = residual(
      localBare({
        progressVolumes: 12,
        repeat: 2,
        notes: "borrowed from Ana",
        private: true,
        startedAt: { year: 2019, month: 4, day: null },
      }),
      bare(),
    );
    expect(out).toEqual({
      progressVolumes: 12,
      repeat: 2,
      notes: "borrowed from Ana",
      private: true,
      startedAt: { year: 2019, month: 4, day: null },
    });
    expect(hasResidual(out)).toBe(true);
  });

  /**
   * Why this is not simply `conflicts` widened to nine fields.
   *
   * AniList returns `notes: null` and all-null `FuzzyDate`s exactly where the
   * local list stores `""` and nulls. Comparing them raw makes every untouched
   * row look like a conflict, and under the default "newest" strategy — where
   * ties go local — those phantom conflicts resolve by overwriting a real
   * AniList entry. Empty is empty in both dialects.
   */
  it("finds nothing between two empty rows spelled differently", () => {
    expect(hasResidual(residual(localBare(), bare()))).toBe(false);
    expect(
      hasResidual(
        residual(
          localBare({ startedAt: { year: null, month: null, day: null } }),
          bare({ startedAt: null }),
        ),
      ),
    ).toBe(false);
    expect(hasResidual(residual(localBare({ notes: "   " }), bare()))).toBe(false);
  });

  /**
   * Additive only. Where both sides have a value it is a conflict, and
   * `localWins` plus the user's chosen strategy already own that decision —
   * a residual push must never be a second, silent arbiter.
   */
  it("never overwrites a value AniList already has", () => {
    const out = residual(
      localBare({
        progressVolumes: 3,
        repeat: 1,
        notes: "mine",
        startedAt: { year: 2019, month: null, day: null },
      }),
      bare({
        progressVolumes: 12,
        repeat: 5,
        notes: "theirs",
        startedAt: { year: 2024, month: 1, day: 1 },
      }),
    );
    expect(hasResidual(out)).toBe(false);
  });

  /** Privacy only ever tightens: a merge must not publish, nor un-publish. */
  it("carries private across but never clears it", () => {
    expect(residual(localBare({ private: true }), bare()).private).toBe(true);
    expect(
      hasResidual(residual(localBare({ private: false }), bare({ private: true }))),
    ).toBe(false);
  });
});
