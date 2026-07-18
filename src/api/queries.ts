import { gql } from "./anilist";
import type { Media, MediaListStatus, MediaType } from "./types";

/** Media-Felder für Discovery-Grids, inkl. eigenem Listen-Eintrag. */
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
  mediaListEntry { id status progress score(format: POINT_10) }
`;

export interface ListEntryStub {
  id: number;
  status: MediaListStatus;
  progress: number;
  score: number;
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
  mediaListEntry: (ListEntryStub & { repeat: number }) | null;
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
