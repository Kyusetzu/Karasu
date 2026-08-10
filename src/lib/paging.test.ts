import { describe, expect, it } from "vitest";
import { fetchedCount, nextPageParam, remainingCount } from "./paging";

describe("nextPageParam", () => {
  it("advances from the response's own currentPage", () => {
    expect(nextPageParam({ currentPage: 1, hasNextPage: true })).toBe(2);
    expect(nextPageParam({ currentPage: 7, hasNextPage: true })).toBe(8);
  });

  it("stops when there is no next page", () => {
    expect(nextPageParam({ currentPage: 3, hasNextPage: false })).toBeUndefined();
  });

  it("stops rather than guessing when pageInfo is unusable", () => {
    // `undefined` is what tells useInfiniteQuery there is no more. Returning a
    // number on bad input would load page NaN forever.
    expect(nextPageParam(null)).toBeUndefined();
    expect(nextPageParam(undefined)).toBeUndefined();
    expect(nextPageParam({})).toBeUndefined();
    expect(nextPageParam({ hasNextPage: true })).toBeUndefined();
    expect(nextPageParam({ currentPage: null, hasNextPage: true })).toBeUndefined();
    expect(nextPageParam({ currentPage: 0, hasNextPage: true })).toBeUndefined();
    expect(nextPageParam({ currentPage: -2, hasNextPage: true })).toBeUndefined();
    expect(nextPageParam({ currentPage: NaN, hasNextPage: true })).toBeUndefined();
  });

  it("treats a missing hasNextPage as the end, not the beginning", () => {
    expect(nextPageParam({ currentPage: 1 })).toBeUndefined();
    expect(nextPageParam({ currentPage: 1, hasNextPage: null })).toBeUndefined();
  });
});

describe("remainingCount", () => {
  it("counts against what was fetched", () => {
    expect(remainingCount({ total: 121 }, 50)).toBe(71);
    expect(remainingCount({ total: 121 }, 100)).toBe(21);
    expect(remainingCount({ total: 121 }, 121)).toBe(0);
  });

  it("counts fetched rows, not visible ones — the filter must not inflate it", () => {
    // A strict content filter can leave 4 of 25 fetched rows on screen. Counting
    // the visible 4 would promise 21 more when the next page brings nothing new,
    // which misrepresents the rate limit a click costs.
    const fetched = 25;
    const visibleAfterFilter = 4;
    expect(remainingCount({ total: 25 }, fetched)).toBe(0);
    expect(remainingCount({ total: 25 }, visibleAfterFilter)).toBe(21); // the wrong call
  });

  it("never goes negative when someone unfollows mid-session", () => {
    expect(remainingCount({ total: 40 }, 50)).toBe(0);
  });

  it("reports nothing remaining when total is unusable", () => {
    expect(remainingCount(null, 10)).toBe(0);
    expect(remainingCount({}, 10)).toBe(0);
    expect(remainingCount({ total: null }, 10)).toBe(0);
    expect(remainingCount({ total: NaN }, 10)).toBe(0);
  });
});

describe("fetchedCount", () => {
  it("sums every loaded page", () => {
    expect(fetchedCount([{ users: [1, 2, 3] }, { users: [4, 5] }])).toBe(5);
    expect(fetchedCount([{ items: [1] }, { items: [2, 3] }])).toBe(3);
  });

  it("handles no pages and empty pages", () => {
    expect(fetchedCount(undefined)).toBe(0);
    expect(fetchedCount([])).toBe(0);
    expect(fetchedCount([{ users: [] }])).toBe(0);
    expect(fetchedCount([{}])).toBe(0);
  });
});
