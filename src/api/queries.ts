import { gql } from "./anilist";
import type { Media, MediaListStatus, MediaTitle, MediaType } from "./types";

/** Media fields for discovery grids, including the user's own list entry. */
const MEDIA_FIELDS = `
  id
  type
  title { romaji english native }
  coverImage { large extraLarge }
  bannerImage
  episodes
  chapters
  volumes
  format
  status
  season
  seasonYear
  averageScore
  genres
  synonyms
  nextAiringEpisode { episode airingAt }
  mediaListEntry { id status progress score(format: POINT_10) repeat notes }
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

const SEARCH_QUERY = `
query ($search: String!, $type: MediaType!, $page: Int) {
  Page(page: $page, perPage: 30) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
  }
}`;

export async function searchMedia(search: string, type: MediaType, page = 1) {
  const data = await gql<{
    Page: { pageInfo: { hasNextPage: boolean }; media: MediaWithListStatus[] };
  }>(SEARCH_QUERY, { search, type, page });
  return data.Page;
}

const SEASONAL_QUERY = `
query ($season: MediaSeason!, $year: Int!, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
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

export async function seasonalAnime(season: Season, year: number, page = 1) {
  const data = await gql<{
    Page: { pageInfo: { hasNextPage: boolean }; media: MediaWithListStatus[] };
  }>(SEASONAL_QUERY, { season, year, page });
  return data.Page;
}

const DETAIL_QUERY = `
query ($id: Int!) {
  Media(id: $id) {
    ${MEDIA_FIELDS}
    description
    duration
    studios(isMain: true) { nodes { name } }
    mediaListEntry { id status progress repeat score(format: POINT_10) }
    relations {
      edges {
        relationType
        node {
          id
          type
          title { romaji english native }
          coverImage { large }
          format
        }
      }
    }
  }
}`;

export interface MediaDetail extends MediaWithListStatus {
  description: string | null;
  duration: number | null;
  studios: { nodes: { name: string }[] };
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
      };
    }[];
  };
}

export async function animeDetail(id: number) {
  const data = await gql<{ Media: MediaDetail }>(DETAIL_QUERY, { id });
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
  image: { large: string | null } | null;
}

export interface Distribution {
  count: number;
  format?: string;
  status?: string;
  score?: number;
  releaseYear?: number;
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
        voiceActors(sort: COUNT_DESC) { voiceActor { id name { full } image { large } } ${STAT_ROW} }
        studios(sort: COUNT_DESC) { studio { id name } ${STAT_ROW} }
        staff(sort: COUNT_DESC) { staff { id name { full } image { large } } ${STAT_ROW} }
        formats { format count }
        statuses { status count }
        scores(sort: MEAN_SCORE) { score count }
        releaseYears(sort: ID_DESC) { releaseYear count }
      }
      manga {
        count
        meanScore
        standardDeviation
        chaptersRead
        volumesRead
        genres(sort: COUNT_DESC) { genre ${STAT_ROW} }
        tags(sort: COUNT_DESC) { tag { id name } ${STAT_ROW} }
        staff(sort: COUNT_DESC) { staff { id name { full } image { large } } ${STAT_ROW} }
        formats { format count }
        statuses { status count }
        scores(sort: MEAN_SCORE) { score count }
        releaseYears(sort: ID_DESC) { releaseYear count }
      }
    }
  }
}`;

export async function userStatistics(userId: number) {
  const data = await gql<{ User: UserStats }>(USER_STATS_QUERY, { id: userId });
  return data.User;
}

// --- Yearly wrap-up --------------------------------------------------------

const WRAPPED_QUERY = `
query ($userId: Int!, $type: MediaType!) {
  MediaListCollection(userId: $userId, type: $type, status: COMPLETED) {
    lists {
      isCustomList
      entries {
        progress
        score(format: POINT_10)
        completedAt { year }
        media {
          id
          duration
          genres
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
            title: MediaTitle;
          };
        }[];
      }[];
    };
  }>(WRAPPED_QUERY, { userId, type });

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
        title: e.media.title,
      });
    }
  }
  return out;
}
