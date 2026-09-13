/** AniList's activity feed normalised for rendering; MessageActivity is private mail and is excluded three separate ways. */

import type { SocialMedia, SocialUser } from "@/api/social";

/** AniList's verbs as a closed set of keys, since it ships the sentence in English only; never a template key. */
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

/** The key for a status string, or null so the row falls back to AniList's own words rather than a blank. */
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

/** A single number or an en-dash range; the range is a batch read in one sitting, not "x of a total". */
export function formatProgress(p: ProgressRange): string {
  return p.to !== undefined ? `${p.from}–${p.to}` : String(p.from);
}

/** The verbs whose template carries a `{{n}}` slot; without parseable progress they fall back to AniList's words. */
export const PROGRESS_VERBS: ReadonlySet<ActivityVerb> = new Set([
  "watchedEpisode",
  "rewatchedEpisode",
  "readChapter",
  "rereadChapter",
]);

/** Splits a sentence template at the `%t%` title slot, so each language owns its word order and the title stays a link. */
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
  /** Pinned to its author's profile — only ever true on a profile feed. */
  isPinned: boolean;
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
  isPinned?: boolean | null;
  replyCount?: number | null;
  siteUrl?: string | null;
  user?: SocialUser | null;
  status?: string | null;
  progress?: string | null;
  media?: SocialMedia | null;
  text?: string | null;
}

/** One activity, or null for private mail, a missing author or an unknown member, so one row cannot sink the page. */
export function normalizeActivity(raw: RawActivity | null | undefined): FeedItem | null {
  if (!raw || typeof raw.id !== "number" || !raw.user) return null;

  const base: FeedBase = {
    id: raw.id,
    createdAt: raw.createdAt ?? 0,
    user: raw.user,
    likeCount: raw.likeCount ?? 0,
    isLiked: raw.isLiked === true,
    isPinned: raw.isPinned === true,
    replyCount: raw.replyCount ?? 0,
    siteUrl: raw.siteUrl ?? "",
  };

  if (raw.__typename === "ListActivity") {
    return {
      ...base,
      kind: "list",
      // A deleted title still leaves its activity behind, so the media is genuinely optional.
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

/** The item after a like is toggled, for the optimistic patch; clamped at zero so a race never reads "-1 likes". */
export function toggleLike<T extends { likeCount: number; isLiked: boolean }>(item: T): T {
  const isLiked = !item.isLiked;
  return {
    ...item,
    isLiked,
    likeCount: Math.max(0, item.likeCount + (isLiked ? 1 : -1)),
  };
}
