import { gql } from "./anilist";
import type { Media, MediaType } from "./types";

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
  } | null;
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

// --- Mutations ------------------------------------------------------------

/**
 * Returns the fields the cache patch needs and nothing else, so a follow never
 * costs a refetch.
 */
export const TOGGLE_FOLLOW_MUTATION = `
mutation ($userId: Int!) {
  ToggleFollow(userId: $userId) { id name isFollowing isFollower }
}`;

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
