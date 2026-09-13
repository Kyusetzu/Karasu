import { gql } from "./anilist";
import type { Media, MediaType } from "./types";
import {
  normalizeSiteNotification,
  type RawSiteNotification,
  type SiteNotifRow,
} from "@/lib/siteNotifications";

/** AniList's social surface, all through `gql`, so the token stays in Rust and no new Tauri command is needed. */

// --- Shared shapes --------------------------------------------------------

export interface PageInfo {
  total: number;
  currentPage: number;
  lastPage?: number;
  hasNextPage: boolean;
}

const PAGE_INFO = `pageInfo { total currentPage lastPage hasNextPage }`;

/** Deliberately smaller than `MEDIA_FIELDS`; `isAdult` and `genres` exist only for lib/contentFilter. */
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

/** One user by name or id; wide because it is one object, and the settings pane shares it for its options. */
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
  // A null `User` with no error would otherwise render a blank profile rather than the not-found state.
  if (!data.User) throw new Error("NOT_FOUND");
  return data.User;
}

/** Aliased Page roots, safe since Page cannot 404; a not-found root nulls every sibling, so User is never aliased. */
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

/** `sort: USERNAME` because paging needs a total order; no `about`, since a page of bios would dwarf the rows. */
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

/** Search users by name; below `USER_SEARCH_MIN` the answer is filler, and `total` is a capped sentinel. */
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

/** Three more searchable entities, lean like `USER_SEARCH_QUERY`; `USER_SEARCH_MIN` gates them too. */
export const CHARACTER_SEARCH_QUERY = `
query ($search: String!, $page: Int) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    characters(search: $search, sort: SEARCH_MATCH) {
      id name { full } image { medium }
    }
  }
}`;

export const STAFF_SEARCH_QUERY = `
query ($search: String!, $page: Int) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    staff(search: $search, sort: SEARCH_MATCH) {
      id name { full } image { medium }
    }
  }
}`;

export const STUDIO_SEARCH_QUERY = `
query ($search: String!, $page: Int) {
  Page(page: $page, perPage: 25) {
    ${PAGE_INFO}
    studios(search: $search, sort: SEARCH_MATCH) { id name }
  }
}`;

/** A character or staff hit — just enough to draw a row and link the page. */
export interface PersonHit {
  id: number;
  name: { full: string | null } | null;
  image: { medium: string | null } | null;
}

export interface StudioHit {
  id: number;
  name: string;
}

export interface PersonSearchPage {
  pageInfo: PageInfo;
  rows: PersonHit[];
}

export interface StudioSearchPage {
  pageInfo: PageInfo;
  rows: StudioHit[];
}

export async function searchCharacters(
  term: string,
  page: number,
): Promise<PersonSearchPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; characters: PersonHit[] | null } }>(
    CHARACTER_SEARCH_QUERY,
    { search: term, page },
  );
  return { pageInfo: data.Page.pageInfo, rows: data.Page.characters ?? [] };
}

export async function searchStaff(
  term: string,
  page: number,
): Promise<PersonSearchPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; staff: PersonHit[] | null } }>(
    STAFF_SEARCH_QUERY,
    { search: term, page },
  );
  return { pageInfo: data.Page.pageInfo, rows: data.Page.staff ?? [] };
}

export async function searchStudios(
  term: string,
  page: number,
): Promise<StudioSearchPage> {
  const data = await gql<{ Page: { pageInfo: PageInfo; studios: StudioHit[] | null } }>(
    STUDIO_SEARCH_QUERY,
    { search: term, page },
  );
  return { pageInfo: data.Page.pageInfo, rows: data.Page.studios ?? [] };
}

// --- Activities -----------------------------------------------------------

/** Profile tab and following feed; `MessageActivity` stays out of `type_in`, the fragments and the normalizer. */
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

/** One activity by id, where a notification lands; the feed's two fragments, and no `MessageActivity` either. */
export const SINGLE_ACTIVITY_QUERY = `
query ($id: Int!) {
  Activity(id: $id) {
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
}`;

export async function singleActivity(id: number): Promise<unknown | null> {
  const data = await gql<{ Activity: unknown | null }>(SINGLE_ACTIVITY_QUERY, { id });
  return data.Activity ?? null;
}

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
      // A pin floats on its own profile while a feed stays a timeline; both are total orders, as paging needs.
      sort: "userId" in vars ? ["PINNED", "ID_DESC"] : ["ID_DESC"],
    },
  );
  return { pageInfo: data.Page.pageInfo, activities: data.Page.activities ?? [] };
}

// --- Mutations ------------------------------------------------------------

/** Returns only the fields the cache patch needs, so a follow never costs a refetch. */
export const TOGGLE_FOLLOW_MUTATION = `
mutation ($userId: Int!) {
  ToggleFollow(userId: $userId) { id name isFollowing isFollower }
}`;

/** Likes for anything likeable; `MessageActivity` gets no fragment, so private mail cannot round-trip. */
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

/** Replies to one activity, loaded per expansion rather than nested in `ACTIVITY_QUERY`; they are flat. */
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

/** Post a status update, a carve-out CLAUDE.md records; answers in the `ACTIVITY_QUERY` shape for the feed. */
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

/** Pin or unpin one of the viewer's activities; the profile feed sorts pinned first, so a pin floats. */
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

/** A list of threads with no `body`; sorted `REPLIED_AT_DESC`, a total order, which paging needs. */
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

/** Threads one user started; do not add `replyUserId`, it lists only threads where the user replied last. */
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

/** `replyCommentId` is the newest-reply jump's key; `lib/threadJump` resolves it past the paging cap. */
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

/** A page of comments; `childComments` is an untyped Json scalar, and `sort` is inert on the `threadId` shape. */
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

/** The tree a comment sits in, uncapped as a LIST field; never alias it, one not-found root nulls every sibling. */
export const THREAD_COMMENT_TREE_QUERY = `
query ($id: Int!) {
  ThreadComment(id: $id) {
    id comment likeCount isLiked createdAt siteUrl
    user { ${SOCIAL_USER} }
    childComments
  }
}`;

/** The newest reply's conversation in one request, shaped for `flattenComments`; empty when deleted. */
export async function threadCommentTree(id: number): Promise<unknown[]> {
  const data = await gql<{ ThreadComment: unknown[] | null }>(
    THREAD_COMMENT_TREE_QUERY,
    { id },
  );
  return data.ThreadComment ?? [];
}

/** One user's forum comments, newest first; `sort` is honoured on the `userId` shape and inert on `threadId`. */
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

/** Creates a thread; create-only by decision, since editing and deleting stay on anilist.co. */
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

/** `UpdateUser`; keep `animeListOptions` and `mangaListOptions` out, since `customLists` is a full replacement. */
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

/** The viewer's notification options, read fresh on their own key since `UpdateUser` replaces the array. */
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

/** AniList's forum categories, hardcoded because no root query lists them; a new one still shows under "All". */
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

/** The forum index; `sort` is a variable because search wants `SEARCH_MATCH` and browsing `REPLIED_AT_DESC`. */
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
      // A search sorted by activity buries the match; browsing sorted by relevance is meaningless.
      sort: vars.search ? ["SEARCH_MATCH"] : ["IS_STICKY", "REPLIED_AT_DESC"],
    },
  );
  return { pageInfo: data.Page.pageInfo, threads: data.Page.threads ?? [] };
}

// --- Reviews ---------------------------------------------------------------

/** A title's reviews, best-rated first; `body` is markdown (never `asHtml`) so the social renderer applies. */
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

/** The viewer's own review, the composer's prefill; `private` comes along so the composer never resets it. */
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

/** A foreign list, read-only; never `fetchMediaList`, whose cache write and queue drain are for your own list. */
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

/** The bell's site view; ActivityMessageNotification stays out of type_in, the fragments and the normalizer. */
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
      ... on AiringNotification { id createdAt episode media { id title { romaji english native } isAdult genres } }
      ... on FollowingNotification { id createdAt user { id name } }
      ... on ActivityMentionNotification { id createdAt activityId user { id name } }
      ... on ActivityReplyNotification { id createdAt activityId user { id name } }
      ... on ActivityReplySubscribedNotification { id createdAt activityId user { id name } }
      ... on ActivityLikeNotification { id createdAt activityId user { id name } }
      ... on ActivityReplyLikeNotification { id createdAt activityId user { id name } }
      ... on ThreadCommentMentionNotification { id createdAt commentId user { id name } thread { id title } }
      ... on ThreadCommentReplyNotification { id createdAt commentId user { id name } thread { id title } }
      ... on ThreadCommentSubscribedNotification { id createdAt commentId user { id name } thread { id title } }
      ... on ThreadCommentLikeNotification { id createdAt commentId user { id name } thread { id title } }
      ... on ThreadLikeNotification { id createdAt user { id name } thread { id title } }
      ... on RelatedMediaAdditionNotification { id createdAt media { id title { romaji english native } isAdult genres } }
      ... on MediaDataChangeNotification { id createdAt reason media { id title { romaji english native } isAdult genres } }
      ... on MediaMergeNotification { id createdAt reason deletedMediaTitles media { id title { romaji english native } isAdult genres } }
      ... on MediaDeletionNotification { id createdAt reason deletedMediaTitle }
      ... on MediaSubmissionUpdateNotification { id createdAt status submittedTitle media { id title { romaji english native } isAdult genres } }
      ... on StaffSubmissionUpdateNotification { id createdAt status staff { id name { full } } }
      ... on CharacterSubmissionUpdateNotification { id createdAt status character { id name { full } } }
    }
  }
}`;

export interface SiteNotifPage {
  pageInfo: PageInfo;
  rows: SiteNotifRow[];
}

/** `reset` is AniList's own mark-seen and belongs on the first page only; later pages are history, not news. */
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

/** How much is waiting, for the bell's badge; one scalar off the viewer, and the feed's mark-seen zeroes it. */
export const SITE_NOTIF_COUNT_QUERY = `
query { Viewer { unreadNotificationCount } }`;

export async function siteNotifCount(): Promise<number> {
  const data = await gql<{ Viewer: { unreadNotificationCount: number | null } | null }>(
    SITE_NOTIF_COUNT_QUERY,
  );
  return data.Viewer?.unreadNotificationCount ?? 0;
}

// --- Favourites -----------------------------------------------------------

/** Toggle a favourite, one id per call; the caller patches its own cache from success, not from the response. */
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

/** Every favourite of every kind, all five connections on one page counter, so the common case is one request. */
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

/** Favourite people and their birthdays for the dashboard digest; a truncated read only shortens a greeting. */
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

/** Reorder one kind's favourites; a whole-set replace, so the caller always sends every id from a fresh read. */
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

/** Characters, staff and studios; a studio's media edge is `isMainStudio`, not the `isMain` of `StudioEdge`. */

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

/** `asHtml: false` on purpose: the description is markdown, rendered by `lib/anilistMarkdown` like a bio. */
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
