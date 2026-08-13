/**
 * AniList's activity feed, normalised into something renderable.
 *
 * `Page.activities` returns an `ActivityUnion` of three members —
 * `ListActivity`, `TextActivity` and `MessageActivity` — and the third is
 * **private mail between two users**. It is excluded three separate ways: it is
 * absent from the query's `type_in`, it is given no inline fragment, and
 * `normalizeActivity` returns null for it with a test that says so. One
 * argument someone widens later is all it would take, so none of the three is
 * redundant.
 */

import type { SocialMedia, SocialUser } from "@/api/social";

/**
 * The verbs AniList composes, as a closed set of keys.
 *
 * The catch this exists for: **AniList ships the sentence, in English only.**
 * `ListActivity.status` is a pre-composed string like `"watched episode"`, so a
 * German user would otherwise read a German feed with English verbs in it.
 * Mapping to a key first is what makes translation possible at all.
 *
 * Measured across 150 live activities, by frequency: "watched episode" (57),
 * "read chapter" (39), "completed" (14), "plans to watch" (10),
 * "plans to read" (3), "dropped" (1). The rest are AniList's other list
 * statuses, included because they exist even though the sample missed them.
 *
 * A *closed union*, not a template — `i18nKeys.test.ts` only sees literal
 * `t("…")` calls, so a key built by interpolation is invisible to the suite.
 * The component maps this through a literal switch, exactly as `receiptText`
 * in `useListMutations` already does.
 */
export type ActivityVerb =
  | "watchedEpisode"
  | "rewatchedEpisode"
  | "readChapter"
  | "rereadChapter"
  | "completed"
  | "plansToWatch"
  | "plansToRead"
  | "dropped"
  | "paused";

const VERBS: Record<string, ActivityVerb> = {
  "watched episode": "watchedEpisode",
  "rewatched episode": "rewatchedEpisode",
  "read chapter": "readChapter",
  "reread chapter": "rereadChapter",
  "re-read chapter": "rereadChapter",
  completed: "completed",
  "plans to watch": "plansToWatch",
  "plans to read": "plansToRead",
  dropped: "dropped",
  paused: "paused",
};

/**
 * The key for a status string, or null when AniList sends something new.
 *
 * Null means "fall back to AniList's own words" rather than "show nothing" — an
 * unrecognised verb should read slightly untranslated, not leave a row with a
 * blank where the sentence goes.
 */
export function listActivityVerb(status: string | null | undefined): ActivityVerb | null {
  if (!status) return null;
  return VERBS[status.trim().toLowerCase()] ?? null;
}

/** `"162 - 170"` and `"12"` are the only two shapes AniList sends. */
export interface ProgressRange {
  from: number;
  to?: number;
}

export function parseProgress(progress: string | null | undefined): ProgressRange | null {
  if (!progress) return null;
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(progress);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? undefined : Number(m[2]);
  if (!Number.isFinite(from)) return null;
  // A reversed or equal range is not a range.
  return to !== undefined && to > from ? { from, to } : { from };
}

/**
 * `"5"` or `"162–170"` — an en dash, because AniList's `"162 - 170"` is a batch
 * of chapters read in one sitting, not "162 of a 170 total". The German
 * templates were deliberately kept free of "von 170" for the same reason.
 */
export function formatProgress(p: ProgressRange): string {
  return p.to !== undefined ? `${p.from}–${p.to}` : String(p.from);
}

/** The verbs whose sentence template carries a `{{n}}` progress slot. An
 *  activity with one of these but no parseable progress falls back to
 *  AniList's own words rather than rendering a hole where the number goes. */
export const PROGRESS_VERBS: ReadonlySet<ActivityVerb> = new Set([
  "watchedEpisode",
  "rewatchedEpisode",
  "readChapter",
  "rereadChapter",
]);

/**
 * Splits a sentence template at the `%t%` token, where the media title link is
 * rendered. Each language owns its whole sentence — German puts the participle
 * *after* the title ("hat Kapitel 162–170 von … gelesen"), which no fixed
 * verb-then-title order can express — and the component drops a React element
 * into the gap, so the title can stay a link without `Trans` or interpolation.
 *
 * A template missing the token degrades to `{before: s, after: ""}` — the old
 * verb-first order — instead of eating the title.
 */
export function splitSentence(s: string): { before: string; after: string } {
  const i = s.indexOf("%t%");
  if (i === -1) return { before: s, after: "" };
  return { before: s.slice(0, i), after: s.slice(i + 3) };
}

interface FeedBase {
  id: number;
  createdAt: number;
  user: SocialUser;
  likeCount: number;
  isLiked: boolean;
  replyCount: number;
  siteUrl: string;
}

export type FeedItem =
  | (FeedBase & {
      kind: "list";
      media: SocialMedia | null;
      verb: ActivityVerb | null;
      /** AniList's own words, for when `verb` is null. */
      rawStatus: string;
      progress: ProgressRange | null;
    })
  | (FeedBase & { kind: "text"; text: string });

/** The raw union member, loosely typed — this is the boundary that tightens it. */
export interface RawActivity {
  __typename?: string;
  id?: number;
  createdAt?: number;
  likeCount?: number | null;
  isLiked?: boolean | null;
  replyCount?: number | null;
  siteUrl?: string | null;
  user?: SocialUser | null;
  status?: string | null;
  progress?: string | null;
  media?: SocialMedia | null;
  text?: string | null;
}

/**
 * One activity, or null when it is not something to render.
 *
 * Null covers three cases, all of which do occur: a `MessageActivity` (private
 * mail), an activity whose author is missing, and a member type this build does
 * not know. Returning null rather than throwing means one unexpected row cannot
 * take a whole feed page down with it.
 */
export function normalizeActivity(raw: RawActivity | null | undefined): FeedItem | null {
  if (!raw || typeof raw.id !== "number" || !raw.user) return null;

  const base: FeedBase = {
    id: raw.id,
    createdAt: raw.createdAt ?? 0,
    user: raw.user,
    likeCount: raw.likeCount ?? 0,
    isLiked: raw.isLiked === true,
    replyCount: raw.replyCount ?? 0,
    siteUrl: raw.siteUrl ?? "",
  };

  if (raw.__typename === "ListActivity") {
    return {
      ...base,
      kind: "list",
      // A deleted title still leaves its activity behind, so the media is
      // genuinely optional rather than defensively so.
      media: raw.media ?? null,
      verb: listActivityVerb(raw.status),
      rawStatus: raw.status?.trim() ?? "",
      progress: parseProgress(raw.progress),
    };
  }

  if (raw.__typename === "TextActivity") {
    const text = raw.text?.trim();
    if (!text) return null;
    return { ...base, kind: "text", text };
  }

  // `MessageActivity` lands here, and so would anything AniList adds later.
  return null;
}

/**
 * The item after a like is toggled, for the optimistic patch.
 *
 * Clamped at zero: AniList's count and the local guess can disagree after a
 * race, and a feed row reading "-1 likes" is worse than one that is briefly one
 * behind.
 */
export function toggleLike<T extends { likeCount: number; isLiked: boolean }>(item: T): T {
  const isLiked = !item.isLiked;
  return {
    ...item,
    isLiked,
    likeCount: Math.max(0, item.likeCount + (isLiked ? 1 : -1)),
  };
}
