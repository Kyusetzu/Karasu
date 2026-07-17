export interface Viewer {
  id: number;
  name: string;
  siteUrl: string;
  avatar: { large: string | null } | null;
}

export type MediaListStatus =
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "DROPPED"
  | "PAUSED"
  | "REPEATING";

export interface MediaTitle {
  romaji: string | null;
  english: string | null;
  native: string | null;
}

export interface Media {
  id: number;
  title: MediaTitle;
  coverImage: { large: string | null; extraLarge: string | null };
  bannerImage: string | null;
  episodes: number | null;
  format: string | null;
  status: string | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  genres: string[];
  synonyms: string[];
  nextAiringEpisode: { episode: number; airingAt: number } | null;
}

export interface MediaListEntry {
  id: number;
  mediaId: number;
  status: MediaListStatus;
  score: number;
  progress: number;
  repeat: number;
  updatedAt: number;
  media: Media;
}

export interface MediaListGroup {
  name: string;
  status: MediaListStatus;
  entries: MediaListEntry[];
}

/** Bevorzugter Anzeigetitel: Englisch, sonst Romaji, sonst Nativ. */
export function displayTitle(title: MediaTitle): string {
  return title.english ?? title.romaji ?? title.native ?? "Unbekannt";
}
