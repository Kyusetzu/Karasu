import { invoke } from "@tauri-apps/api/core";
import type { MediaListGroup, Viewer } from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

// --- Account / Auth -------------------------------------------------------

export const getClientId = () => invoke<string | null>("get_client_id");
export const setClientId = (clientId: string) =>
  invoke<void>("set_client_id", { clientId });
export const loginUrl = () => invoke<string>("anilist_login_url");
export const connect = (token: string) =>
  invoke<Viewer>("anilist_connect", { token });
export const session = () => invoke<Viewer | null>("anilist_session");
export const logout = () => invoke<void>("anilist_logout");

// --- GraphQL --------------------------------------------------------------

export function gql<T>(query: string, variables?: object): Promise<T> {
  return invoke<T>("anilist_query", { query, variables });
}

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  coverImage { large extraLarge }
  bannerImage
  episodes
  format
  status
  season
  seasonYear
  averageScore
  genres
  synonyms
  nextAiringEpisode { episode airingAt }
`;

const LIST_QUERY = `
query ($userId: Int!) {
  MediaListCollection(userId: $userId, type: ANIME) {
    lists {
      name
      status
      entries {
        id
        mediaId
        status
        score(format: POINT_10)
        progress
        repeat
        updatedAt
        media { ${MEDIA_FIELDS} }
      }
    }
  }
}`;

export async function fetchAnimeList(userId: number): Promise<MediaListGroup[]> {
  const data = await gql<{
    MediaListCollection: { lists: MediaListGroup[] };
  }>(LIST_QUERY, { userId });
  return data.MediaListCollection.lists;
}
