import { describe, expect, it } from "vitest";
import {
  COMMENTS_PER_PAGE,
  pageAfterPosting,
  refreshPlan,
  PAGE_DEPTH_CAP,
  canJump,
  jumpTarget,
  maxReachablePage,
} from "./threadJump";

describe("maxReachablePage", () => {
  /**
   * Measured at both ends against the live API: perPage 10 serves page 500 and
   * refuses 501; perPage 50 serves page 100 and refuses 101. The cap is on
   * entries, so a bigger page size buys no extra depth.
   */
  it("matches the boundary AniList actually enforces", () => {
    expect(maxReachablePage(10)).toBe(500);
    expect(maxReachablePage(50)).toBe(100);
    expect(maxReachablePage(25)).toBe(200);
    expect(maxReachablePage(10) * 10).toBe(PAGE_DEPTH_CAP);
  });

  /** Never zero, and never a crash on a nonsense page size. */
  it("floors at the first page", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(maxReachablePage(bad)).toBe(1);
    }
    // A page size past the cap still leaves exactly one page to ask for.
    expect(maxReachablePage(PAGE_DEPTH_CAP * 2)).toBe(1);
  });
});

describe("jumpTarget", () => {
  it("goes to the real end when the end is reachable", () => {
    // Thread 2340 — `lastPage: 70`, comfortably inside the cap, and most
    // threads look like this.
    expect(jumpTarget(70)).toEqual({ page: 70, reachable: true });
    expect(jumpTarget(500)).toEqual({ page: 500, reachable: true });
  });

  /**
   * Thread 1: `lastPage: 703` over 7,030 comments. Page 703 answers HTTP 400,
   * and the deepest page that works ends in 2021 while the thread was replied
   * to today. Landing there silently is the failure this flag exists to name.
   */
  it("stops at the cap and says so", () => {
    expect(jumpTarget(703)).toEqual({ page: 500, reachable: false });
    expect(jumpTarget(1706)).toEqual({ page: 500, reachable: false });
  });

  it("survives a malformed page count", () => {
    for (const bad of [0, -1, NaN]) {
      expect(jumpTarget(bad)).toEqual({ page: 1, reachable: true });
    }
    // Fractional never asks for a page that does not exist.
    expect(jumpTarget(70.9).page).toBe(70);
  });

  it("respects a different page size", () => {
    expect(jumpTarget(150, 50)).toEqual({ page: 100, reachable: false });
    expect(jumpTarget(90, 50)).toEqual({ page: 90, reachable: true });
  });
});

describe("canJump", () => {
  /** On a one-page thread the newest reply is already on screen. */
  it("is not offered when there is nowhere to go", () => {
    expect(canJump(1)).toBe(false);
    expect(canJump(0)).toBe(false);
    expect(canJump(null)).toBe(false);
    expect(canJump(undefined)).toBe(false);
  });

  it("is offered as soon as there is a second page", () => {
    expect(canJump(2)).toBe(true);
    expect(canJump(703)).toBe(true);
  });
});

describe("the page size the query actually uses", () => {
  /** If `THREAD_COMMENTS_QUERY` ever changes `perPage`, the reachable depth
   *  changes with it and this constant has to move too. */
  it("is the one the cap arithmetic assumes", () => {
    expect(COMMENTS_PER_PAGE).toBe(10);
  });
});

describe("the page box's ceiling", () => {
  /**
   * The box must cap at what AniList will *serve*, not at `lastPage`. On
   * thread 1 those differ by two hundred pages, and offering 703 would be
   * offering a press that answers HTTP 400.
   */
  it("is the reachable page, not the reported one", () => {
    expect(jumpTarget(703).page).toBe(500);
    expect(jumpTarget(703).page).toBeLessThan(703);
    // And on an ordinary thread the two agree, so nothing is taken away.
    expect(jumpTarget(70).page).toBe(70);
  });
});

describe("refreshPlan", () => {
  /**
   * One view, never both. `refetch()` ignores `enabled`, so refreshing the
   * view that is not on screen spends a request from the ~30/min budget and
   * flips an `isFetching` that disables controls for a jump nobody started.
   */
  it("re-reads only the view on screen", () => {
    expect(refreshPlan(null)).toBe("paged");
    expect(refreshPlan("newest")).toBe("jump");
    expect(refreshPlan(70)).toBe("jump");
  });
});

describe("pageAfterPosting", () => {
  /** Oldest-first and unreorderable, so a new comment is on the LAST page.
   *  Re-reading page 1 is right only when there is only one page. */
  it("points at the last page, not the first", () => {
    expect(pageAfterPosting(1)).toBe(1);
    expect(pageAfterPosting(70)).toBe(70);
  });

  /** Past the cap the comment exists and no page request can reach it.
   *  Null so the caller can say that instead of landing elsewhere. */
  it("admits when the end is unreachable", () => {
    expect(pageAfterPosting(703)).toBeNull();
    expect(pageAfterPosting(1706)).toBeNull();
  });
});
