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
