import { displayTitle } from "@/api/types";

/**
 * AniList's notification feed, flattened for the bell.
 *
 * The API returns a nineteen-member union where every member carries a
 * different set of nullable objects. The bell wants rows: a name to lead
 * with, a verb to explain, a place to go. This module is the boundary where
 * the union becomes that — pure, so the mapping is testable without a bell.
 *
 * `ActivityMessageNotification` is deliberately not here. It is private mail
 * between two users, and it is excluded the same three ways `MessageActivity`
 * is on the feeds: absent from the query's `type_in`, given no inline
 * fragment, and normalised to null by the fall-through below — with a test
 * that says so.
 */

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

/** The loose shape a union member arrives in. Everything nullable, because
    on an untyped boundary "unexpected shape" is a normal outcome. */
export interface RawSiteNotification {
  __typename?: string;
  id?: number | null;
  createdAt?: number | null;
  activityId?: number | null;
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
  /** Grouping identity — `notifGroups` collapses runs on these. The route
      string cannot serve: reverse-parsing it re-derives what the API already
      said, and the ids were thrown away here for exactly as long as nothing
      needed them. */
  userId: number | null;
  mediaId: number | null;
  activityId: number | null;
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

  // The lead line, in the order the kinds care about: a thread row leads with
  // the thread, a media row with the title, a person row with the person.
  const title =
    threadTitle ??
    mediaTitle ??
    userName ??
    personName ??
    raw.deletedMediaTitle ??
    raw.submittedTitle ??
    "—";

  // Where a click goes. The activity itself first: only the five Activity*
  // kinds carry `activityId`, and for them the activity is the news — the
  // actor's profile is the *name's* target, which the bell renders as its own
  // link. Threads before users for the same reason: thread rows carry both,
  // and the thread is the news. Null is honest for a deletion — there is
  // nowhere left.
  const target =
    raw.activityId != null
      ? `/activity/${raw.activityId}`
      : raw.thread?.id != null
        ? `/thread/${raw.thread.id}`
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
    activityId: raw.activityId ?? null,
  };
}
