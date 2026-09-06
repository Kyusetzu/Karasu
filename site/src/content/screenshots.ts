// Until the 2x capture session, the README's ten screenshots stand in
// (1280x696 JPEG). `process-screenshots.mjs` will regenerate this file with
// AVIF/WebP derivatives and real dimensions; the shape stays.
import welcome from "@/assets/screenshots/placeholder/welcome.jpg";
import overview from "@/assets/screenshots/placeholder/overview.jpg";
import library from "@/assets/screenshots/placeholder/local-library.jpg";
import animeGrid from "@/assets/screenshots/placeholder/anime-list.jpg";
import animeRows from "@/assets/screenshots/placeholder/anime-list-columns.jpg";
import mangaGrid from "@/assets/screenshots/placeholder/manga-list.jpg";
import mangaRows from "@/assets/screenshots/placeholder/manga-list-columns.jpg";
import seasonal from "@/assets/screenshots/placeholder/season-overview.jpg";
import statistics from "@/assets/screenshots/placeholder/statistics.jpg";
import wrapped from "@/assets/screenshots/placeholder/year-in-review.jpg";

export interface Shot {
  id: string;
  kind: "desktop" | "phone";
  /** The largest source; `<Screenshot>` builds the `<picture>` from it. */
  src: string;
  width: number;
  height: number;
  /** One present-tense sentence naming the screen and what is on it. */
  alt: string;
  caption: string;
}

const desktop = (id: string, src: string, alt: string, caption: string): Shot => ({
  id,
  kind: "desktop",
  src,
  width: 1280,
  height: 696,
  alt,
  caption,
});

export const SHOTS: Shot[] = [
  desktop("overview", overview, "The Overview shows this week's airing episodes, the titles in progress and a row of recommendations.", "Overview — what's airing, what you're in the middle of, recommendations"),
  desktop("anime-grid", animeGrid, "The anime list as a cover grid with status tabs, filters and saved presets above it.", "Anime list, grid view"),
  desktop("anime-rows", animeRows, "The anime list as rows, with progress and score editable in place.", "Anime list, rows — progress and score edited in place"),
  desktop("manga-grid", mangaGrid, "The manga list as a cover grid, counted in chapters and volumes.", "Manga list, grid view"),
  desktop("manga-rows", mangaRows, "The manga list as rows.", "Manga list, rows"),
  desktop("library", library, "The local library lists scanned files matched to list entries, next unwatched episode first.", "Local library — files matched to your list, next unwatched first"),
  desktop("seasonal", seasonal, "The Seasonal page shows a year of seasons above the grid for one of them.", "Seasonal — a year row over a season grid"),
  desktop("statistics", statistics, "The Statistics page with hand-drawn charts over genres, scores and hours.", "Statistics"),
  desktop("wrapped", wrapped, "The year-in-review poster with its preset crops.", "Year in review"),
  desktop("welcome", welcome, "The first-run screen offers to connect with AniList or to start without an account.", "First launch — connect with AniList, or start local-only"),
];

export const shot = (id: string): Shot => {
  const s = SHOTS.find((x) => x.id === id);
  if (!s) throw new Error(`no screenshot ${id}`);
  return s;
};
