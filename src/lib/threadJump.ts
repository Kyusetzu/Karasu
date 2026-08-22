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
 *    HTTP 400 *"Page depth exceeds maximum allowed for API requests"*. The
 *    boundary is exact and was checked from both sides: at perPage 15, page 333
 *    (4,995) answers 200 and page 334 (5,010) answers 400; at perPage 10, page
 *    500 works and 501 fails.
 *
 * So a thread's `lastPage` is not always a page you can ask for, and on the
 * threads where it matters most it never is. Thread 1 ("New User Intro Thread")
 * holds 7,045 root comments — `lastPage: 705` at perPage 10 — and the deepest
 * reachable page ends in **2021** while the thread was replied to today. Thread
 * 15346 holds 70,348, so **93% of it is unreachable** by paging.
 *
 * **The way out is `Thread.replyCommentId` and the root `ThreadComment(id:)`
 * field**, which is a LIST rather than a `Page` and is therefore not capped —
 * see `THREAD_COMMENT_TREE_QUERY`. It resolves the newest comment to the root
 * of its tree and returns that whole conversation in one request, at any depth.
 *
 * ### What the website does, and why Karasu does not
 *
 * anilist.co reaches page 470 of thread 1 because its Web Worker posts to
 * **`anilist.co/graphql`** — a different endpoint from the public
 * `graphql.anilist.co` — carrying an `x-csrf-token` bound to a site session.
 * That endpoint does not enforce the cap. Without the header it answers **403
 * `Forbidden. (Use graphql subdomain)`**, which is AniList telling third-party
 * clients which endpoint is theirs. Reaching it would mean scraping a CSRF
 * token and impersonating the website past an explicit access control, so
 * **this is a deliberate refusal, not a gap to close later.** An account does
 * not lift the cap either: the 470 measurement was taken logged *out*, and the
 * site needs the separate endpoint for its own signed-in users too.
 *
 * ### Measured and rejected — do not retry these
 *
 * - **`ThreadComment(threadId:)` unbounded** — HTTP 500.
 * - **Walking back through comment ids** with alias-batched `ThreadComment(id:)`.
 *   Batching works (20 roots for one request), but one missing id answers
 *   `"Not Found."` and **nulls every sibling in the request** — 40 of 40 came
 *   back null on the first real attempt. Deleted comments are common, so this
 *   fails most of the time it is tried.
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

/**
 * How the newest reply will be fetched.
 *
 * - `"page"` — the thread's own last page, because AniList will serve it. Ten
 *   root comments of surrounding conversation, and it is nearly every thread.
 * - `"tree"` — past the cap, but `replyCommentId` is known, so the newest
 *   comment and its whole conversation come back uncapped in one request.
 * - `"capped"` — past the cap with no `replyCommentId` to resolve (a thread
 *   with no replies yet, or one whose newest comment has been deleted). Lands
 *   as deep as allowed, and the screen has to say that is not the end.
 *
 * Pure, so the tiering is testable without touching the network — which is the
 * half that was previously only checked by opening a big thread and looking.
 */
export type JumpRoute = "page" | "tree" | "capped";

export function jumpRoute(
  lastPage: number,
  replyCommentId: number | null | undefined,
  perPage = COMMENTS_PER_PAGE,
): JumpRoute {
  if (jumpTarget(lastPage, perPage).reachable) return "page";
  return typeof replyCommentId === "number" && replyCommentId > 0 ? "tree" : "capped";
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

/**
 * What the "go to page" box means, or nothing at all.
 *
 * `Number("")` is **0**, and 0 is finite — so the guard this replaces
 * (`if (!Number.isFinite(n)) return`) let an empty box through, clamped it up
 * to 1, and jumped to the first page. Pressing Go with nothing typed silently
 * threw away where the reader was, which is the opposite of doing nothing.
 *
 * Returns `null` for anything that is not a page: empty, blank, `"abc"`,
 * `"NaN"`, `Infinity`. Otherwise clamps into `[1, maxPage]` — `maxPage` being
 * the deepest page AniList will serve, not the thread's `lastPage`, which on a
 * big thread is a number that cannot be asked for.
 */
export function parsePageInput(raw: string, maxPage: number): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const ceiling = Number.isFinite(maxPage) && maxPage >= 1 ? Math.floor(maxPage) : 1;
  return Math.min(Math.max(Math.trunc(n), 1), ceiling);
}
