import { displayTitle } from "@/api/types";

/** AniList's notification union flattened for the bell; ActivityMessageNotification is private mail and stays excluded. */

export type SiteNotifKind =
  | "AIRING"
  | "FOLLOWING"
  | "ACTIVITY_MENTION"
  | "ACTIVITY_REPLY"
  | "ACTIVITY_REPLY_SUBSCRIBED"
  | "ACTIVITY_LIKE"
  | "ACTIVITY_REPLY_LIKE"
  | "THREAD_COMMENT_MENTION"
  | "THREAD_COMMENT_REPLY"
  | "THREAD_SUBSCRIBED"
  | "THREAD_COMMENT_LIKE"
  | "THREAD_LIKE"
  | "RELATED_MEDIA_ADDITION"
  | "MEDIA_DATA_CHANGE"
  | "MEDIA_MERGE"
  | "MEDIA_DELETION"
  | "MEDIA_SUBMISSION_UPDATE"
  | "STAFF_SUBMISSION_UPDATE"
  | "CHARACTER_SUBMISSION_UPDATE";

/** `__typename` → kind. Being a map, an unlisted typename simply misses. */
const KIND_BY_TYPENAME: Record<string, SiteNotifKind> = {
  AiringNotification: "AIRING",
  FollowingNotification: "FOLLOWING",
  ActivityMentionNotification: "ACTIVITY_MENTION",
  ActivityReplyNotification: "ACTIVITY_REPLY",
  ActivityReplySubscribedNotification: "ACTIVITY_REPLY_SUBSCRIBED",
  ActivityLikeNotification: "ACTIVITY_LIKE",
  ActivityReplyLikeNotification: "ACTIVITY_REPLY_LIKE",
  ThreadCommentMentionNotification: "THREAD_COMMENT_MENTION",
  ThreadCommentReplyNotification: "THREAD_COMMENT_REPLY",
  ThreadCommentSubscribedNotification: "THREAD_SUBSCRIBED",
  ThreadCommentLikeNotification: "THREAD_COMMENT_LIKE",
  ThreadLikeNotification: "THREAD_LIKE",
  RelatedMediaAdditionNotification: "RELATED_MEDIA_ADDITION",
  MediaDataChangeNotification: "MEDIA_DATA_CHANGE",
  MediaMergeNotification: "MEDIA_MERGE",
  MediaDeletionNotification: "MEDIA_DELETION",
  MediaSubmissionUpdateNotification: "MEDIA_SUBMISSION_UPDATE",
  StaffSubmissionUpdateNotification: "STAFF_SUBMISSION_UPDATE",
  CharacterSubmissionUpdateNotification: "CHARACTER_SUBMISSION_UPDATE",
};

/** The loose shape a union member arrives in, everything nullable, since an unexpected shape is a normal outcome here. */
export interface RawSiteNotification {
  __typename?: string;
  id?: number | null;
  createdAt?: number | null;
  activityId?: number | null;
  commentId?: number | null;
  episode?: number | null;
  reason?: string | null;
  status?: string | null;
  deletedMediaTitle?: string | null;
  deletedMediaTitles?: (string | null)[] | string | null;
  submittedTitle?: string | null;
  user?: { id?: number | null; name?: string | null } | null;
  media?: {
    id?: number | null;
    title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
    /** Keep these in the query; without them the bell is the one surface that can still name a hidden title. */
    isAdult?: boolean | null;
    genres?: string[] | null;
  } | null;
  thread?: { id?: number | null; title?: string | null } | null;
  staff?: { id?: number | null; name?: { full?: string | null } | null } | null;
  character?: { id?: number | null; name?: { full?: string | null } | null } | null;
}

export interface SiteNotifRow {
  id: number;
  kind: SiteNotifKind;
  /** Unix seconds, as AniList sends it. */
  createdAt: number;
  /** The row's lead line: a user, a title, a thread — whoever the news is about. */
  title: string;
  /** The actor, for verbs where the lead line is something else (thread rows). */
  actorName: string | null;
  episode: number | null;
  /** Free text worth showing as data: a deletion reason, a merge's old titles. */
  detail: string | null;
  /** Route to open on click, or null when the subject no longer exists. */
  target: string | null;
  /** Grouping identity for `notifGroups`; keep the ids, since reverse-parsing the route re-derives what the API said. */
  userId: number | null;
  mediaId: number | null;
  activityId: number | null;
  /** The subject's content-filter fields, carried for the bell's `isBlocked` rather than decided here. */
  media: { isAdult?: boolean | null; genres?: string[] | null } | null;
}

/** One notification, or null for anything the bell does not render. */
export function normalizeSiteNotification(raw: RawSiteNotification | null): SiteNotifRow | null {
  const kind = raw?.__typename ? KIND_BY_TYPENAME[raw.__typename] : undefined;
  if (!raw || kind === undefined || raw.id == null) return null;

  const userName = raw.user?.name ?? null;
  const mediaTitle = raw.media?.title
    ? displayTitle({
        english: raw.media.title.english ?? null,
        romaji: raw.media.title.romaji ?? null,
        native: raw.media.title.native ?? null,
      })
    : null;
  const threadTitle = raw.thread?.title ?? null;
  const personName = raw.staff?.name?.full ?? raw.character?.name?.full ?? null;
  const merged = Array.isArray(raw.deletedMediaTitles)
    ? raw.deletedMediaTitles.filter((t): t is string => typeof t === "string" && t.length > 0)
    : typeof raw.deletedMediaTitles === "string"
      ? [raw.deletedMediaTitles]
      : [];

  // The lead line: a thread row leads with the thread, a media row with the title, a person row with the person.
  const title =
    threadTitle ??
    mediaTitle ??
    userName ??
    personName ??
    raw.deletedMediaTitle ??
    raw.submittedTitle ??
    "—";

  // Where a click goes: the activity or thread before the actor, whose name is its own link; null for a deletion.
  const target =
    raw.activityId != null
      ? `/activity/${raw.activityId}`
      : raw.thread?.id != null
        ? raw.commentId != null
          ? `/thread/${raw.thread.id}?comment=${raw.commentId}`
          : `/thread/${raw.thread.id}`
        : raw.media?.id != null
          ? `/media/${raw.media.id}`
          : raw.staff?.id != null
            ? `/staff/${raw.staff.id}`
            : raw.character?.id != null
              ? `/character/${raw.character.id}`
              : userName
                ? `/user/${encodeURIComponent(userName)}`
                : null;

  return {
    id: raw.id,
    kind,
    createdAt: raw.createdAt ?? 0,
    title,
    actorName: userName,
    episode: raw.episode ?? null,
    detail: merged.length > 0 ? merged.join(", ") : (raw.reason ?? raw.status ?? null),
    target,
    userId: raw.user?.id ?? null,
    mediaId: raw.media?.id ?? null,
    media: raw.media
      ? { isAdult: raw.media.isAdult ?? null, genres: raw.media.genres ?? null }
      : null,
    activityId: raw.activityId ?? null,
  };
}
