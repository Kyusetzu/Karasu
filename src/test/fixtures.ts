import type { ListResult, Media, MediaListEntry, MediaListGroup } from "@/api/types";
import type { NowPlaying, ScrobbleState } from "@/stores/nowPlaying";

/** Complete, typed fixtures for both vitest projects; nothing here touches the DOM, React or Testing Library. */

/** A finished 26-episode TV anime with every field the list queries carry, so a test overrides only what it is about. */
export function media(over: Partial<Media> = {}): Media {
  return {
    id: 1,
    type: "ANIME",
    title: { romaji: "Cowboy Bebop", english: "Cowboy Bebop", native: "カウボーイビバップ" },
    coverImage: { large: "https://img.example/bebop.jpg" },
    episodes: 26,
    chapters: null,
    volumes: null,
    duration: 24,
    format: "TV",
    status: "FINISHED",
    season: "SPRING",
    seasonYear: 1998,
    averageScore: 86,
    genres: ["Action", "Sci-Fi"],
    isAdult: false,
    synonyms: [],
    nextAiringEpisode: null,
    ...over,
  };
}

/** A watching entry four episodes in, on the media above unless told otherwise. */
export function entry(over: Partial<MediaListEntry> = {}): MediaListEntry {
  const m = over.media ?? media();
  return {
    id: 55,
    mediaId: m.id,
    status: "CURRENT",
    score: 8,
    progress: 4,
    progressVolumes: 0,
    repeat: 0,
    notes: null,
    updatedAt: 0,
    private: false,
    hiddenFromStatusLists: false,
    customLists: {},
    advancedScores: {},
    startedAt: null,
    completedAt: null,
    ...over,
    media: m,
  };
}

/** One status group holding the given entries; the shape every list screen reads and `findCachedMedia` scans. */
export function listResult(entries: MediaListEntry[] = [entry()], over: Partial<ListResult> = {}): ListResult {
  const group: MediaListGroup = { name: "Watching", status: "CURRENT", isCustomList: false, entries };
  return { fromCache: false, pending: 0, fetchedAt: 0, lists: [group], ...over };
}

/** Episode 5 of the media above detected in mpv, matched to the list, one ahead of the entry's progress. */
export function nowPlaying(over: Partial<NowPlaying> = {}): NowPlaying {
  return {
    process: "mpv.exe",
    streaming: false,
    mediaType: "ANIME",
    rawTitle: "[Grp] Cowboy Bebop - 05.mkv",
    parsedTitle: "Cowboy Bebop",
    season: null,
    episode: 5,
    sourceEpisode: 5,
    mediaId: 1,
    matchedTitle: "Cowboy Bebop",
    overridden: false,
    progress: 4,
    totalEpisodes: 26,
    episodeTitle: "Asteroid Blues",
    ...over,
  };
}

/** The scrobbler with nothing armed; a test that wants a phase spreads over it. */
export function idleScrobble(over: Partial<ScrobbleState> = {}): ScrobbleState {
  return {
    phase: "idle",
    reason: null,
    forceable: false,
    mediaId: null,
    episode: null,
    updateAtMs: null,
    armedAtMs: null,
    yieldingTo: null,
    ...over,
  };
}
