/**
 * What counts as a postable message.
 *
 * Shared by the activity composer, the reply box and the thread comment box, so
 * the three cannot disagree about whether a wall of spaces is a post.
 *
 * The reason it returns a *key* rather than a sentence: `i18nKeys.test.ts` only
 * sees literal `t("…")` calls, so a pure function that returned prose would put
 * its strings outside the suite's reach. The component maps the key through a
 * literal switch, the same shape `receiptText` uses in `useListMutations`.
 */
export type PostRejection = "empty" | "tooLong";

export interface PostValidation {
  ok: boolean;
  reason?: PostRejection;
  /** What to actually send: trimmed, with runs of blank lines collapsed. */
  text: string;
}

/**
 * Karasu's own bound: AniList's schema documents no maximum for activity text.
 *
 * Generous rather than tight — a status update is not a tweet and people do
 * write paragraphs — but still a number, because a field with no limit is one
 * that eventually receives a pasted novel and fails at the API instead of in
 * the box where it could be explained.
 */
export const POST_MAX = 4000;

export function validatePost(raw: string): PostValidation {
  // Three or more newlines become two: AniList renders single newlines as
  // breaks, so a stray run of blank lines is a wall of nothing in the feed.
  const text = raw.trim().replace(/\n{3,}/g, "\n\n");
  if (!text) return { ok: false, reason: "empty", text };
  // Counted on the trimmed text, so trailing whitespace cannot push a valid
  // post over the edge.
  if (text.length > POST_MAX) return { ok: false, reason: "tooLong", text };
  return { ok: true, text };
}

/**
 * Characters left, for a counter that only appears when it matters.
 *
 * Negative once over, so the caller can style it without repeating the
 * comparison.
 */
export function charsLeft(raw: string): number {
  return POST_MAX - raw.trim().length;
}

/**
 * What counts as a postable thread — a title, a body, and at least one
 * category.
 *
 * AniList's own composer enforces the category; a threadless category is fine
 * but a categoryless thread lands nowhere anyone browses. The title bound is
 * Karasu's, like `POST_MAX`: AniList documents none, and the forum renders
 * titles on one line.
 */
export type ThreadRejection = "titleEmpty" | "titleTooLong" | PostRejection | "noCategory";

export const TITLE_MAX = 120;

export interface ThreadValidation {
  ok: boolean;
  reason?: ThreadRejection;
  title: string;
  body: string;
}

export function validateThread(
  rawTitle: string,
  rawBody: string,
  categories: number[],
): ThreadValidation {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  const bodyCheck = validatePost(rawBody);
  const out = { title, body: bodyCheck.text };
  if (!title) return { ok: false, reason: "titleEmpty", ...out };
  if (title.length > TITLE_MAX) return { ok: false, reason: "titleTooLong", ...out };
  if (!bodyCheck.ok) return { ok: false, reason: bodyCheck.reason, ...out };
  if (categories.length === 0) return { ok: false, reason: "noCategory", ...out };
  return { ok: true, ...out };
}

/**
 * What counts as a publishable review. Unlike the two above, every bound
 * here is **AniList's own**, enforced server-side — validating locally just
 * moves the rejection from a failed request into the box where it can be
 * explained while typing.
 */
export type ReviewRejection =
  | "summaryTooShort"
  | "summaryTooLong"
  | "bodyTooShort"
  | "scoreOut";

export const REVIEW_SUMMARY_MIN = 20;
export const REVIEW_SUMMARY_MAX = 120;
export const REVIEW_BODY_MIN = 2200;

export interface ReviewValidation {
  ok: boolean;
  reason?: ReviewRejection;
  summary: string;
  body: string;
}

export function validateReview(
  rawSummary: string,
  rawBody: string,
  score: number,
): ReviewValidation {
  const summary = rawSummary.trim().replace(/\s+/g, " ");
  const body = rawBody.trim().replace(/\n{3,}/g, "\n\n");
  const out = { summary, body };
  if (summary.length < REVIEW_SUMMARY_MIN)
    return { ok: false, reason: "summaryTooShort", ...out };
  if (summary.length > REVIEW_SUMMARY_MAX)
    return { ok: false, reason: "summaryTooLong", ...out };
  if (body.length < REVIEW_BODY_MIN) return { ok: false, reason: "bodyTooShort", ...out };
  if (!Number.isInteger(score) || score < 0 || score > 100)
    return { ok: false, reason: "scoreOut", ...out };
  return { ok: true, ...out };
}
