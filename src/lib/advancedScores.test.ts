import { describe, expect, it } from "vitest";
import {
  anyScored,
  derivedOverall,
  orderedCategories,
  toAdvancedArray,
} from "./advancedScores";

const NAMES = ["Story", "Characters", "Visuals"];

describe("orderedCategories", () => {
  it("uses the account's order, not the map's", () => {
    // The read map arrives in whatever order the server serialised it.
    const scores = { Visuals: 7, Story: 9, Characters: 8 };
    expect(orderedCategories(NAMES, scores)).toEqual([
      { name: "Story", value: 9 },
      { name: "Characters", value: 8 },
      { name: "Visuals", value: 7 },
    ]);
  });

  it("shows an unscored category as 0 rather than dropping it", () => {
    expect(orderedCategories(NAMES, { Story: 9 })).toEqual([
      { name: "Story", value: 9 },
      { name: "Characters", value: 0 },
      { name: "Visuals", value: 0 },
    ]);
  });

  /** The account is authoritative: a renamed-away category is gone. */
  it("drops a score for a category the account no longer has", () => {
    const out = orderedCategories(["Story"], { Story: 9, Waifu: 10 });
    expect(out).toEqual([{ name: "Story", value: 9 }]);
  });

  it("survives a null map and unparseable values", () => {
    expect(orderedCategories(["Story"], null)).toEqual([{ name: "Story", value: 0 }]);
    expect(
      orderedCategories(["Story", "Characters"], {
        Story: "nine" as unknown as number,
        Characters: NaN,
      }),
    ).toEqual([
      { name: "Story", value: 0 },
      { name: "Characters", value: 0 },
    ]);
  });

  it("has nothing to show when the account has no categories", () => {
    expect(orderedCategories([], { Story: 9 })).toEqual([]);
  });
});

describe("toAdvancedArray", () => {
  /**
   * THE test. `SaveMediaListEntry(advancedScores:)` is a bare `[Float]` with
   * no names in it — position is the identity. Building it from the read map's
   * key order works until the user reorders a category on anilist.co, and then
   * writes Story's score into Characters with nothing reporting it.
   */
  it("is ordered by the account's category list, whatever order the values came in", () => {
    const values = { Visuals: 7, Story: 9, Characters: 8 };
    expect(toAdvancedArray(NAMES, values)).toEqual([9, 8, 7]);
    // Reordered on the account → the array follows the account, not the map.
    expect(toAdvancedArray(["Visuals", "Story", "Characters"], values)).toEqual([
      7, 9, 8,
    ]);
  });

  /**
   * Complete, never sparse. A short array does not mean "the rest unchanged";
   * it shifts every category after the gap by one position.
   */
  it("sends a zero for an unscored category rather than a shorter array", () => {
    expect(toAdvancedArray(NAMES, { Characters: 8 })).toEqual([0, 8, 0]);
    expect(toAdvancedArray(NAMES, {})).toEqual([0, 0, 0]);
  });

  it("never emits a negative or a NaN", () => {
    expect(
      toAdvancedArray(NAMES, {
        Story: -3,
        Characters: NaN,
        Visuals: 6,
      }),
    ).toEqual([0, 0, 6]);
  });
});

describe("derivedOverall", () => {
  /** Unscored is an absence, not a zero — the rule the rest of the app follows. */
  it("averages only what has been scored", () => {
    expect(derivedOverall([9, 0, 7])).toBe(8);
    expect(derivedOverall([8, 8, 8])).toBe(8);
  });

  it("is 0 when nothing is scored, which is also 'no score'", () => {
    expect(derivedOverall([])).toBe(0);
    expect(derivedOverall([0, 0])).toBe(0);
  });
});

describe("anyScored", () => {
  it("distinguishes an untouched set from a scored one", () => {
    expect(anyScored([0, 0, 0])).toBe(false);
    expect(anyScored([0, 1, 0])).toBe(true);
  });
});
