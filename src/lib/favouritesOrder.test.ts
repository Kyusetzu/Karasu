import { describe, expect, it } from "vitest";
import { FAV_ORDER_ARGS, moveItem, toOrderVars } from "./favouritesOrder";
import type { FavouriteKind } from "@/api/social";

describe("moveItem", () => {
  it("moves up and down", () => {
    expect(moveItem([1, 2, 3, 4], 2, 0)).toEqual([3, 1, 2, 4]);
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });

  it("swaps neighbours, which is what the arrow buttons do", () => {
    expect(moveItem([1, 2, 3], 1, 0)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 1, 2)).toEqual([1, 3, 2]);
  });

  it("clamps past the ends instead of throwing — held arrows are harmless", () => {
    const list = [1, 2, 3];
    expect(moveItem(list, 0, -5)).toBe(list);
    expect(moveItem(list, 2, 99)).toBe(list);
    expect(moveItem(list, 1, -5)).toEqual([2, 1, 3]);
  });

  it("returns the original array untouched for an invalid source", () => {
    const list = [1, 2, 3];
    expect(moveItem(list, -1, 0)).toBe(list);
    expect(moveItem(list, 3, 0)).toBe(list);
    expect(list).toEqual([1, 2, 3]);
  });

  it("never loses or duplicates an item", () => {
    const list = [10, 20, 30, 40, 50];
    for (let from = 0; from < list.length; from++) {
      for (let to = -1; to <= list.length; to++) {
        const moved = moveItem(list, from, to);
        expect([...moved].sort((a, b) => a - b)).toEqual(list);
      }
    }
  });
});

describe("toOrderVars", () => {
  const KINDS: FavouriteKind[] = ["anime", "manga", "character", "staff", "studio"];

  it("always carries the complete id set — dropping one would unfavourite it", () => {
    const ids = [7, 3, 9, 1];
    for (const kind of KINDS) {
      const vars = toOrderVars(kind, ids);
      const [idsArg] = FAV_ORDER_ARGS[kind];
      expect(vars[idsArg]).toEqual(ids);
      expect(vars[idsArg]).toHaveLength(ids.length);
    }
  });

  it("positions are 1-based and match the id order", () => {
    const vars = toOrderVars("anime", [30, 10, 20]);
    expect(vars.animeIds).toEqual([30, 10, 20]);
    expect(vars.animeOrder).toEqual([1, 2, 3]);
  });

  it("sends exactly one kind's pair, so the other kinds stay untouched", () => {
    const vars = toOrderVars("staff", [1, 2]);
    expect(Object.keys(vars).sort()).toEqual(["staffIds", "staffOrder"]);
  });

  it("argument names match the mutation for every kind", () => {
    // The mutation's variable list is the source of truth; a typo here would
    // silently no-op the save (unknown variables are ignored by the API).
    expect(Object.values(FAV_ORDER_ARGS).flat().sort()).toEqual(
      [
        "animeIds", "animeOrder",
        "characterIds", "characterOrder",
        "mangaIds", "mangaOrder",
        "staffIds", "staffOrder",
        "studioIds", "studioOrder",
      ].sort(),
    );
  });
});
