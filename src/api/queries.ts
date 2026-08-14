import { currentScoreFormat, gql } from "./anilist";
import { normalizeStatsBlock } from "@/lib/score";
import type { ScoreFormat } from "@/lib/scoreFormat";
import { adultVars } from "@/lib/contentFilter";
import { chunk } from "@/lib/chunk";
import type {
  FuzzyDate,
  Media,
  MediaListStatus,
  MediaTitle,
  MediaType,
} from "./types";
// Re-exported because several stats/detail consumers import it from here.
export type { FuzzyDate };

/**
 * Every query that spreads `MEDIA_FIELDS` (or otherwise selects an entry's
 * `score`) must declare `$scoreFormat: ScoreFormat` and spread this into its
 * variables — scores arrive in the account's own scale, which is what every
 * control and cell renders since the scoreRaw change made writes match.
 */
const scoreFormatVar = () => ({ scoreFormat: currentScoreFormat() });

/** Media fields for discovery grids, including the user's own list entry. */
const MEDIA_FIELDS = `
  id
  type
  title { romaji english native }
  coverImage { large }
  episodes
  chapters
  volumes
  format
  countryOfOrigin
  status
  season
  seasonYear
  averageScore
  genres
  synonyms
  isAdult
  nextAiringEpisode { episode airingAt }
  mediaListEntry { id status progress score(format: $scoreFormat) repeat notes }
`;

export interface ListEntryStub {
  id: number;
  status: MediaListStatus;
  progress: number;
  score: number;
  repeat: number;
  notes: string | null;
}

export interface MediaWithListStatus extends Media {
  type: MediaType;
  mediaListEntry: ListEntryStub | null;
}

// `$isAdult` is filtered server-side rather than after the fact: a page
// filtered only on arrival can come back almost empty and read as "no
// results".
const SEARCH_QUERY = `
query ($search: String!, $type: MediaType!, $page: Int, $isAdult: Boolean, $scoreFormat: ScoreFormat) {
  Page(page: $page, perPage: 30) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, sort: SEARCH_MATCH, isAdult: $isAdult) {
      ${MEDIA_FIELDS}
    }
  }
}`;

export async function searchMedia(
  search: string,
  type: MediaType,
  page = 1,
  isAdult?: boolean,
) {
  const data = await gql<{
    Page: { pageInfo: { hasNextPage: boolean }; media: MediaWithListStatus[] };
  }>(SEARCH_QUERY, { search, type, page, ...adultVars(isAdult), ...scoreFormatVar() });
  return data.Page;
}

const SEASONAL_QUERY = `
query ($season: MediaSeason!, $year: Int!, $page: Int, $isAdult: Boolean, $scoreFormat: ScoreFormat) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: $isAdult) {
      ${MEDIA_FIELDS}
    }
  }
}`;

export type Season = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export function currentSeason(): { season: Season; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const season: Season =
    month <= 3 ? "WINTER" : month <= 6 ? "SPRING" : month <= 9 ? "SUMMER" : "FALL";
  return { season, year: now.getFullYear() };
}

export async function seasonalAnime(
  season: Season,
  year: number,
  page = 1,
  isAdult?: boolean,
) {
  const data = await gql<{
    Page: { pageInfo: { hasNextPage: boolean }; media: MediaWithListStatus[] };
  }>(SEASONAL_QUERY, { season, year, page, ...adultVars(isAdult), ...scoreFormatVar() });
  return data.Page;
}

// --- Airing calendar --------------------------------------------------------

/**
 * A time window of the global airing schedule, deliberately slim.
 *
 * Not `MEDIA_FIELDS`: a calendar row draws a cover, a title and a time, and
 * list membership comes from the cached list rather than `mediaListEntry`
 * (free, and it works in local mode). `isAdult` and `genres` are here only so
 * `isBlocked` can run — `airingSchedules` takes no `isAdult` argument, so the
 * content filter can only happen client-side.
 *
 * `pageInfo.total` is the capped 5000 sentinel on this connection (measured),
 * so the caller pages by `hasNextPage` with a hard cap, never by `total`.
 */
export const CALENDAR_QUERY = `
query ($gt: Int!, $lt: Int!, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $gt, airingAt_lesser: $lt, sort: TIME) {
      id
      episode
      airingAt
      media {
        id
        type
        title { romaji english native }
        coverImage { large }
        format
        isAdult
        genres
      }
    }
  }
}`;

export interface AiringSlot {
  id: number;
  episode: number;
  airingAt: number;
  media: Pick<
    Media,
    "id" | "type" | "title" | "coverImage" | "format" | "isAdult" | "genres"
  >;
}

/** More pages than any real week needs — measured at 3 for ~120 airings. */
const CALENDAR_MAX_PAGES = 5;

/**
 * Every airing in `(gt, lt]`, paged sequentially until AniList says stop or
 * the cap does. One user action spends at most `CALENDAR_MAX_PAGES` requests —
 * the bounded-traversal shape, not a fan-out.
 */
export async function airingWeek(gt: number, lt: number): Promise<AiringSlot[]> {
  const out: AiringSlot[] = [];
  for (let page = 1; page <= CALENDAR_MAX_PAGES; page++) {
    const data = await gql<{
      Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: AiringSlot[] };
    }>(CALENDAR_QUERY, { gt, lt, page });
    out.push(...data.Page.airingSchedules);
    if (!data.Page.pageInfo.hasNextPage) break;
  }
  return out;
}

// --- Sequels ----------------------------------------------------------------

/**
 * The direct relations of one title, slim — the season-split card's candidate
 * list. One request per card opened, on demand; the franchise page's BFS is
 * the wrong tool for "what comes after this", which is one hop by definition.
 */
export const SEQUELS_QUERY = `
query ($id: Int!) {
  Media(id: $id) {
    id
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          coverImage { large }
          format
          episodes
          status
          isAdult
          genres
          startDate { year }
        }
      }
    }
  }
}`;

export interface SequelCandidate {
  id: number;
  title: MediaTitle;
  coverImage: { large: string | null };
  format: string | null;
  episodes: number | null;
  status: string | null;
  /** For `isBlocked` — relations take no `isAdult` argument. */
  isAdult: boolean | null;
  genres: string[] | null;
  startDate: { year: number | null } | null;
}

/** SEQUEL edges of `id`, oldest first — the natural "next season" order. */
export async function sequelsOf(id: number): Promise<SequelCandidate[]> {
  const data = await gql<{
    Media: {
      relations: {
        edges: { relationType: string | null; node: SequelCandidate | null }[];
      } | null;
    } | null;
  }>(SEQUELS_QUERY, { id });
  return (data.Media?.relations?.edges ?? [])
    .filter((e) => e.relationType === "SEQUEL" && e.node)
    .map((e) => e.node!)
    .sort((a, b) => (a.startDate?.year ?? 9999) - (b.startDate?.year ?? 9999));
}

// --- Media by id -----------------------------------------------------------

const MEDIA_BY_IDS_QUERY = `
query ($ids: [Int], $scoreFormat: ScoreFormat) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      ${MEDIA_FIELDS}
    }
  }
}`;

/**
 * Media for a set of ids, batched into pages of 50.
 *
 * The local library can hold titles that are not on the user's list — a manual
 * match points files at whatever they choose, and the whole reason a title
 * needed correcting is usually that it was never on the list for the matcher to
 * find. Those rows have no cached list entry to draw from, so the media is
 * fetched directly.
 *
 * Relations are deliberately absent: `loadFranchise` asks for the same ids with
 * a relations tree attached and that query is expensive. This one only needs
 * enough to draw a row.
 */
export async function mediaByIds(ids: number[]): Promise<Media[]> {
  if (ids.length === 0) return [];
  const pages = await Promise.all(
    chunk(ids).map((batch) =>
      gql<{ Page: { media: Media[] } }>(MEDIA_BY_IDS_QUERY, {
        ids: batch,
        ...scoreFormatVar(),
      }),
    ),
  );
  return pages.flatMap((p) => p.Page.media);
}

// --- Recommendations -------------------------------------------------------

// One request covers every seed: `id_in` batches the completed entries and
// each carries its own recommendation list. Verified against the live schema —
// 25 seeds x 8 recommendations returns ~116 nodes without tripping AniList's
// query-complexity limit, so the whole feature costs one request per type.
const RECOMMENDATIONS_QUERY = `
query ($ids: [Int], $scoreFormat: ScoreFormat) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      recommendations(sort: RATING_DESC, perPage: 8) {
        nodes {
          rating
          mediaRecommendation { ${MEDIA_FIELDS} }
        }
      }
    }
  }
}`;

export interface RawRecommendationNode {
  seedId: number;
  rating: number;
  media: MediaWithListStatus;
}

/**
 * Community recommendations for a batch of media, flattened and paired with
 * the seed that produced each one. Ranking happens in `lib/recommend.ts`.
 */
export async function recommendationsFor(
  ids: number[],
): Promise<RawRecommendationNode[]> {
  if (ids.length === 0) return [];
  const data = await gql<{
    Page: {
      media: {
        id: number;
        recommendations: {
          nodes: {
            rating: number | null;
            mediaRecommendation: MediaWithListStatus | null;
          }[];
        } | null;
      }[];
    };
  }>(RECOMMENDATIONS_QUERY, { ids, ...scoreFormatVar() });

  const out: RawRecommendationNode[] = [];
  for (const seed of data.Page.media ?? []) {
    for (const node of seed.recommendations?.nodes ?? []) {
      // A recommendation whose target was deleted comes back as null.
      if (!node.mediaRecommendation) continue;
      out.push({
        seedId: seed.id,
        rating: node.rating ?? 0,
        media: node.mediaRecommendation,
      });
    }
  }
  return out;
}

// The extra selections live here rather than in MEDIA_FIELDS on purpose:
// MEDIA_FIELDS is shared with search (30/page) and seasonal (50/page), where
// this metadata would be dead weight. Detail is a single Media(id:) call, so
// widening it costs no extra request.
const DETAIL_QUERY = `
query ($id: Int!, $scoreFormat: ScoreFormat) {
  Media(id: $id) {
    ${MEDIA_FIELDS}
    coverImage { extraLarge }
    bannerImage
    description
    duration
    meanScore
    popularity
    favourites
    # Whether this viewer has favourited it, and whether they are allowed to.
    # The favourites field above is the global count — a different thing.
    # (No backticks in here: this is inside a JS template literal.)
    isFavourite
    isFavouriteBlocked
    hashtag
    source
    countryOfOrigin
    startDate { year month day }
    endDate { year month day }
    trailer { id site thumbnail }
    studios { edges { isMain node { id name } } }
    tags { name rank isMediaSpoiler }
    externalLinks { id site url type color }
    relations {
      edges {
        relationType
        node {
          id
          type
          title { romaji english native }
          coverImage { large }
          format
          isAdult
          genres
        }
      }
    }
  }
}`;

export interface MediaTag {
  name: string;
  rank: number | null;
  isMediaSpoiler: boolean;
}

export interface ExternalLink {
  id: number;
  site: string;
  url: string;
  /** SOCIAL | INFO | STREAMING */
  type: string | null;
  color: string | null;
}

export interface MediaDetail extends MediaWithListStatus {
  description: string | null;
  duration: number | null;
  meanScore: number | null;
  popularity: number | null;
  /** The global count. `isFavourite` below is this viewer's own flag. */
  favourites: number | null;
  isFavourite: boolean | null;
  /** AniList refuses the toggle for some entries; the button says so. */
  isFavouriteBlocked: boolean | null;
  hashtag: string | null;
  source: string | null;
  countryOfOrigin: string | null;
  startDate: FuzzyDate | null;
  endDate: FuzzyDate | null;
  trailer: { id: string; site: string; thumbnail: string | null } | null;
  studios: { edges: { isMain: boolean; node: { id: number; name: string } }[] };
  tags: MediaTag[];
  externalLinks: ExternalLink[];
  mediaListEntry: ListEntryStub | null;
  relations: {
    edges: {
      relationType: string;
      node: {
        id: number;
        type: "ANIME" | "MANGA";
        title: Media["title"];
        coverImage: { large: string | null };
        format: string | null;
        isAdult: boolean;
        genres: string[];
      };
    }[];
  };
}

export async function animeDetail(id: number) {
  const data = await gql<{ Media: MediaDetail }>(DETAIL_QUERY, {
    id,
    ...scoreFormatVar(),
  });
  return data.Media;
}

// --- User statistics (Statistics tab) --------------------------------------

/** A ranked category row (genre/tag/voice actor/studio/staff). */
export interface StatEntry {
  count: number;
  meanScore: number;
  /** Watch time in minutes (anime); 0 for manga. */
  minutesWatched: number;
  /** Chapters read (manga); 0 for anime. */
  chaptersRead: number;
  /** Display name resolved per category by `statEntryLabel`. */
  genre?: string;
  tag?: { id: number; name: string };
  voiceActor?: NamedPerson;
  studio?: { id: number; name: string };
  staff?: NamedPerson;
}

export interface NamedPerson {
  id: number;
  name: { full: string };
  /**
   * `medium`, not `large`: the only consumer is a 32×32 circle in the
   * statistics rows. Measured on the live CDN, the large portrait is 19,073
   * bytes against 5,233 for medium — and "Show all" mounts dozens at once.
   */
  image: { medium: string | null } | null;
}

export interface Distribution {
  count: number;
  meanScore?: number;
  format?: string;
  status?: string;
  score?: number;
  releaseYear?: number;
  startYear?: number;
  /** Episode or chapter count bucket, as AniList spells it: "1", "13-26", … */
  length?: string;
  /** ISO country code of origin — JP, KR, CN, TW. */
  country?: string;
}

interface CommonStats {
  count: number;
  meanScore: number;
  standardDeviation: number;
  genres: StatEntry[];
  tags: StatEntry[];
  staff: StatEntry[];
  formats: Distribution[];
  statuses: Distribution[];
  scores: Distribution[];
  releaseYears: Distribution[];
  startYears: Distribution[];
  lengths: Distribution[];
  countries: Distribution[];
}

export interface AnimeStats extends CommonStats {
  minutesWatched: number;
  episodesWatched: number;
  voiceActors: StatEntry[];
  studios: StatEntry[];
}

export interface MangaStats extends CommonStats {
  chaptersRead: number;
  volumesRead: number;
}

export interface UserStats {
  id: number;
  name: string;
  statistics: { anime: AnimeStats; manga: MangaStats };
}

// Shared fields on every ranked category row. Both time metrics are requested
// so a single TS shape covers anime (minutesWatched) and manga (chaptersRead).
const STAT_ROW = "count meanScore minutesWatched chaptersRead";

const USER_STATS_QUERY = `
query ($id: Int!) {
  User(id: $id) {
    id
    name
    statistics {
      anime {
        count
        meanScore
        standardDeviation
        minutesWatched
        episodesWatched
        genres(sort: COUNT_DESC) { genre ${STAT_ROW} }
        tags(sort: COUNT_DESC) { tag { id name } ${STAT_ROW} }
        voiceActors(sort: COUNT_DESC) { voiceActor { id name { full } image { medium } } ${STAT_ROW} }
        studios(sort: COUNT_DESC) { studio { id name } ${STAT_ROW} }
        staff(sort: COUNT_DESC) { staff { id name { full } image { medium } } ${STAT_ROW} }
        formats { format count meanScore }
        statuses { status count meanScore }
        scores(sort: MEAN_SCORE) { score count }
        releaseYears(sort: ID_DESC) { releaseYear count }
        startYears(sort: ID) { startYear count meanScore }
        lengths { length count meanScore }
        countries(sort: COUNT_DESC) { country count }
      }
      manga {
        count
        meanScore
        standardDeviation
        chaptersRead
        volumesRead
        genres(sort: COUNT_DESC) { genre ${STAT_ROW} }
        tags(sort: COUNT_DESC) { tag { id name } ${STAT_ROW} }
        staff(sort: COUNT_DESC) { staff { id name { full } image { medium } } ${STAT_ROW} }
        formats { format count meanScore }
        statuses { status count meanScore }
        scores(sort: MEAN_SCORE) { score count }
        releaseYears(sort: ID_DESC) { releaseYear count }
        startYears(sort: ID) { startYear count meanScore }
        lengths { length count meanScore }
        countries(sort: COUNT_DESC) { country count }
      }
    }
  }
}`;

/**
 * Everything the statistics screen reads, on the account's display scale.
 *
 * The endpoint mixes two scales and says so nowhere: `meanScore` and
 * `standardDeviation` — top level and on every ranked row — are always
 * AniList's internal hundred-point numbers, while the `scores` distribution
 * arrives in whatever format the user has chosen to *see*. Normalizing at the
 * boundary is the only place a reader does not have to remember which of the
 * two they are holding — and `normalizeStatsBlock` walks *every* ranked list
 * rather than the ones a given screen happens to render, which is what caught
 * `startYears.meanScore` arriving hundred-point for years, fetched and never
 * shown.
 */
export async function userStatistics(
  userId: number,
  format: ScoreFormat,
): Promise<UserStats> {
  const data = await gql<{ User: UserStats }>(USER_STATS_QUERY, { id: userId });
  const { anime, manga } = data.User.statistics;
  return {
    ...data.User,
    statistics: {
      anime: normalizeStatsBlock(anime, format),
      manga: normalizeStatsBlock(manga, format),
    },
  };
}

// --- Yearly wrap-up --------------------------------------------------------

const WRAPPED_QUERY = `
query ($userId: Int!, $type: MediaType!, $scoreFormat: ScoreFormat) {
  MediaListCollection(userId: $userId, type: $type, status: COMPLETED) {
    lists {
      isCustomList
      entries {
        progress
        score(format: $scoreFormat)
        completedAt { year }
        media {
          id
          duration
          genres
          isAdult
          title { romaji english native }
        }
      }
    }
  }
}`;

export interface WrappedEntry {
  mediaId: number;
  progress: number;
  score: number;
  year: number | null;
  duration: number | null;
  genres: string[];
  isAdult: boolean;
  title: MediaTitle;
}

/** Completed entries of one media type, de-duplicated across custom lists. */
export async function wrappedEntries(
  userId: number,
  type: MediaType,
): Promise<WrappedEntry[]> {
  const data = await gql<{
    MediaListCollection: {
      lists: {
        isCustomList: boolean;
        entries: {
          progress: number;
          score: number;
          completedAt: { year: number | null } | null;
          media: {
            id: number;
            duration: number | null;
            genres: string[];
            isAdult: boolean;
            title: MediaTitle;
          };
        }[];
      }[];
    };
  }>(WRAPPED_QUERY, { userId, type, ...scoreFormatVar() });

  const seen = new Set<number>();
  const out: WrappedEntry[] = [];
  for (const list of data.MediaListCollection.lists) {
    if (list.isCustomList) continue;
    for (const e of list.entries) {
      if (seen.has(e.media.id)) continue;
      seen.add(e.media.id);
      out.push({
        mediaId: e.media.id,
        progress: e.progress,
        score: e.score,
        year: e.completedAt?.year ?? null,
        duration: e.media.duration,
        genres: e.media.genres,
        isAdult: e.media.isAdult,
        title: e.media.title,
      });
    }
  }
  return out;
}
