/**
 * Getting to the newest reply in a thread, around two AniList limits.
 *
 * Both were measured against the live API, and both are the reason this is not
 * a one-liner:
 *
 * 1. **`sort` on `threadComments` is inert.** `[ID_DESC]`, `ID_DESC` and `[ID]`
 *    all return the byte-identical page, so "newest first" cannot be asked for.
 *    Page 1 is the oldest and pages ascend. (`id` is ignored too — only
 *    `threadId` and `userId` actually filter.)
 * 2. **Paging is capped at 5,000 entries.** `page × perPage` past that answers
 *    HTTP 400 *"Page depth exceeds maximum allowed for API requests"*. Verified
 *    at both ends: perPage 10 → page 500 works and 501 fails; perPage 50 →
 *    page 100 works and 101 fails.
 *
 * So a thread's `lastPage` is not always a page you can ask for. Thread 1
 * ("New User Intro Thread") reports `lastPage: 703` over 7,030 comments, and the
 * deepest reachable page ends in **2021** while the thread was replied to today.
 * Jumping there and calling it "newest" would be exactly the quiet lie this
 * codebase avoids — hence the second tier, which goes at the newest comment
 * through its *author* instead. See `THREAD_JUMP` in `Thread.tsx`.
 */

/** Entries, not pages: the cap is on `page × perPage`. */
export const PAGE_DEPTH_CAP = 5000;

/** What `THREAD_COMMENTS_QUERY` asks for. Its own comment says why it is 10. */
export const COMMENTS_PER_PAGE = 10;

/** The deepest page AniList will serve at this page size. */
export function maxReachablePage(perPage: number): number {
  if (!Number.isFinite(perPage) || perPage < 1) return 1;
  return Math.max(1, Math.floor(PAGE_DEPTH_CAP / perPage));
}

/**
 * Where to land, and whether that really is the end.
 *
 * `reachable: false` is not a failure — it is the answer for every thread past
 * 5,000 comments, and the caller uses it to pick the second route and to say so
 * on screen.
 */
export interface JumpTarget {
  page: number;
  /** False when the cap, not the thread, decided where we stop. */
  reachable: boolean;
}

export function jumpTarget(lastPage: number, perPage = COMMENTS_PER_PAGE): JumpTarget {
  const max = maxReachablePage(perPage);
  // A thread with no comments still reports `lastPage: 1`; anything absurd from
  // a malformed response floors to the first page rather than throwing.
  const wanted = Number.isFinite(lastPage) && lastPage >= 1 ? Math.floor(lastPage) : 1;
  return wanted <= max
    ? { page: wanted, reachable: true }
    : { page: max, reachable: false };
}

/**
 * Whether jumping is worth offering at all.
 *
 * On a thread short enough to be one page, the newest reply is already on
 * screen — a button that scrolls to what you can see is noise.
 */
export function canJump(lastPage: number | null | undefined): boolean {
  return typeof lastPage === "number" && lastPage > 1;
}

/** Which comment view is on screen — see `refreshPlan`. */
export type ThreadView = "paged" | "jump";

/**
 * Which view to re-read after posting.
 *
 * Exactly one, never both. `Thread.tsx` used to fire `comments.refetch()` *and*
 * `newest.refetch()` unconditionally, and `refetch()` **ignores `enabled`** —
 * verified against `@tanstack/query-core` 5.101.4, where the only `enabled`
 * read on that path is `isActive()`, used by filters. So from the ordinary
 * paged view the jump query fired with `target === null`, took the numeric
 * branch and sent `page: null` (the `page = 1` default only fires for
 * `undefined`), spending a request out of the ~30/min budget to fetch nothing
 * anyone was looking at. It also flipped `newest.isFetching`, which disabled
 * the jump controls and printed "Finding the newest…" while nothing jumped.
 */
export function refreshPlan(target: "newest" | number | null): ThreadView {
  return target === null ? "paged" : "jump";
}

/**
 * Where a newly posted top-level comment will be.
 *
 * Comments are oldest-first and that order cannot be changed — `sort` on
 * `threadComments` is inert, measured — so a new one is on the **last** page,
 * never the first. Re-reading page 1 after posting (which is what shipped) is
 * correct only on a single-page thread, which is why it survived development.
 *
 * `null` when the thread's end is past the 5,000-entry cap: the comment exists
 * but no page request can reach it, and saying so is better than landing
 * somewhere else and implying it is there.
 */
export function pageAfterPosting(
  lastPage: number,
  perPage = COMMENTS_PER_PAGE,
): number | null {
  const target = jumpTarget(lastPage, perPage);
  return target.reachable ? target.page : null;
}
