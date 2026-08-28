import { describe, expect, it } from "vitest";
import {
  COMMENTS_PER_PAGE,
  pageAfterPosting,
  refreshPlan,
  PAGE_DEPTH_CAP,
  canJump,
  jumpRoute,
  jumpTarget,
  maxReachablePage,
  parsePageInput,
  isCommentTarget,
  parseCommentParam,
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
    // A reply posted from the comment landing re-reads the tree, never the
    // paged cache it is not looking at.
    expect(refreshPlan({ comment: 5 })).toBe("jump");
  });
});

describe("isCommentTarget", () => {
  it("recognises only the comment flavour", () => {
    expect(isCommentTarget({ comment: 5 })).toBe(true);
    expect(isCommentTarget(null)).toBe(false);
    expect(isCommentTarget("newest")).toBe(false);
    expect(isCommentTarget(70)).toBe(false);
  });
});

describe("parseCommentParam", () => {
  it("accepts only digits of at least one", () => {
    expect(parseCommentParam("123")).toBe(123);
    expect(parseCommentParam("007")).toBe(7);
    // Validity past the shape is AniList's to judge — the empty-tree
    // fallback answers for ids that do not exist.
    expect(parseCommentParam("99999999999")).toBe(99999999999);
  });

  it("refuses everything that is not a comment id", () => {
    for (const bad of [null, "", "  ", "abc", "NaN", "1e3", "1.5", "-4", "0"]) {
      expect(parseCommentParam(bad), String(bad)).toBeNull();
    }
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

describe("jumpRoute", () => {
  /**
   * The ordinary thread, and the one most at risk of regressing: everything
   * inside the cap must keep taking the plain page, because a page arrives with
   * ten root comments of context and a tree arrives with one conversation.
   */
  it("pages when AniList will serve the last page", () => {
    expect(jumpRoute(1, 3236565)).toBe("page");
    expect(jumpRoute(70, 3236565)).toBe("page");
    // The exact boundary at the query's own page size — 500 x 10 = 5,000.
    expect(jumpRoute(500, 3236565)).toBe("page");
    // No reply comment to resolve does not matter while paging still reaches.
    expect(jumpRoute(70, null)).toBe("page");
  });

  /**
   * Thread 1 measured: 7,045 root comments, `lastPage: 705` at perPage 10, and
   * the deepest servable page ends in 2021. `replyCommentId` is the only thing
   * that reaches the reply posted today.
   */
  it("resolves the newest comment once paging cannot reach it", () => {
    expect(jumpRoute(501, 3236565)).toBe("tree");
    expect(jumpRoute(705, 3236565)).toBe("tree");
    // Thread 15346: 70,348 root comments, 93% of it past the cap.
    expect(jumpRoute(7035, 3236662)).toBe("tree");
  });

  /**
   * Past the cap with nothing to resolve. A deleted newest comment is the real
   * case — AniList answers "Not Found." for it — and the screen has to say the
   * end was not reached rather than implying it was.
   */
  it("admits defeat rather than implying it reached the end", () => {
    expect(jumpRoute(705, null)).toBe("capped");
    expect(jumpRoute(705, undefined)).toBe("capped");
    expect(jumpRoute(705, 0)).toBe("capped");
  });

  /** The cap is on entries, so the page size moves where the tier changes. */
  it("follows the page size it is given", () => {
    expect(jumpRoute(334, 1, 15)).toBe("tree");
    expect(jumpRoute(333, 1, 15)).toBe("page");
  });
});

describe("parsePageInput", () => {
  /** The bug this exists for: Number("") is 0, and 0 is finite. */
  it("treats an empty box as no instruction", () => {
    expect(parsePageInput("", 500)).toBeNull();
    expect(parsePageInput("   ", 500)).toBeNull();
  });

  it("refuses anything that is not a page", () => {
    expect(parsePageInput("abc", 500)).toBeNull();
    expect(parsePageInput("NaN", 500)).toBeNull();
    expect(parsePageInput("Infinity", 500)).toBeNull();
  });

  it("clamps into what AniList will actually serve", () => {
    expect(parsePageInput("1", 500)).toBe(1);
    expect(parsePageInput("42", 500)).toBe(42);
    expect(parsePageInput("0", 500)).toBe(1);
    expect(parsePageInput("-7", 500)).toBe(1);
    expect(parsePageInput("9999", 500)).toBe(500);
    expect(parsePageInput("12.8", 500)).toBe(12);
  });
});
