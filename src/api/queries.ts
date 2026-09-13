import { currentScoreFormat, gql, TTL } from "./anilist";
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

/** Spread into every query that selects an entry's score, so scores arrive in the account's own scale. */
const scoreFormatVar = () => ({ scoreFormat: currentScoreFormat() });

/** Media fields for discovery grids, including the user's own list entry. */
const MEDIA_FIELDS = `
  id
  idMal
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

// `$isAdult` filters server-side: a page filtered only on arrival can come back nearly empty.
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
  }>(SEARCH_QUERY, { search, type, page, ...adultVars(isAdult), ...scoreFormatVar() }, { source: "search" });
  return data.Page;
}

/** The filterable search: an absent variable is no filter to AniList, so one query serves every combination. */
const BROWSE_QUERY = `
query ($search: String, $type: MediaType!, $page: Int, $isAdult: Boolean, $genreIn: [String], $genreNotIn: [String], $tagIn: [String], $tagNotIn: [String], $seasonYear: Int, $season: MediaSeason, $format: MediaFormat, $status: MediaStatus, $source: MediaSource, $countryOfOrigin: CountryCode, $sort: [MediaSort], $scoreFormat: ScoreFormat) {
  Page(page: $page, perPage: 30) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, isAdult: $isAdult, genre_in: $genreIn, genre_not_in: $genreNotIn, tag_in: $tagIn, tag_not_in: $tagNotIn, seasonYear: $seasonYear, season: $season, format: $format, status: $status, source: $source, countryOfOrigin: $countryOfOrigin, sort: $sort) {
      ${MEDIA_FIELDS}
    }
  }
}`;

/** Every `MediaSource` the enum has, verified by introspection; the labels live in `lib/format`'s `sourceLabel`. */
export const MEDIA_SOURCES = [
  "ORIGINAL",
  "MANGA",
  "LIGHT_NOVEL",
  "WEB_NOVEL",
  "NOVEL",
  "VISUAL_NOVEL",
  "VIDEO_GAME",
  "GAME",
  "DOUJINSHI",
  "ANIME",
  "LIVE_ACTION",
  "COMIC",
  "MULTIMEDIA_PROJECT",
  "PICTURE_BOOK",
  "OTHER",
] as const;

export interface BrowseFilters {
  search?: string;
  /** Genres that must all be present. */
  genreIn?: string[];
  /** Genres that must all be absent. */
  genreNotIn?: string[];
  tagIn?: string[];
  tagNotIn?: string[];
  seasonYear?: number;
  season?: Season;
  format?: string;
  status?: string;
  source?: string;
  countryOfOrigin?: string;
  /** A MediaSort value; defaults server-side matter, so always pass one. */
  sort: string;
}

export async function browseMedia(
  type: MediaType,
  filters: BrowseFilters,
  page = 1,
  isAdult?: boolean,
) {
  const data = await gql<{
    Page: { pageInfo: { hasNextPage: boolean }; media: MediaWithListStatus[] };
  }>(BROWSE_QUERY, {
    type,
    page,
    search: filters.search || undefined,
    // `undefined` rather than `[]`: an absent argument is no filter, while `genre_in: []` is a filter matching nothing.
    genreIn: filters.genreIn?.length ? filters.genreIn : undefined,
    genreNotIn: filters.genreNotIn?.length ? filters.genreNotIn : undefined,
    tagIn: filters.tagIn?.length ? filters.tagIn : undefined,
    tagNotIn: filters.tagNotIn?.length ? filters.tagNotIn : undefined,
    seasonYear: filters.seasonYear || undefined,
    season: filters.season || undefined,
    format: filters.format || undefined,
    status: filters.status || undefined,
    source: filters.source || undefined,
    countryOfOrigin: filters.countryOfOrigin || undefined,
    sort: [filters.sort],
    ...adultVars(isAdult),
    ...scoreFormatVar(),
  },
    { source: "search" },
  );
  return data.Page;
}

/** The server-defined filter vocabularies; adult-only tags carry their flag so the content filter can drop them. */
const GENRE_TAG_QUERY = `
query {
  GenreCollection
  MediaTagCollection { name isAdult }
}`;

export interface GenreTagCollections {
  genres: string[];
  tags: { name: string; isAdult: boolean | null }[];
}

export async function genreTagCollections(): Promise<GenreTagCollections> {
  const data = await gql<{
    GenreCollection: (string | null)[] | null;
    MediaTagCollection: { name: string; isAdult: boolean | null }[] | null;
  }>(GENRE_TAG_QUERY, {}, { source: "genreTags", ttlSec: TTL.week });
  return {
    genres: (data.GenreCollection ?? []).filter((g): g is string => !!g),
    tags: data.MediaTagCollection ?? [],
  };
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

/** The hero's handful of titles with banner art; CLAUDE.md's wide-image rule is about pages of thirty, not this. */
const SEASON_HERO_QUERY = `
query ($season: MediaSeason!, $year: Int!, $isAdult: Boolean) {
  Page(page: 1, perPage: 10) {
    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: $isAdult) {
      id
      type
      title { romaji english native }
      bannerImage
      coverImage { extraLarge large }
      format
      episodes
      averageScore
      genres
      isAdult
    }
  }
}`;

/** What the Overview's hero draws. A deliberate subset of `Media`. */
export interface HeroMedia {
  id: number;
  type: MediaType;
  title: MediaTitle;
  bannerImage: string | null;
  coverImage: { extraLarge: string | null; large: string | null };
  format: string | null;
  episodes: number | null;
  averageScore: number | null;
  genres: string[] | null;
  isAdult: boolean | null;
}

export async function seasonHero(
  season: Season,
  year: number,
  isAdult?: boolean,
): Promise<HeroMedia[]> {
  const data = await gql<{ Page: { media: HeroMedia[] } }>(SEASON_HERO_QUERY, {
    season,
    year,
    ...adultVars(isAdult),
  },
    { source: "seasonHero", ttlSec: 6 * TTL.hour },
  );
  return data.Page.media ?? [];
}

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
  }>(SEASONAL_QUERY, { season, year, page, ...adultVars(isAdult), ...scoreFormatVar() }, { source: "seasonal", ttlSec: 6 * TTL.hour });
  return data.Page;
}

// --- Airing calendar --------------------------------------------------------

/** A slim airing slice; `isAdult` and `genres` are for `isBlocked`, and paging goes by `hasNextPage`, never `total`. */
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

/** Every airing in `(gt, lt]`, paged in turn until AniList or the cap says stop: bounded traversal, never a fan-out. */
export async function airingWeek(gt: number, lt: number): Promise<AiringSlot[]> {
  const out: AiringSlot[] = [];
  for (let page = 1; page <= CALENDAR_MAX_PAGES; page++) {
    const data = await gql<{
      Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: AiringSlot[] };
    }>(CALENDAR_QUERY, { gt, lt, page }, { source: "calendar", ttlSec: lt < Math.floor(Date.now() / 1000) ? TTL.day : 30 * TTL.minute });
    out.push(...data.Page.airingSchedules);
    if (!data.Page.pageInfo.hasNextPage) break;
  }
  return out;
}

// --- Sequels ----------------------------------------------------------------

/** One title's direct relations for the season-split card: one hop on demand, not the franchise page's BFS. */
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
  }>(SEQUELS_QUERY, { id }, { source: "sequels" });
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

/** Media for ids the list cache lacks (a manual match can point off the list); batched, no costly relations. */
export async function mediaByIds(ids: number[]): Promise<Media[]> {
  if (ids.length === 0) return [];
  // Sequential rather than `Promise.all`: the limiter in `anilist/client.rs` cannot see a burst it has not sent yet.
  const out: Media[] = [];
  for (const batch of chunk(ids)) {
    const page = await gql<{ Page: { media: Media[] } }>(MEDIA_BY_IDS_QUERY, {
      ids: batch,
      ...scoreFormatVar(),
    },
      { source: "mediaByIds", ttlSec: TTL.day },
    );
    out.push(...page.Page.media);
  }
  return out;
}

// --- Recommendations -------------------------------------------------------

// One request covers every seed: `id_in` batches them and each carries its own recommendation list.
const RECOMMENDATIONS_QUERY = `
query ($ids: [Int], $scoreFormat: ScoreFormat) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      recommendations(sort: RATING_DESC, perPage: 8) {
        nodes {
          rating
          userRating
          mediaRecommendation { ${MEDIA_FIELDS} }
        }
      }
    }
  }
}`;

export interface RawRecommendationNode {
  seedId: number;
  rating: number;
  /** RATE_UP | RATE_DOWN | NO_RATING — this viewer's own vote. */
  userRating: string | null;
  media: MediaWithListStatus;
}

/** Votes on one pairing, keyed on (seed, suggestion) because that is what an AniList recommendation is. */
const SAVE_RECOMMENDATION_MUTATION = `
mutation ($mediaId: Int, $mediaRecommendationId: Int, $rating: RecommendationRating) {
  SaveRecommendation(mediaId: $mediaId, mediaRecommendationId: $mediaRecommendationId, rating: $rating) {
    id
    rating
    userRating
  }
}`;

export async function saveRecommendation(
  mediaId: number,
  mediaRecommendationId: number,
  rating: "RATE_UP" | "RATE_DOWN" | "NO_RATING",
): Promise<void> {
  await gql(SAVE_RECOMMENDATION_MUTATION, { mediaId, mediaRecommendationId, rating });
}

/** Recommendations for a batch of media, each paired with the seed that produced it; `lib/recommend.ts` ranks them. */
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
            userRating: string | null;
            mediaRecommendation: MediaWithListStatus | null;
          }[];
        } | null;
      }[];
    };
  }>(RECOMMENDATIONS_QUERY, { ids, ...scoreFormatVar() }, { source: "recommendations", ttlSec: 6 * TTL.hour });

  const out: RawRecommendationNode[] = [];
  for (const seed of data.Page.media ?? []) {
    for (const node of seed.recommendations?.nodes ?? []) {
      // A recommendation whose target was deleted comes back as null.
      if (!node.mediaRecommendation) continue;
      out.push({
        seedId: seed.id,
        rating: node.rating ?? 0,
        userRating: node.userRating ?? null,
        media: node.mediaRecommendation,
      });
    }
  }
  return out;
}

// The extra selections stay out of MEDIA_FIELDS: search and seasonal share it and would carry them as dead weight.
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
    # The community's own numbers: where scores land and which shelves the
    # title sits on. Labels are composed from type/season/year client-side —
    # the API's "context" strings are English-only prose.
    rankings { rank type year season allTime }
    stats {
      scoreDistribution { score amount }
      statusDistribution { status amount }
    }
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
  rankings: {
    rank: number;
    /** RATED | POPULAR */
    type: string;
    year: number | null;
    season: string | null;
    allTime: boolean | null;
  }[];
  stats: {
    scoreDistribution: { score: number; amount: number }[] | null;
    statusDistribution: { status: string; amount: number }[] | null;
  } | null;
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

/** Deliberately not on `DETAIL_QUERY`: the episode list multiplies the payload for a section most visits never open. */
const EPISODES_QUERY = `
query ($id: Int!) {
  Media(id: $id) {
    streamingEpisodes { title thumbnail url site }
  }
}`;

export interface StreamingEpisode {
  title: string | null;
  thumbnail: string | null;
  url: string | null;
  site: string | null;
}

export async function streamingEpisodes(id: number): Promise<StreamingEpisode[]> {
  const data = await gql<{ Media: { streamingEpisodes: StreamingEpisode[] | null } }>(
    EPISODES_QUERY,
    { id },
    { source: "episodes", ttlSec: TTL.week },
  );
  return data.Media.streamingEpisodes ?? [];
}

/** One `$page` drives both edge lists, one request per click; `pageInfo.total` is the capped sentinel, never read. */
const CAST_QUERY = `
query ($id: Int!, $page: Int) {
  Media(id: $id) {
    characters(page: $page, perPage: 12, sort: [ROLE, RELEVANCE, ID]) {
      pageInfo { hasNextPage }
      edges {
        role
        node { id name { full } image { medium } }
        voiceActors(language: JAPANESE, sort: RELEVANCE) {
          id
          name { full }
          image { medium }
        }
      }
    }
    staff(page: $page, perPage: 12, sort: RELEVANCE) {
      pageInfo { hasNextPage }
      edges { role node { id name { full } image { medium } } }
    }
  }
}`;

export interface CastPerson {
  id: number;
  name: { full: string | null };
  image: { medium: string | null };
}

export interface CastPage {
  characters: {
    /** MAIN | SUPPORTING | BACKGROUND */
    role: string | null;
    node: CastPerson;
    voiceActors: CastPerson[];
  }[];
  staff: {
    /** Free text from AniList ("Director", "Original Creator", …). */
    role: string | null;
    node: CastPerson;
  }[];
  hasMoreCharacters: boolean;
  hasMoreStaff: boolean;
}

export async function mediaCast(id: number, page: number): Promise<CastPage> {
  const data = await gql<{
    Media: {
      characters: {
        pageInfo: { hasNextPage: boolean | null };
        edges: CastPage["characters"];
      };
      staff: {
        pageInfo: { hasNextPage: boolean | null };
        edges: CastPage["staff"];
      };
    };
  }>(CAST_QUERY, { id, page }, { source: "cast", ttlSec: TTL.week });
  return {
    characters: data.Media.characters.edges ?? [],
    staff: data.Media.staff.edges ?? [],
    hasMoreCharacters: data.Media.characters.pageInfo.hasNextPage === true,
    hasMoreStaff: data.Media.staff.pageInfo.hasNextPage === true,
  };
}

/** The trending curve, one page of recent days (the part with a shape), fetched only when the fold opens. */
const TRENDS_QUERY = `
query ($id: Int!) {
  Page(perPage: 25) {
    mediaTrends(mediaId: $id, sort: DATE_DESC) { date trending }
  }
}`;

export interface MediaTrendPoint {
  /** Unix seconds. */
  date: number;
  trending: number;
}

export async function mediaTrends(id: number): Promise<MediaTrendPoint[]> {
  const data = await gql<{ Page: { mediaTrends: MediaTrendPoint[] | null } }>(
    TRENDS_QUERY,
    { id },
    { source: "trends", ttlSec: TTL.hour },
  );
  // DATE_DESC arrives newest-first; the chart reads left-to-right in time.
  return [...(data.Page.mediaTrends ?? [])].reverse();
}

export async function animeDetail(id: number) {
  const data = await gql<{ Media: MediaDetail }>(DETAIL_QUERY, {
    id,
    ...scoreFormatVar(),
  },
    { source: "mediaDetail", ttlSec: 30 * TTL.minute, mediaId: id },
  );
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
  /** Display name resolved per category by `entryLabel` in `RankedList`. */
  genre?: string;
  tag?: { id: number; name: string };
  voiceActor?: NamedPerson;
  studio?: { id: number; name: string };
  staff?: NamedPerson;
}

export interface NamedPerson {
  id: number;
  name: { full: string };
  /** `medium`, not `large`: the only consumer is a small circle in the statistics rows, and "Show all" mounts dozens. */
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
  /** AniList's own per-day activity record. Null on an account with none. */
  stats: { activityHistory: ActivityHistoryDay[] | null } | null;
  statistics: { anime: AnimeStats; manga: MangaStats };
}

// Shared fields on every ranked row; both time metrics are requested so one TS shape covers anime and manga.
const STAT_ROW = "count meanScore minutesWatched chaptersRead";

const USER_STATS_QUERY = `
query ($id: Int!) {
  User(id: $id) {
    id
    name
    # AniList's own record of when the account was active, per day. Karasu used
    # to derive a heatmap from list start/completion dates instead, which can
    # only ever see two events per entry and skips every fuzzy date that has no
    # month. This is the real thing, and it is two scalars on a request the
    # statistics screen already makes.
    stats { activityHistory { date amount } }
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

/** One day of AniList's own activity record. `date` is unix seconds, UTC. */
export interface ActivityHistoryDay {
  date: number;
  amount: number;
}

/** Everything the statistics screen reads, normalized here because AniList mixes two score scales. */
export async function userStatistics(
  userId: number,
  format: ScoreFormat,
): Promise<UserStats> {
  const data = await gql<{ User: UserStats }>(USER_STATS_QUERY, { id: userId }, { source: "userStats", ttlSec: TTL.hour });
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
          season
          seasonYear
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
  /** The *broadcast* season, as opposed to `year`, which is the completion year. */
  season: Season | null;
  seasonYear: number | null;
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
            season: Season | null;
            seasonYear: number | null;
            title: MediaTitle;
          };
        }[];
      }[];
    };
  }>(WRAPPED_QUERY, { userId, type, ...scoreFormatVar() }, { source: "wrapped" });

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
        season: e.media.season,
        seasonYear: e.media.seasonYear,
        title: e.media.title,
      });
    }
  }
  return out;
}

// --- MAL import resolution -------------------------------------------------

/** One chunk of MAL ids per call so the import can show progress; no `mediaListEntry`, local mode has no account. */
export const MAL_RESOLVE_QUERY = `
query ($idMal: [Int], $type: MediaType!, $page: Int) {
  Page(page: $page, perPage: 50) {
    media(idMal_in: $idMal, type: $type) {
      id
      idMal
      type
      title { romaji english native }
      coverImage { large }
      episodes
      chapters
      volumes
      duration
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
    }
  }
}`;

/** One chunk of ids; ids AniList has never heard of do not come back, and the caller counts them as unmatched. */
export async function resolveMalChunk(
  idsMal: number[],
  type: MediaType,
): Promise<Media[]> {
  if (idsMal.length === 0) return [];
  const data = await gql<{ Page: { media: Media[] } }>(MAL_RESOLVE_QUERY, {
    idMal: idsMal.slice(0, 50),
    type,
    page: 1,
  },
    { source: "malResolve" },
  );
  return data.Page.media ?? [];
}
