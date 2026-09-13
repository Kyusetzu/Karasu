/** Reaching the newest reply around AniList's page-depth cap; never use anilist.co/graphql with a scraped CSRF token. */

/** Entries, not pages: the cap is on `page × perPage`. */
export const PAGE_DEPTH_CAP = 5000;

/** The page size THREAD_COMMENTS_QUERY in api/social.ts asks for. */
export const COMMENTS_PER_PAGE = 10;

/** The deepest page AniList will serve at this page size. */
export function maxReachablePage(perPage: number): number {
  if (!Number.isFinite(perPage) || perPage < 1) return 1;
  return Math.max(1, Math.floor(PAGE_DEPTH_CAP / perPage));
}

/** Where to land and whether that is really the end; `reachable: false` is an answer for a capped thread, not a failure. */
export interface JumpTarget {
  page: number;
  /** False when the cap, not the thread, decided where we stop. */
  reachable: boolean;
}

export function jumpTarget(lastPage: number, perPage = COMMENTS_PER_PAGE): JumpTarget {
  const max = maxReachablePage(perPage);
  // An empty thread still reports `lastPage: 1`; anything absurd from a malformed response floors to page one.
  const wanted = Number.isFinite(lastPage) && lastPage >= 1 ? Math.floor(lastPage) : 1;
  return wanted <= max
    ? { page: wanted, reachable: true }
    : { page: max, reachable: false };
}

/** Whether jumping is worth offering; on a one-page thread the newest reply is already on screen. */
export function canJump(lastPage: number | null | undefined): boolean {
  return typeof lastPage === "number" && lastPage > 1;
}

/** How the newest reply is fetched; "tree" is ThreadComment(id:), an uncapped list resolving to the root of its tree. */
export type JumpRoute = "page" | "tree" | "capped";

export function jumpRoute(
  lastPage: number,
  replyCommentId: number | null | undefined,
  perPage = COMMENTS_PER_PAGE,
): JumpRoute {
  if (jumpTarget(lastPage, perPage).reachable) return "page";
  return typeof replyCommentId === "number" && replyCommentId > 0 ? "tree" : "capped";
}

/** What the thread page looks at: the paged read (`null`), the newest jump, a page number, or one comment's tree. */
export type ThreadTarget = "newest" | number | { comment: number } | null;

export function isCommentTarget(t: ThreadTarget): t is { comment: number } {
  return typeof t === "object" && t !== null;
}

/** The `?comment=` param as an id of at least 1, or null; digits only, because `Number("")` is 0 and 0 is finite. */
export function parseCommentParam(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 ? n : null;
}

/** Which comment view is on screen — see `refreshPlan`. */
export type ThreadView = "paged" | "jump";

/** Which view to re-read after posting, never both; `refetch()` ignores `enabled`, so an idle query spends a request. */
export function refreshPlan(target: ThreadTarget): ThreadView {
  return target === null ? "paged" : "jump";
}

/** The page a new top-level comment lands on: the last, since `sort` is inert; null when the cap puts it out of reach. */
export function pageAfterPosting(
  lastPage: number,
  perPage = COMMENTS_PER_PAGE,
): number | null {
  const target = jumpTarget(lastPage, perPage);
  return target.reachable ? target.page : null;
}

/** The "go to page" box clamped into `[1, maxPage]`, or null; keep the empty check, since `Number("")` is a finite 0. */
export function parsePageInput(raw: string, maxPage: number): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const ceiling = Number.isFinite(maxPage) && maxPage >= 1 ? Math.floor(maxPage) : 1;
  return Math.min(Math.max(Math.trunc(n), 1), ceiling);
}
