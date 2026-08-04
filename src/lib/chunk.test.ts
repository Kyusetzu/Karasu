import { describe, expect, it } from "vitest";
import { chunk, missingIds, PAGE_MAX } from "./chunk";

describe("chunk", () => {
  it("never exceeds a page, and never emits an empty one", () => {
    const ids = Array.from({ length: 137 }, (_, i) => i);
    const pages = chunk(ids);
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.length > 0 && p.length <= PAGE_MAX)).toBe(true);
    expect(pages.flat()).toEqual(ids);
  });

  it("returns nothing for nothing, rather than one empty request", () => {
    expect(chunk([])).toEqual([]);
  });

  it("keeps an exact multiple from producing a trailing empty page", () => {
    expect(chunk(Array.from({ length: 100 }, (_, i) => i))).toHaveLength(2);
  });

  it("refuses a size that would loop forever", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
  });
});

describe("missingIds", () => {
  it("returns only what is absent", () => {
    expect(missingIds([1, 2, 3], new Set([2]))).toEqual([1, 3]);
  });

  it("de-duplicates, so one id is never fetched twice in a batch", () => {
    expect(missingIds([7, 7, 7], new Set())).toEqual([7]);
  });

  /**
   * The reason this function sorts at all. The same set arriving in a different
   * order must produce the same array, or a query key built from it changes on
   * every render and the cache is defeated.
   */
  it("is stable regardless of input order", () => {
    expect(missingIds([3, 1, 2], new Set())).toEqual(
      missingIds([2, 3, 1], new Set()),
    );
  });

  it("is empty when everything is already known", () => {
    expect(missingIds([1, 2], new Set([1, 2]))).toEqual([]);
  });
});
