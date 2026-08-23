import { gql } from "./anilist";
import type { Media, MediaType } from "./types";
import {
  normalizeSiteNotification,
  type RawSiteNotification,
  type SiteNotifRow,
} from "@/lib/siteNotifications";

/**
 * AniList's social graph: profiles, followers, following, user search, and the
 * mutations that change them.
 *
 * A file of its own rather than more of `queries.ts`, which is already 555
 * lines of media queries plus the statistics block. `api/` is split by subject
 * already — `anilist`, `queries`, `types`, `franchise`, `library` — so this
 * follows the existing shape instead of inventing one.
 *
 * Everything here goes through `gql`, which is the `anilist_query` command:
 * the token is attached in Rust and never reaches this side. That is why the
 * whole social feature needs no new Tauri command.
 *
 * Every query and mutation below was checked against the live schema before it
 * was wired — mutations by introspection only, since running one would edit a
 * real account.
 */

// --- Shared shapes --------------------------------------------------------

export interface PageInfo {
  total: number;
  currentPage: number;
  lastPage?: number;
  hasNextPage: boolean;
}

const PAGE_INFO = `pageInfo { total currentPage lastPage hasNextPage }`;

/**
 * Deliberately smaller than `MEDIA_FIELDS`.
 *
 * A favourite or a feed row draws a small cover and a title, so it asks for a
 * small cover and a title. No `mediaListEntry`, no `nextAiringEpisode`, no
 * `synonyms`, no episode counts — `queries.ts` documents the opposite direction
 * for `DETAIL_QUERY`, and this is that note's mirror image.
 *
 * `isAdult` and `genres` are here for exactly one reason: `isBlocked` from
 * `lib/contentFilter` needs them, and these lists are other people's content,
 * which the local filter still has to apply. Nothing renders them directly.
 */
const SOCIAL_MEDIA = `
  id
  type
  title { romaji english native }
  coverImage { large }
  format
  isAdult
  genres
`;

/** Media as it comes back from a social query — the `SOCIAL_MEDIA` subset. */
export type SocialMedia = Pick<
  Media,
  "id" | "title" | "coverImage" | "format" | "genres"
> & { type?: MediaType; isAdult?: boolean | null };

/** A user as every *list* of users returns them. No `about`: see `FOLLOWERS_QUERY`. */
export interface SocialUser {
  id: number;
  name: string;
  avatar: { medium: string | null } | null;
  isFollowing: boolean | null;
  isFollower: boolean | null;
}

const SOCIAL_USER = `id name avatar { medium } isFollowing isFollower`;

// --- Profile --------------------------------------------------------------

export interface AniListUserOptions {
  titleLanguage: string | null;
  displayAdultContent: boolean | null;
  airingNotifications: boolean | null;
  profileColor: string | null;
  timezone: string | null;
  activityMergeTime: number | null;
  staffNameLanguage: string | null;
  restrictMessagesToFollowing: boolean | null;
  /** Which list statuses do NOT post an activity — `disabled: true` mutes one. */
  disabledListActivity?: { disabled: boolean | null; type: string | null }[] | null;
}

export interface AniListMediaListOptions {
  scoreFormat: string | null;
  rowOrder: string | null;
  animeList: ListTypeOptions | null;
  mangaList: ListTypeOptions | null;
}

export interface ListTypeOptions {
  customLists: string[] | null;
  splitCompletedSectionByFormat: boolean | null;
}

export interface UserProfileStats {
  anime: {
    count: number;
    meanScore: number;
    minutesWatched: number;
    episodesWatched: number;
  } | null;
  manga: {
    count: number;
    meanScore: number;
    chaptersRead: number;
    volumesRead: number;
  } | null;
}

export interface UserProfile {
  id: number;
  name: string;
  siteUrl: string;
  about: string | null;
  avatar: { large: string | null } | null;
  bannerImage: string | null;
  donatorTier: number | null;
  donatorBadge: string | null;
  /** Null rather than `[]` for an ordinary user — AniList really returns null. */
  moderatorRoles: string[] | null;
  createdAt: number | null;
  updatedAt: number | null;
  isFollowing: boolean | null;
  isFollower: boolean | null;
  isBlocked: boolean | null;
  previousNames: { name: string | null; updatedAt: number | null }[];
  options: AniListUserOptions | null;
  mediaListOptions: AniListMediaListOptions | null;
  statistics: UserProfileStats | null;
  favourites: {
    anime: { nodes: SocialMedia[] } | null;
    manga: { nodes: SocialMedia[] } | null;
    characters: { nodes: FavPerson[] } | null;
    staff: { nodes: FavPerson[] } | null;
    studios: { nodes: FavStudio[] } | null;
  } | null;
}

/** A favourited character or staff member — a disc and a name. */
export interface FavPerson {
  id: number;
  name: { full: string | null };
  image: { medium: string | null } | null;
}

export interface FavStudio {
  id: number;
  name: string | null;
}

/**
 * One user, by name or id.
 *
 * Wide because it is a single object — the "don't over-fetch" invariant in
 * CLAUDE.md is about pages of thirty to fifty, and `bannerImage` on one profile
 * is not the same decision as `bannerImage` on a list. Measured at ~7 kB.
 *
 * `options` and `mediaListOptions` are included so the AniList settings pane
 * can share this cache entry instead of spending its own request. They are
 * publicly readable for any user, which is AniList's choice, not ours — the
 * pane only ever *edits* the viewer's own.
 *
 * The ranked statistics categories are deliberately absent: those belong to
 * `USER_STATS_QUERY` in `queries.ts`, which the statistics screen already owns.
 */
export const USER_PROFILE_QUERY = `
query ($name: String, $id: Int) {
  User(name: $name, id: $id) {
    id
    name
    siteUrl
    about
    avatar { large }
    bannerImage
    donatorTier
    donatorBadge
    moderatorRoles
    createdAt
    updatedAt
    isFollowing
    isFollower
    isBlocked
    previousNames { name updatedAt }
    options {
      titleLanguage
      displayAdultContent
      airingNotifications
      profileColor
      timezone
      activityMergeTime
      staffNameLanguage
      restrictMessagesToFollowing
      disabledListActivity { disabled type }
    }
    mediaListOptions {
      scoreFormat
      rowOrder
      animeList { customLists splitCompletedSectionByFormat }
      mangaList { customLists splitCompletedSectionByFormat }
    }
    statistics {
      anime { count meanScore minutesWatched episodesWatched }
      manga { count meanScore chaptersRead volumesRead }
    }
    favourites {
      anime(perPage: 12) { nodes { ${SOCIAL_MEDIA} } }
      manga(perPage: 12) { nodes { ${SOCIAL_MEDIA} } }
      characters(perPage: 12) { nodes { id name { full } image { medium } } }
      staff(perPage: 12) { nodes { id name { full } image { medium } } }
      studios(perPage: 12) { nodes { id name } }
    }
  }
}`;

export async function userProfile(
  key: { name: string } | { id: number },
): Promise<UserProfile> {
  const data = await gql<{ User: UserProfile | null }>(USER_PROFILE_QUERY, key);
  // AniList answers an unknown name with HTTP 404 and a `Not Found.` error, so
  // this rarely fires — but a null `User` with no error would otherwise become
  // a blank profile rather than the not-found state.
  if (!data.User) throw new Error("NOT_FOUND");
  return data.User;
}

/**
 * Both follower totals in one request.
 *
 * Two aliased `Page` roots, which AniList accepts (checked: 144 bytes for the
 * pair). Safe to alias precisely because `Page` cannot 404 — a missing root
 * nulls *every* sibling and returns 404, which is why `User` is never aliased
 * alongside anything else.
 *
 * It takes an id rather than a name, so a profile reached by name needs this as
 * a second request. That is the whole reason the overview costs two.
 */
export const FOLLOW_COUNTS_QUERY = `
query ($userId: Int!) {
  followers: Page(perPage: 1) { pageInfo { total } followers(userId: $userId) { id } }
  following: Page(perPage: 1) { pageInfo { total } following(userId: $userId) { id } }
}`;

export interface FollowCounts {
  followers: number;
  following: number;
}

export async function followCounts(userId: number): Promise<FollowCounts> {
  const data = await gql<{
    followers: { pageInfo: { total: number } };
    following: { pageInfo: { total: number } };
  }>(FOLLOW_COUNTS_QUERY, { userId });
  return {
    followers: data.followers?.pageInfo?.total ?? 0,
    following: data.following?.pageInfo?.total ?? 0,
  };
}

// --- Follower / following lists -------------------------------------------

/**
 * `sort: USERNAME` because paging needs a total order.
 *
 * A tie-heavy or unstable sort silently duplicates and drops rows across page
 * boundaries, and nobody diagnoses that as a sort problem. AniList's own
 * follower ordering is not reproducible through `UserSort` — whose members are
 * exactly ID, USERNAME, WATCHED_TIME, CHAPTERS_READ and SEARCH_MATCH, each with
 * a `_DESC` twin — so this picks the explicable one and accepts the difference.
 *
 * No `about`. A bio runs to several kilobytes and fifty of them would be a
 * ~500 kB payload for a row that shows a name and a button.
 */
export const FOLLOWERS_QUERY = `
query ($userId: Int!, $page: Int) {
  Page(page: $page, perPage: 50) {
    ${PAGE_INFO}
    followers(userId: $userId, sort: USERNAME) { ${SOCIAL_USER} }
  }
}`;

export const FOLLOWING_QUERY = `
query ($userId: Int!, $page: Int) {
  Page(page: $page, perPage: 50) {
    ${PAGE_INFO}
    following(userId: $userId, sort: USERNAME) { ${SOCIAL_USER} }
  }
}`;

export interface UserPage {
  pageInfo: PageInfo;
  users: SocialUser[];
}

export async function followers(userId: number, page = 1): Promise<UserPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; followers: SocialUser[] } }>(
    FOLLOWERS_QUERY,
    { userId, page },
  );
  return { pageInfo: data.Page.pageInfo, users: data.Page.followers ?? [] };
}

export async function following(userId: number, page = 1): Promise<UserPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; following: SocialUser[] } }>(
    FOLLOWING_QUERY,
    { userId, page },
  );
  return { pageInfo: data.Page.pageInfo, users: data.Page.following ?? [] };
}

// --- User search ----------------------------------------------------------

/**
 * Search users by name.
 *
 * Two facts about this endpoint, both measured, both load-bearing for the UI:
 *
 * 1. **A short query returns junk.** Two characters come back as the exact
 *    match followed by the same fixed set of unrelated accounts
 *    (`user10151`, `Gregorymr`, …) — `"ky"` yields `["ky", "user10151", …]`.
 *    Three characters behave properly. The caller enforces a three-character
 *    minimum for this reason, where media search is happy with two.
 * 2. **`pageInfo.total` is a capped sentinel, not a count.** Anything with many
 *    matches reports `total: 5000` and `lastPage: 1000` regardless of the real
 *    number; only a tiny result set is honest (`"Kyusetzu"` → 1). So the
 *    remaining-count label is suppressed for search — see `UserList`.
 *
 * `perPage: 25` rather than 50: a search is scanned, not paged through.
 */
export const USER_SEARCH_QUERY = `
query ($search: String!, $page: Int) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    users(search: $search, sort: SEARCH_MATCH) { ${SOCIAL_USER} }
  }
}`;

export async function searchUsers(search: string, page = 1): Promise<UserPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; users: SocialUser[] } }>(
    USER_SEARCH_QUERY,
    { search, page },
  );
  return { pageInfo: data.Page.pageInfo, users: data.Page.users ?? [] };
}

/** The shortest query this endpoint answers usefully. See `USER_SEARCH_QUERY`. */
export const USER_SEARCH_MIN = 3;

// --- Activities -----------------------------------------------------------

/**
 * One constant serves both a profile's activity tab and the following feed —
 * `userId` for the first, `isFollowing: true` for the second.
 *
 * `MESSAGE` is absent from `type_in` **and** `MessageActivity` gets no inline
 * fragment, so even a widened argument yields nothing renderable. Private mail
 * between two users is not something a tracker should surface, and
 * `normalizeActivity` refuses it a third time.
 *
 * `sort: ID_DESC` because paging needs a total order and ids are the only
 * strictly increasing thing here — `createdAt` ties constantly.
 *
 * No nested `replies { … }`: those load per-activity when a row is expanded,
 * one user-initiated request each, rather than multiplying every page by them.
 *
 * `pageInfo.total` is a capped sentinel here too, exactly as in user search —
 * measured at `total: 5000` with `lastPage: 500`. The feed therefore never
 * shows a remaining count.
 */
export const ACTIVITY_QUERY = `
query ($userId: Int, $isFollowing: Boolean, $page: Int, $sort: [ActivitySort]) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    activities(
      userId: $userId
      isFollowing: $isFollowing
      type_in: [ANIME_LIST, MANGA_LIST, TEXT]
      sort: $sort
    ) {
      __typename
      ... on ListActivity {
        id status progress createdAt likeCount isLiked isPinned replyCount siteUrl
        user { ${SOCIAL_USER} }
        media { ${SOCIAL_MEDIA} }
      }
      ... on TextActivity {
        id text createdAt likeCount isLiked isPinned replyCount siteUrl
        user { ${SOCIAL_USER} }
      }
    }
  }
}`;

export interface ActivityPage {
  pageInfo: PageInfo;
  /** Raw union members — `normalizeActivity` in `lib/activity` tightens these. */
  activities: unknown[];
}

export async function activities(
  vars: { userId: number } | { isFollowing: true },
  page = 1,
): Promise<ActivityPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; activities: unknown[] } }>(
    ACTIVITY_QUERY,
    {
      ...vars,
      page,
      // A pin floats on the profile it belongs to; a following feed is a
      // timeline and stays one. Both are still total orders, which paging needs.
      sort: "userId" in vars ? ["PINNED", "ID_DESC"] : ["ID_DESC"],
    },
  );
  return { pageInfo: data.Page.pageInfo, activities: data.Page.activities ?? [] };
}

// --- Mutations ------------------------------------------------------------

/**
 * Returns the fields the cache patch needs and nothing else, so a follow never
 * costs a refetch.
 */
export const TOGGLE_FOLLOW_MUTATION = `
mutation ($userId: Int!) {
  ToggleFollow(userId: $userId) { id name isFollowing isFollower }
}`;

/**
 * Likes, for anything AniList calls likeable.
 *
 * `LikeableType` has exactly four members — `THREAD`, `THREAD_COMMENT`,
 * `ACTIVITY`, `ACTIVITY_REPLY` — but the *return* is a `LikeableUnion` of six,
 * which additionally includes `MessageActivity`. Every member we can actually
 * reach gets a fragment; `MessageActivity` deliberately does not, so a like on
 * private mail could not round-trip even if something asked for it.
 *
 * Returns only the two fields the optimistic patch has to reconcile, so a like
 * never costs a refetch.
 */
export const TOGGLE_LIKE_MUTATION = `
mutation ($id: Int!, $type: LikeableType!) {
  ToggleLikeV2(id: $id, type: $type) {
    __typename
    ... on ListActivity  { id likeCount isLiked }
    ... on TextActivity  { id likeCount isLiked }
    ... on ActivityReply { id likeCount isLiked }
    ... on Thread        { id likeCount isLiked }
    ... on ThreadComment { id likeCount isLiked }
  }
}`;

export type LikeableType = "ACTIVITY" | "ACTIVITY_REPLY" | "THREAD" | "THREAD_COMMENT";

export interface LikeResult {
  id: number;
  likeCount: number;
  isLiked: boolean;
}

export async function toggleLike(id: number, type: LikeableType): Promise<LikeResult> {
  const data = await gql<{ ToggleLikeV2: LikeResult }>(TOGGLE_LIKE_MUTATION, { id, type });
  return data.ToggleLikeV2;
}

/**
 * Replies to one activity, loaded on demand.
 *
 * Not nested inside `ACTIVITY_QUERY`: a page of twenty-five activities carrying
 * every reply would multiply the payload for rows nobody expanded. One request
 * per expansion, user-initiated.
 *
 * `ActivityReply` has no `replyCount` and no children — replies are flat, one
 * level, which is a fact about AniList rather than a simplification here.
 */
export const ACTIVITY_REPLIES_QUERY = `
query ($activityId: Int!) {
  Page(perPage: 50) {
    ${PAGE_INFO}
    activityReplies(activityId: $activityId) {
      id text createdAt likeCount isLiked
      user { ${SOCIAL_USER} }
    }
  }
}`;

export interface ActivityReply {
  id: number;
  text: string | null;
  createdAt: number;
  likeCount: number | null;
  isLiked: boolean | null;
  user: SocialUser | null;
}

export async function activityReplies(activityId: number): Promise<ActivityReply[]> {
  const data = await gql<{ Page: { activityReplies: ActivityReply[] } }>(
    ACTIVITY_REPLIES_QUERY,
    { activityId },
  );
  return data.Page.activityReplies ?? [];
}

export const SAVE_ACTIVITY_REPLY_MUTATION = `
mutation ($activityId: Int!, $text: String!) {
  SaveActivityReply(activityId: $activityId, text: $text) {
    id text createdAt likeCount isLiked
    user { ${SOCIAL_USER} }
  }
}`;

export async function saveActivityReply(
  activityId: number,
  text: string,
): Promise<ActivityReply> {
  const data = await gql<{ SaveActivityReply: ActivityReply }>(
    SAVE_ACTIVITY_REPLY_MUTATION,
    { activityId, text },
  );
  return data.SaveActivityReply;
}

export interface ToggleFollowResult {
  id: number;
  name: string;
  isFollowing: boolean | null;
  isFollower: boolean | null;
}

export async function toggleFollow(userId: number): Promise<ToggleFollowResult> {
  const data = await gql<{ ToggleFollow: ToggleFollowResult }>(
    TOGGLE_FOLLOW_MUTATION,
    { userId },
  );
  return data.ToggleFollow;
}

/**
 * Post a status update.
 *
 * This mutation is the reason CLAUDE.md's rejected-features section carries a
 * second carve-out — read it before removing anything here.
 *
 * Returns the created activity in the same shape `ACTIVITY_QUERY` produces, so
 * the new post can be pushed straight onto the front of the cached feed rather
 * than triggering a refetch of a page that has just changed underneath.
 */
export const SAVE_TEXT_ACTIVITY_MUTATION = `
mutation ($text: String!) {
  SaveTextActivity(text: $text) {
    id text createdAt likeCount isLiked replyCount siteUrl
    user { ${SOCIAL_USER} }
  }
}`;

export interface SavedTextActivity {
  id: number;
  text: string | null;
  createdAt: number;
  likeCount: number | null;
  isLiked: boolean | null;
  replyCount: number | null;
  siteUrl: string | null;
  user: SocialUser | null;
}

export async function saveTextActivity(text: string): Promise<SavedTextActivity> {
  const data = await gql<{ SaveTextActivity: SavedTextActivity }>(
    SAVE_TEXT_ACTIVITY_MUTATION,
    { text },
  );
  return data.SaveTextActivity;
}

/** Deleting is the only way back — AniList has no edit for a text activity. */
export const DELETE_ACTIVITY_MUTATION = `
mutation ($id: Int!) { DeleteActivity(id: $id) { deleted } }`;

export async function deleteActivity(id: number): Promise<boolean> {
  const data = await gql<{ DeleteActivity: { deleted: boolean } }>(
    DELETE_ACTIVITY_MUTATION,
    { id },
  );
  return data.DeleteActivity?.deleted === true;
}

/**
 * Pin (or unpin) one of the viewer's own activities to their profile.
 * `isPinned` exists on both renderable members (verified by introspection),
 * and the profile feed sorts `[PINNED, ID_DESC]` so a pin floats on refetch.
 */
export const TOGGLE_ACTIVITY_PIN_MUTATION = `
mutation ($id: Int!, $pinned: Boolean) {
  ToggleActivityPin(id: $id, pinned: $pinned) {
    ... on ListActivity { id isPinned }
    ... on TextActivity { id isPinned }
  }
}`;

export async function toggleActivityPin(
  id: number,
  pinned: boolean,
): Promise<{ id: number; isPinned: boolean | null } | null> {
  const data = await gql<{
    ToggleActivityPin: { id: number; isPinned: boolean | null } | null;
  }>(TOGGLE_ACTIVITY_PIN_MUTATION, { id, pinned });
  return data.ToggleActivityPin;
}

// --- Forum ----------------------------------------------------------------

/**
 * A list of threads. **No `body`** — a list renders titles.
 *
 * `sort: REPLIED_AT_DESC` puts the live conversations first and is a total
 * order, which paging needs. `pageInfo.total` is the same capped 5000 sentinel
 * as everywhere else in this file, so thread lists show no remaining count.
 */
export const THREADS_QUERY = `
query ($userId: Int, $page: Int) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    threads(userId: $userId, sort: REPLIED_AT_DESC) {
      id title replyCount viewCount likeCount isLiked isSticky isLocked
      repliedAt createdAt siteUrl
      user { ${SOCIAL_USER} }
      replyUser { id name }
      categories { id name }
    }
  }
}`;

export interface ThreadSummary {
  id: number;
  title: string | null;
  replyCount: number | null;
  viewCount: number | null;
  likeCount: number | null;
  isLiked: boolean | null;
  isSticky: boolean | null;
  isLocked: boolean | null;
  repliedAt: number | null;
  createdAt: number | null;
  siteUrl: string | null;
  user: SocialUser | null;
  replyUser: { id: number; name: string } | null;
  categories: { id: number; name: string }[] | null;
}

export interface ThreadPage {
  pageInfo: PageInfo;
  threads: ThreadSummary[];
}

/**
 * Threads one user started. This used to also take `{ replyUserId }`, and the
 * variant was dropped with the "Replied to" lens it fed: that argument lists
 * threads where the user is the *most recent* replier, so anyone whose reply
 * was answered vanished from their own tab. `userForumComments` answers the
 * question that lens was pretending to.
 */
export async function threads(
  vars: { userId: number },
  page = 1,
): Promise<ThreadPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; threads: ThreadSummary[] } }>(
    THREADS_QUERY,
    { ...vars, page },
  );
  return { pageInfo: data.Page.pageInfo, threads: data.Page.threads ?? [] };
}

/**
 * `replyUser` and `replyCommentId` are what make "jump to the newest reply"
 * possible on a thread too big to page to the end of.
 *
 * Two scalars on a request already being made. AniList caps paging at 5,000
 * entries, so on thread 1 (7,045 root comments) the last *reachable* page ends
 * in 2021 while the thread was replied to today. `replyCommentId` is the way
 * out: `THREAD_COMMENT_TREE_QUERY` resolves it through a root LIST field that
 * the cap does not apply to, and answers with the whole conversation it sits
 * in. One request, and it does not care how big the thread is.
 *
 * `replyUser` is no longer load-bearing for the jump — it names the last
 * replier on screen. The route it used to drive (`threadComments(threadId,
 * userId:)`, paged to that author's own last page) did work and was verified:
 * Kento46 has 144 comments in thread 1 and the final page of them does hold
 * `replyCommentId`. It was replaced because it arrives without the conversation
 * around it, which is the thing a reader opened the thread for.
 *
 * See `lib/threadJump`.
 */
export const THREAD_QUERY = `
query ($id: Int!) {
  Thread(id: $id) {
    id title body replyCount viewCount likeCount isLiked isLocked isSticky
    isSubscribed repliedAt createdAt siteUrl replyCommentId
    user { ${SOCIAL_USER} }
    replyUser { ${SOCIAL_USER} }
    categories { id name }
    mediaCategories { ${SOCIAL_MEDIA} }
  }
}`;

export interface ThreadDetail extends Omit<ThreadSummary, "replyUser"> {
  body: string | null;
  isSubscribed: boolean | null;
  mediaCategories: SocialMedia[] | null;
  /** Who posted the newest reply, and which comment that is. */
  replyUser: SocialUser | null;
  replyCommentId: number | null;
}

export async function thread(id: number): Promise<ThreadDetail> {
  const data = await gql<{ Thread: ThreadDetail | null }>(THREAD_QUERY, { id });
  if (!data.Thread) throw new Error("NOT_FOUND");
  return data.Thread;
}

/**
 * A page of comments, with their reply chains.
 *
 * `perPage: 10` rather than 25, and that is because of `childComments`: it is a
 * raw `Json` scalar with no depth control, and asking for it cost 52,801 bytes
 * for twelve comments against 3,964 without — 13×, with nesting measured 48
 * levels deep. It is fetched anyway because replies are most of what a thread is
 * and it is one request either way; the page size is what pays for it.
 * `lib/comments` flattens the result to two levels and reports the rest.
 *
 * **`sort` does nothing here, and is deliberately not passed.** `ThreadCommentSort`
 * declares `ID`/`ID_DESC` and AniList accepts either — then returns the
 * byte-identical page. Measured on two threads in every spelling (`[ID_DESC]`,
 * `ID_DESC`, `[ID]`), so oldest-first is not a choice, it is the only order
 * there is. Wiring it would look like it worked and quietly change nothing. The
 * `id` argument is inert in the same way; only `threadId` and `userId` filter.
 *
 * `$userId` is what tier 2 of the jump uses — see `THREAD_QUERY`. Null on the
 * ordinary read, which is how a nullable GraphQL argument means "unfiltered".
 */
export const THREAD_COMMENTS_QUERY = `
query ($threadId: Int!, $page: Int, $userId: Int) {
  Page(page: $page, perPage: 10) {
    ${PAGE_INFO}
    threadComments(threadId: $threadId, userId: $userId) {
      id comment likeCount isLiked createdAt siteUrl
      user { ${SOCIAL_USER} }
      childComments
    }
  }
}`;

export interface CommentPage {
  pageInfo: PageInfo;
  /** Raw — `flattenComments` in `lib/comments` is what tightens these. */
  comments: unknown[];
}

export async function threadComments(
  threadId: number,
  page = 1,
  /** Narrows to one author — the second tier of the newest-reply jump. */
  userId?: number,
): Promise<CommentPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; threadComments: unknown[] } }>(
    THREAD_COMMENTS_QUERY,
    { threadId, page, userId: userId ?? null },
  );
  return { pageInfo: data.Page.pageInfo, comments: data.Page.threadComments ?? [] };
}

/**
 * One comment and everything under it, with **no page-depth cap**.
 *
 * `Page.threadComments` cannot reach past 5,000 entries, which puts the end of
 * every big thread out of reach — thread 1 is 7,045 root comments and thread
 * 15346 is 70,348, so 71% and 7% of them are readable that way. This is the way
 * around it, and the difference is that `ThreadComment` is a **root LIST field
 * rather than a `Page`**: the cap is a property of paging, so nothing here is
 * capped.
 *
 * Two measured behaviours it depends on:
 *
 * 1. **It resolves to the *root* of the tree, not to the id asked for.**
 *    `ThreadComment(id: 3236565)` — thread 1's `replyCommentId` — answers with
 *    comment `3236562` by a different user, and the id asked for is three
 *    levels down inside its `childComments`. That is the whole point: the reply
 *    arrives with the conversation around it rather than on its own.
 * 2. **A missing id answers `"Not Found."` and returns `null`.** Deleted
 *    comments are ordinary, so the caller treats an empty list as "no tree",
 *    not as an error. It is also why this is never aliased beside anything
 *    else: one not-found root nulls every sibling in the same request, the way
 *    `FOLLOW_COUNTS_QUERY` documents for `User`. Verified here too — forty
 *    aliased `ThreadComment` roots all came back null because one id was gone.
 *
 * `sort` is not passed for the same reason `THREAD_COMMENTS_QUERY` omits it.
 */
export const THREAD_COMMENT_TREE_QUERY = `
query ($id: Int!) {
  ThreadComment(id: $id) {
    id comment likeCount isLiked createdAt siteUrl
    user { ${SOCIAL_USER} }
    childComments
  }
}`;

/**
 * The newest reply's conversation, in one request.
 *
 * Returns the raw list `flattenComments` already takes — same shape as
 * `threadComments().comments`, so the render path does not change. Empty when
 * the comment has been deleted.
 */
export async function threadCommentTree(id: number): Promise<unknown[]> {
  const data = await gql<{ ThreadComment: unknown[] | null }>(
    THREAD_COMMENT_TREE_QUERY,
    { id },
  );
  return data.ThreadComment ?? [];
}

/**
 * Everything one user has said in the forum, across every thread, newest
 * first.
 *
 * Two measured facts make this query what it is:
 *
 * 1. **`threadComments` with `userId` alone works** — `threadId` is genuinely
 *    optional at the API, and the result is what anilist.co's own "Forum
 *    Comments" profile page draws, nested replies included. `thread { id
 *    title }` resolves on each row, and `total` is honest (a real count, not
 *    the 5,000 sentinel — measured `total: 3` for a 3-comment user).
 * 2. **`sort: [ID_DESC]` works here, and only here.** With a `threadId` the
 *    sort argument is inert — the byte-identical page comes back however it
 *    is spelled, which `THREAD_COMMENTS_QUERY` documents. With only `userId`
 *    the ids actually reverse, measured against the unsorted call. Newest
 *    first is exactly what a profile wants, so this is the one place the app
 *    passes `sort` to this field.
 *
 * No `childComments` — that field is the untyped 13×-cost blob, and a
 * comments list has no use for reply trees — which is why `perPage` can be 25
 * where the thread view pays for the blob with 10.
 */
export const USER_FORUM_COMMENTS_QUERY = `
query ($userId: Int!, $page: Int) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    threadComments(userId: $userId, sort: [ID_DESC]) {
      id comment likeCount createdAt
      thread { id title }
    }
  }
}`;

export interface UserForumComment {
  id: number;
  comment: string | null;
  likeCount: number | null;
  createdAt: number | null;
  thread: { id: number; title: string | null } | null;
}

export interface UserCommentPage {
  pageInfo: PageInfo;
  comments: UserForumComment[];
}

export async function userForumComments(
  userId: number,
  page = 1,
): Promise<UserCommentPage> {
  const data = await gql<{
    Page: { pageInfo: PageInfo; threadComments: UserForumComment[] };
  }>(USER_FORUM_COMMENTS_QUERY, { userId, page });
  return { pageInfo: data.Page.pageInfo, comments: data.Page.threadComments ?? [] };
}

export const SAVE_THREAD_COMMENT_MUTATION = `
mutation ($threadId: Int!, $comment: String!, $parentCommentId: Int) {
  SaveThreadComment(threadId: $threadId, comment: $comment, parentCommentId: $parentCommentId) {
    id comment createdAt likeCount isLiked siteUrl
    user { ${SOCIAL_USER} }
  }
}`;

export async function saveThreadComment(
  threadId: number,
  comment: string,
  parentCommentId?: number,
): Promise<unknown> {
  const data = await gql<{ SaveThreadComment: unknown }>(SAVE_THREAD_COMMENT_MUTATION, {
    threadId,
    comment,
    parentCommentId,
  });
  return data.SaveThreadComment;
}

export const TOGGLE_THREAD_SUBSCRIPTION_MUTATION = `
mutation ($threadId: Int!, $subscribe: Boolean!) {
  ToggleThreadSubscription(threadId: $threadId, subscribe: $subscribe) {
    id isSubscribed
  }
}`;

export async function toggleThreadSubscription(
  threadId: number,
  subscribe: boolean,
): Promise<{ id: number; isSubscribed: boolean | null }> {
  const data = await gql<{
    ToggleThreadSubscription: { id: number; isSubscribed: boolean | null };
  }>(TOGGLE_THREAD_SUBSCRIPTION_MUTATION, { threadId, subscribe });
  return data.ToggleThreadSubscription;
}

/**
 * Creates a thread — `SaveThread` without an `id` is a create (verified by
 * introspection: `id, title, body, categories: [Int], mediaCategories: [Int],
 * sticky, locked`; the last two are moderator toys and never sent).
 *
 * Karasu is create-only by decision: no edit, no delete. Editing and deleting
 * live on anilist.co, where a destructive click has the site's own confirm
 * around it.
 *
 * Returns only the id, which is all the navigation to the new thread needs.
 */
export const SAVE_THREAD_MUTATION = `
mutation ($title: String!, $body: String!, $categories: [Int]) {
  SaveThread(title: $title, body: $body, categories: $categories) {
    id
  }
}`;

export async function saveThread(input: {
  title: string;
  body: string;
  categories: number[];
}): Promise<{ id: number }> {
  const data = await gql<{ SaveThread: { id: number } }>(SAVE_THREAD_MUTATION, input);
  return data.SaveThread;
}

// --- Account settings -----------------------------------------------------

/**
 * `UpdateUser`, with only the arguments this pane is willing to send.
 *
 * **`animeListOptions` and `mangaListOptions` are deliberately absent from the
 * variable list**, not merely unused: `MediaListOptionsInput.customLists` is a
 * full replacement with no undo on AniList's side. `lib/anilistUserFields`
 * carries the reasoning and a test that keeps it out.
 *
 * Returns what the pane needs to reconcile, so a save never costs a refetch.
 */
export const UPDATE_USER_MUTATION = `
mutation (
  $about: String
  $titleLanguage: UserTitleLanguage
  $staffNameLanguage: UserStaffNameLanguage
  $scoreFormat: ScoreFormat
  $rowOrder: String
  $profileColor: String
  $timezone: String
  $activityMergeTime: Int
  $displayAdultContent: Boolean
  $airingNotifications: Boolean
  $restrictMessagesToFollowing: Boolean
  $notificationOptions: [NotificationOptionInput]
  $donatorBadge: String
  $disabledListActivity: [ListActivityOptionInput]
) {
  UpdateUser(
    about: $about
    titleLanguage: $titleLanguage
    staffNameLanguage: $staffNameLanguage
    scoreFormat: $scoreFormat
    rowOrder: $rowOrder
    profileColor: $profileColor
    timezone: $timezone
    activityMergeTime: $activityMergeTime
    displayAdultContent: $displayAdultContent
    airingNotifications: $airingNotifications
    restrictMessagesToFollowing: $restrictMessagesToFollowing
    notificationOptions: $notificationOptions
    donatorBadge: $donatorBadge
    disabledListActivity: $disabledListActivity
  ) {
    id
    about
    donatorBadge
    options {
      titleLanguage displayAdultContent airingNotifications profileColor
      timezone activityMergeTime staffNameLanguage restrictMessagesToFollowing
      notificationOptions { type enabled }
      disabledListActivity { disabled type }
    }
    mediaListOptions { scoreFormat rowOrder }
  }
}`;

export interface UpdatedUser {
  id: number;
  about: string | null;
  donatorBadge: string | null;
  options: (AniListUserOptions & {
    notificationOptions: { type: string | null; enabled: boolean | null }[] | null;
    disabledListActivity: { disabled: boolean | null; type: string | null }[] | null;
  }) | null;
  mediaListOptions: { scoreFormat: string | null; rowOrder: string | null } | null;
}

export async function updateUser(vars: Record<string, unknown>): Promise<UpdatedUser> {
  const data = await gql<{ UpdateUser: UpdatedUser }>(UPDATE_USER_MUTATION, vars);
  return data.UpdateUser;
}

/**
 * The viewer's notification options, on their own key.
 *
 * Separate from `USER_PROFILE_QUERY` and read with `staleTime: 0` because
 * `UpdateUser(notificationOptions:)` replaces the **whole array** — merging
 * against a stale copy would silently disable whatever changed elsewhere since.
 */
export const NOTIFICATION_OPTIONS_QUERY = `
query ($id: Int!) {
  User(id: $id) { id options { notificationOptions { type enabled } } }
}`;

export async function notificationOptions(
  id: number,
): Promise<{ type: string | null; enabled: boolean | null }[]> {
  const data = await gql<{
    User: { options: { notificationOptions: { type: string | null; enabled: boolean | null }[] | null } | null } | null;
  }>(NOTIFICATION_OPTIONS_QUERY, { id });
  return data.User?.options?.notificationOptions ?? [];
}

// --- Forum index ----------------------------------------------------------

/**
 * AniList's forum categories, by id.
 *
 * Hardcoded because there is **no root query for them** — `Query.ThreadCategory`
 * does not exist, and a category is only reachable through a thread that happens
 * to be in it. This list was collected empirically: ten pages of threads across
 * five sort orders, plus a direct `categoryId` probe of ids 1–20. Seventeen
 * exist; 6 and anything above 18 return nothing, presumably merged or removed.
 *
 * If AniList adds one, threads in it still appear under "All" — only the filter
 * chip is missing, which is a visible gap rather than a silent failure.
 */
export const THREAD_CATEGORIES: { id: number; name: string }[] = [
  { id: 1, name: "Anime" },
  { id: 2, name: "Manga" },
  { id: 3, name: "Light Novels" },
  { id: 4, name: "Visual Novels" },
  { id: 5, name: "Release Discussion" },
  { id: 7, name: "General" },
  { id: 8, name: "News" },
  { id: 9, name: "Music" },
  { id: 10, name: "Gaming" },
  { id: 11, name: "Site Feedback" },
  { id: 12, name: "Bug Reports" },
  { id: 13, name: "Site Announcements" },
  { id: 14, name: "List Customisation" },
  { id: 15, name: "Recommendations" },
  { id: 16, name: "Forum Games" },
  { id: 17, name: "Misc" },
  { id: 18, name: "AniList Apps" },
];

/**
 * The forum index: recent threads, one category, a search, or your subscriptions.
 *
 * `sort` is a parameter because search wants `SEARCH_MATCH` while browsing wants
 * `REPLIED_AT_DESC` — and both are total orders, which paging needs.
 * `subscribed: true` is viewer-scoped and returns nothing without a token.
 */
export const FORUM_THREADS_QUERY = `
query ($page: Int, $categoryId: Int, $search: String, $subscribed: Boolean, $sort: [ThreadSort]) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    threads(categoryId: $categoryId, search: $search, subscribed: $subscribed, sort: $sort) {
      id title replyCount viewCount likeCount isLiked isSticky isLocked
      repliedAt createdAt siteUrl
      user { ${SOCIAL_USER} }
      replyUser { id name }
      categories { id name }
    }
  }
}`;

export interface ForumQuery {
  categoryId?: number;
  search?: string;
  subscribed?: boolean;
}

export async function forumThreads(vars: ForumQuery, page = 1): Promise<ThreadPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; threads: ThreadSummary[] } }>(
    FORUM_THREADS_QUERY,
    {
      ...vars,
      page,
      // A search sorted by activity buries the match; browsing sorted by
      // relevance is meaningless.
      sort: vars.search ? ["SEARCH_MATCH"] : ["IS_STICKY", "REPLIED_AT_DESC"],
    },
  );
  return { pageInfo: data.Page.pageInfo, threads: data.Page.threads ?? [] };
}

// --- Reviews ---------------------------------------------------------------

/**
 * A title's reviews, best-rated first. `body` is requested as markdown
 * (never `asHtml`) so the social renderer applies; five per page because
 * bodies are long — a review is an essay, not a comment — and the fold that
 * shows them is opened deliberately.
 */
export const REVIEWS_QUERY = `
query ($mediaId: Int!, $page: Int) {
  Page(page: $page, perPage: 5) {
    ${PAGE_INFO}
    reviews(mediaId: $mediaId, sort: RATING_DESC) {
      id
      summary
      body
      rating
      ratingAmount
      userRating
      score
      createdAt
      siteUrl
      user { ${SOCIAL_USER} }
    }
  }
}`;

export interface ReviewRow {
  id: number;
  summary: string | null;
  body: string | null;
  /** Up-votes — the site renders "{rating} of {ratingAmount} liked this". */
  rating: number | null;
  ratingAmount: number | null;
  /** UP_VOTE | DOWN_VOTE | NO_VOTE — the viewer's own. */
  userRating: string | null;
  /** The reviewer's verdict, always hundred-point here. */
  score: number | null;
  createdAt: number;
  siteUrl: string | null;
  user: SocialUser | null;
}

export interface ReviewPage {
  pageInfo: PageInfo;
  reviews: ReviewRow[];
}

export async function reviews(mediaId: number, page = 1): Promise<ReviewPage> {
  const data = await gql<{ Page: ReviewPage }>(REVIEWS_QUERY, { mediaId, page });
  return { pageInfo: data.Page.pageInfo, reviews: data.Page.reviews ?? [] };
}

/** Vote on a review's helpfulness. Returns what the optimistic UI needs. */
const RATE_REVIEW_MUTATION = `
mutation ($reviewId: Int, $rating: ReviewRating) {
  RateReview(reviewId: $reviewId, rating: $rating) {
    id
    rating
    ratingAmount
    userRating
  }
}`;

export async function rateReview(
  reviewId: number,
  rating: "UP_VOTE" | "DOWN_VOTE" | "NO_VOTE",
): Promise<{ rating: number | null; ratingAmount: number | null; userRating: string | null }> {
  const data = await gql<{
    RateReview: { rating: number | null; ratingAmount: number | null; userRating: string | null };
  }>(RATE_REVIEW_MUTATION, { reviewId, rating });
  return data.RateReview;
}

/** Creates with `id` absent, edits with it present — AniList's own upsert. */
const SAVE_REVIEW_MUTATION = `
mutation ($id: Int, $mediaId: Int, $body: String, $summary: String, $score: Int, $private: Boolean) {
  SaveReview(id: $id, mediaId: $mediaId, body: $body, summary: $summary, score: $score, private: $private) {
    id
  }
}`;

export async function saveReview(input: {
  id?: number;
  mediaId: number;
  body: string;
  summary: string;
  score: number;
  private: boolean;
}): Promise<number> {
  const data = await gql<{ SaveReview: { id: number } }>(SAVE_REVIEW_MUTATION, input);
  return data.SaveReview.id;
}

/**
 * The viewer's own review of a title, if any — the composer's prefill.
 *
 * Its own lookup rather than a scan of the loaded pages: the feed sorts by
 * rating, so a review of yours that nobody voted on may sit pages deep. Spent
 * on the "write a review" click, which is the user-initiated moment; `private`
 * is requested here and only here, because on your own review it is the one
 * flag the composer must not silently reset.
 */
export const MY_REVIEW_QUERY = `
query ($mediaId: Int!, $userId: Int!) {
  Page(page: 1, perPage: 1) {
    reviews(mediaId: $mediaId, userId: $userId) {
      id
      summary
      body
      score
      private
    }
  }
}`;

export interface MyReview {
  id: number;
  summary: string | null;
  body: string | null;
  score: number | null;
  private: boolean;
}

export async function myReview(mediaId: number, userId: number): Promise<MyReview | null> {
  const data = await gql<{ Page: { reviews: (MyReview & { private: boolean | null })[] | null } }>(
    MY_REVIEW_QUERY,
    { mediaId, userId },
  );
  const row = data.Page.reviews?.[0];
  return row ? { ...row, private: row.private === true } : null;
}

// --- Another user's list ---------------------------------------------------

/**
 * A foreign list, read-only. Deliberately a plain `gql` fetch rather than
 * `fetchMediaList`: the Rust command writes its result into the SQLite list
 * cache keyed by user id and drains the offline queue — machinery that
 * exists for *your* list and must not run for someone else's. `score` is
 * requested bare, so it arrives in the owner's own format; the caller pairs
 * it with `UserProfile.mediaListOptions.scoreFormat` to render their numbers
 * the way they chose them. Private entries are simply absent server-side.
 */
export const USER_LIST_QUERY = `
query ($userId: Int!, $type: MediaType!) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      name
      status
      isCustomList
      entries {
        id
        mediaId
        status
        score
        progress
        progressVolumes
        media {
          ${SOCIAL_MEDIA}
          episodes
          chapters
        }
      }
    }
  }
}`;

export interface ForeignListEntry {
  id: number;
  mediaId: number;
  status: string;
  /** In the *owner's* score format. */
  score: number;
  progress: number;
  progressVolumes: number | null;
  media: SocialMedia & { episodes: number | null; chapters: number | null };
}

export interface ForeignListGroup {
  name: string;
  status: string | null;
  isCustomList: boolean;
  entries: ForeignListEntry[];
}

export async function userList(
  userId: number,
  type: "ANIME" | "MANGA",
): Promise<ForeignListGroup[]> {
  const data = await gql<{
    MediaListCollection: { lists: ForeignListGroup[] | null } | null;
  }>(USER_LIST_QUERY, { userId, type });
  return data.MediaListCollection?.lists ?? [];
}

// --- Site notifications ----------------------------------------------------

/**
 * AniList's own notification feed — the bell's second view.
 *
 * Nineteen inline fragments because the union has nineteen members the bell
 * renders; each selects only what its row draws (a name, a title, a route),
 * never the covers or avatars the icon tiles replace. The twentieth member,
 * `ActivityMessageNotification`, is private mail and is excluded the same
 * three ways `MessageActivity` is on the feeds: absent from `type_in`, given
 * no inline fragment, and normalised to null in `lib/siteNotifications` with
 * a test that says so. One consequence is honest and accepted: a message can
 * make the server's unread count exceed what the list shows.
 *
 * `$reset` is passed as true on the first page only — that is AniList's own
 * "mark seen": the server zeroes `unreadNotificationCount` when it serves the
 * page. Later pages must not reset; they are history, not news.
 */
export const SITE_NOTIFICATIONS_QUERY = `
query ($page: Int, $reset: Boolean) {
  Page(page: $page, perPage: 15) {
    ${PAGE_INFO}
    notifications(resetNotificationCount: $reset, type_in: [
      AIRING, FOLLOWING, ACTIVITY_MENTION, ACTIVITY_REPLY, ACTIVITY_REPLY_SUBSCRIBED,
      ACTIVITY_LIKE, ACTIVITY_REPLY_LIKE, THREAD_COMMENT_MENTION, THREAD_COMMENT_REPLY,
      THREAD_SUBSCRIBED, THREAD_COMMENT_LIKE, THREAD_LIKE, RELATED_MEDIA_ADDITION,
      MEDIA_DATA_CHANGE, MEDIA_MERGE, MEDIA_DELETION, MEDIA_SUBMISSION_UPDATE,
      STAFF_SUBMISSION_UPDATE, CHARACTER_SUBMISSION_UPDATE
    ]) {
      __typename
      ... on AiringNotification { id createdAt episode media { id title { romaji english native } } }
      ... on FollowingNotification { id createdAt user { id name } }
      ... on ActivityMentionNotification { id createdAt user { id name } }
      ... on ActivityReplyNotification { id createdAt user { id name } }
      ... on ActivityReplySubscribedNotification { id createdAt user { id name } }
      ... on ActivityLikeNotification { id createdAt user { id name } }
      ... on ActivityReplyLikeNotification { id createdAt user { id name } }
      ... on ThreadCommentMentionNotification { id createdAt user { id name } thread { id title } }
      ... on ThreadCommentReplyNotification { id createdAt user { id name } thread { id title } }
      ... on ThreadCommentSubscribedNotification { id createdAt user { id name } thread { id title } }
      ... on ThreadCommentLikeNotification { id createdAt user { id name } thread { id title } }
      ... on ThreadLikeNotification { id createdAt user { id name } thread { id title } }
      ... on RelatedMediaAdditionNotification { id createdAt media { id title { romaji english native } } }
      ... on MediaDataChangeNotification { id createdAt reason media { id title { romaji english native } } }
      ... on MediaMergeNotification { id createdAt reason deletedMediaTitles media { id title { romaji english native } } }
      ... on MediaDeletionNotification { id createdAt reason deletedMediaTitle }
      ... on MediaSubmissionUpdateNotification { id createdAt status submittedTitle media { id title { romaji english native } } }
      ... on StaffSubmissionUpdateNotification { id createdAt status staff { id name { full } } }
      ... on CharacterSubmissionUpdateNotification { id createdAt status character { id name { full } } }
    }
  }
}`;

export interface SiteNotifPage {
  pageInfo: PageInfo;
  rows: SiteNotifRow[];
}

export async function siteNotifications(page: number, reset: boolean): Promise<SiteNotifPage> {
  const data = await gql<{
    Page: { pageInfo: PageInfo; notifications: (RawSiteNotification | null)[] | null };
  }>(SITE_NOTIFICATIONS_QUERY, { page, reset });
  return {
    pageInfo: data.Page.pageInfo,
    rows: (data.Page.notifications ?? [])
      .map(normalizeSiteNotification)
      .filter((r): r is SiteNotifRow => r !== null),
  };
}

/** How much is waiting — the bell's badge and the tab's chip. Cheap by
    construction: one scalar off the viewer, fetched at startup, on a slow
    interval, and when the panel opens; the feed's mark-seen zeroes it. */
export const SITE_NOTIF_COUNT_QUERY = `
query { Viewer { unreadNotificationCount } }`;

export async function siteNotifCount(): Promise<number> {
  const data = await gql<{ Viewer: { unreadNotificationCount: number | null } | null }>(
    SITE_NOTIF_COUNT_QUERY,
  );
  return data.Viewer?.unreadNotificationCount ?? 0;
}

// --- Favourites -----------------------------------------------------------

/**
 * Toggle a favourite. One id per call, and which key you use picks the kind.
 *
 * Returns nothing useful — AniList answers with the viewer's whole favourites
 * connection, which is far more than a heart needs — so the caller patches its
 * own cache from the fact that the call succeeded rather than from the response.
 * That is the one place in this file where the optimistic value is also the
 * final value.
 */
export const TOGGLE_FAVOURITE_MUTATION = `
mutation ($animeId: Int, $mangaId: Int, $characterId: Int, $staffId: Int, $studioId: Int) {
  ToggleFavourite(
    animeId: $animeId
    mangaId: $mangaId
    characterId: $characterId
    staffId: $staffId
    studioId: $studioId
  ) {
    anime { pageInfo { total } }
  }
}`;

export type FavouriteKind = "anime" | "manga" | "character" | "staff" | "studio";

const FAV_ARG: Record<FavouriteKind, string> = {
  anime: "animeId",
  manga: "mangaId",
  character: "characterId",
  staff: "staffId",
  studio: "studioId",
};

export async function toggleFavourite(kind: FavouriteKind, id: number): Promise<void> {
  await gql<unknown>(TOGGLE_FAVOURITE_MUTATION, { [FAV_ARG[kind]]: id });
}

/**
 * Every favourite of every kind, for the reorder modal.
 *
 * All five connections share one page counter: an exhausted kind returns an
 * empty page while a longer one keeps going, and the request count is the
 * *longest* kind's page count instead of five separate sweeps — one request
 * for the common case of fewer than 25 per kind. Bounded at
 * `FAVOURITES_MAX_PAGES` because `UpdateFavouriteOrder` replaces the whole
 * set: a reorder built on a truncated read would silently drop the tail, so
 * `truncated: true` is the signal to refuse the save, not to shrug.
 */
export const FAVOURITES_PAGE_QUERY = `
query ($id: Int!, $page: Int) {
  User(id: $id) {
    favourites {
      anime(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { ${SOCIAL_MEDIA} }
      }
      manga(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { ${SOCIAL_MEDIA} }
      }
      characters(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { id name { full } image { medium } }
      }
      staff(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { id name { full } image { medium } }
      }
      studios(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { id name }
      }
    }
  }
}`;

const FAVOURITES_MAX_PAGES = 8;

export interface AllFavourites {
  anime: SocialMedia[];
  manga: SocialMedia[];
  characters: FavPerson[];
  staff: FavPerson[];
  studios: FavStudio[];
  /** True when a kind still had pages at the cap — reordering must refuse. */
  truncated: boolean;
}

interface FavPage<T> {
  pageInfo: { hasNextPage: boolean };
  nodes: T[];
}

export async function allFavourites(userId: number): Promise<AllFavourites> {
  const out: AllFavourites = {
    anime: [],
    manga: [],
    characters: [],
    staff: [],
    studios: [],
    truncated: false,
  };
  for (let page = 1; page <= FAVOURITES_MAX_PAGES; page++) {
    const data = await gql<{
      User: {
        favourites: {
          anime: FavPage<SocialMedia> | null;
          manga: FavPage<SocialMedia> | null;
          characters: FavPage<FavPerson> | null;
          staff: FavPage<FavPerson> | null;
          studios: FavPage<FavStudio> | null;
        } | null;
      } | null;
    }>(FAVOURITES_PAGE_QUERY, { id: userId, page });
    const fav = data.User?.favourites;
    if (!fav) break;
    out.anime.push(...(fav.anime?.nodes ?? []));
    out.manga.push(...(fav.manga?.nodes ?? []));
    out.characters.push(...(fav.characters?.nodes ?? []));
    out.staff.push(...(fav.staff?.nodes ?? []));
    out.studios.push(...(fav.studios?.nodes ?? []));
    const more =
      fav.anime?.pageInfo.hasNextPage ||
      fav.manga?.pageInfo.hasNextPage ||
      fav.characters?.pageInfo.hasNextPage ||
      fav.staff?.pageInfo.hasNextPage ||
      fav.studios?.pageInfo.hasNextPage;
    if (!more) return out;
  }
  out.truncated = true;
  return out;
}

/**
 * The favourite people and their birthdays — the dashboard digest's read.
 *
 * Its own lean query rather than a `dateOfBirth` on `FAVOURITES_PAGE_QUERY`:
 * the favourites modal renders discs and names and would carry the field for
 * nothing, and this one skips the three kinds without a birthday to have.
 * Paged like `allFavourites` and for the same reason, but a truncated read
 * here only shortens a greeting, so the cap is a shrug rather than a refusal.
 */
export const BIRTHDAYS_QUERY = `
query ($id: Int!, $page: Int) {
  User(id: $id) {
    favourites {
      characters(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { id name { full } image { medium } dateOfBirth { month day } }
      }
      staff(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { id name { full } image { medium } dateOfBirth { month day } }
      }
    }
  }
}`;

export interface BirthdayPerson extends FavPerson {
  dateOfBirth: { month: number | null; day: number | null } | null;
  kind: "character" | "staff";
}

export async function favouriteBirthdays(userId: number): Promise<BirthdayPerson[]> {
  type Node = FavPerson & { dateOfBirth: BirthdayPerson["dateOfBirth"] };
  const out: BirthdayPerson[] = [];
  for (let page = 1; page <= FAVOURITES_MAX_PAGES; page++) {
    const data = await gql<{
      User: {
        favourites: {
          characters: FavPage<Node> | null;
          staff: FavPage<Node> | null;
        } | null;
      } | null;
    }>(BIRTHDAYS_QUERY, { id: userId, page });
    const fav = data.User?.favourites;
    if (!fav) break;
    out.push(...(fav.characters?.nodes ?? []).map((n) => ({ ...n, kind: "character" as const })));
    out.push(...(fav.staff?.nodes ?? []).map((n) => ({ ...n, kind: "staff" as const })));
    if (!(fav.characters?.pageInfo.hasNextPage || fav.staff?.pageInfo.hasNextPage)) break;
  }
  return out;
}

/**
 * Reorder one kind's favourites. Whole-array by the API's design — the same
 * replace-the-set shape as `customLists` — which is why the caller always
 * sends the complete id list from a fresh `allFavourites` read (`staleTime: 0`
 * in the modal), never a cached or partial one. `lib/favouritesOrder` builds
 * the variables and its tests assert the set stays complete.
 *
 * One kind per call: the other kinds' arguments are omitted entirely, which
 * the API treats as "leave untouched" (per-kind saves are how the website's
 * own editor writes). Verified against the schema by introspection; never
 * validated by running it.
 */
export const UPDATE_FAVOURITE_ORDER_MUTATION = `
mutation (
  $animeIds: [Int]
  $animeOrder: [Int]
  $mangaIds: [Int]
  $mangaOrder: [Int]
  $characterIds: [Int]
  $characterOrder: [Int]
  $staffIds: [Int]
  $staffOrder: [Int]
  $studioIds: [Int]
  $studioOrder: [Int]
) {
  UpdateFavouriteOrder(
    animeIds: $animeIds
    animeOrder: $animeOrder
    mangaIds: $mangaIds
    mangaOrder: $mangaOrder
    characterIds: $characterIds
    characterOrder: $characterOrder
    staffIds: $staffIds
    staffOrder: $staffOrder
    studioIds: $studioIds
    studioOrder: $studioOrder
  ) {
    anime { pageInfo { total } }
  }
}`;

export async function updateFavouriteOrder(
  vars: Record<string, number[]>,
): Promise<void> {
  await gql<unknown>(UPDATE_FAVOURITE_ORDER_MUTATION, vars);
}

// --- People and studios ---------------------------------------------------

/**
 * Characters, staff and studios — the four `Query` roots the app never touched.
 *
 * They live here rather than in `queries.ts` for the same reason the profile
 * does: `queries.ts` is the media-and-statistics file, and these are the pages
 * you reach *from* a title rather than the title itself.
 *
 * Each was validated live, and the studio one caught a real error: the edge field
 * is `isMainStudio`, not `isMain` — `isMain` exists on `StudioEdge` (used by
 * `DETAIL_QUERY`) but not on the `MediaEdge` a studio's own media returns.
 */

export interface PersonMediaEdge {
  node: SocialMedia;
  characterRole?: string | null;
  staffRole?: string | null;
  isMainStudio?: boolean | null;
  voiceActors?: { id: number; name: { full: string | null }; image: { medium: string | null } | null }[] | null;
}

export interface CharacterDetail {
  id: number;
  name: { full: string | null; native: string | null; alternative: string[] | null };
  image: { large: string | null } | null;
  description: string | null;
  gender: string | null;
  age: string | null;
  bloodType: string | null;
  dateOfBirth: { year: number | null; month: number | null; day: number | null } | null;
  favourites: number | null;
  siteUrl: string | null;
  isFavourite: boolean | null;
  isFavouriteBlocked: boolean | null;
  media: { edges: PersonMediaEdge[] } | null;
}

/** `description(asHtml: false)` on purpose — the raw form is **markdown** (0 raw
 *  HTML tags across 24 staff+character samples; `asHtml: true` returns
 *  markdown-it output), so it goes through `lib/anilistMarkdown` like a bio.
 *  Media descriptions are the opposite case and keep `lib/anilistHtml`. */
export const CHARACTER_QUERY = `
query ($id: Int!) {
  Character(id: $id) {
    id
    name { full native alternative }
    image { large }
    description(asHtml: false)
    gender age bloodType
    dateOfBirth { year month day }
    favourites siteUrl isFavourite isFavouriteBlocked
    media(sort: POPULARITY_DESC, perPage: 24) {
      edges {
        characterRole
        voiceActors(language: JAPANESE) { id name { full } image { medium } }
        node { ${SOCIAL_MEDIA} }
      }
    }
  }
}`;

export async function character(id: number): Promise<CharacterDetail> {
  const data = await gql<{ Character: CharacterDetail | null }>(CHARACTER_QUERY, { id });
  if (!data.Character) throw new Error("NOT_FOUND");
  return data.Character;
}

export interface StaffDetail {
  id: number;
  name: { full: string | null; native: string | null };
  image: { large: string | null } | null;
  description: string | null;
  primaryOccupations: string[] | null;
  gender: string | null;
  age: number | null;
  homeTown: string | null;
  yearsActive: number[] | null;
  languageV2: string | null;
  dateOfBirth: { year: number | null; month: number | null; day: number | null } | null;
  dateOfDeath: { year: number | null; month: number | null; day: number | null } | null;
  favourites: number | null;
  siteUrl: string | null;
  isFavourite: boolean | null;
  isFavouriteBlocked: boolean | null;
  staffMedia: { edges: PersonMediaEdge[] } | null;
  characters: {
    nodes: { id: number; name: { full: string | null }; image: { medium: string | null } | null }[];
  } | null;
}

export const STAFF_QUERY = `
query ($id: Int!) {
  Staff(id: $id) {
    id
    name { full native }
    image { large }
    description(asHtml: false)
    primaryOccupations gender age homeTown yearsActive languageV2
    dateOfBirth { year month day }
    dateOfDeath { year month day }
    favourites siteUrl isFavourite isFavouriteBlocked
    staffMedia(sort: POPULARITY_DESC, perPage: 24) {
      edges { staffRole node { ${SOCIAL_MEDIA} } }
    }
    characters(sort: FAVOURITES_DESC, perPage: 12) {
      nodes { id name { full } image { medium } }
    }
  }
}`;

export async function staff(id: number): Promise<StaffDetail> {
  const data = await gql<{ Staff: StaffDetail | null }>(STAFF_QUERY, { id });
  if (!data.Staff) throw new Error("NOT_FOUND");
  return data.Staff;
}

export interface StudioDetail {
  id: number;
  name: string | null;
  isAnimationStudio: boolean | null;
  favourites: number | null;
  siteUrl: string | null;
  isFavourite: boolean | null;
  media: { edges: PersonMediaEdge[] } | null;
}

export const STUDIO_QUERY = `
query ($id: Int!) {
  Studio(id: $id) {
    id name isAnimationStudio favourites siteUrl isFavourite
    media(sort: POPULARITY_DESC, perPage: 24) {
      edges { isMainStudio node { ${SOCIAL_MEDIA} } }
    }
  }
}`;

export async function studio(id: number): Promise<StudioDetail> {
  const data = await gql<{ Studio: StudioDetail | null }>(STUDIO_QUERY, { id });
  if (!data.Studio) throw new Error("NOT_FOUND");
  return data.Studio;
}
