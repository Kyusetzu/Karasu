/** What the season hero says about episodes, as a closed key union the component maps through a literal switch. */
export type HeroEpisodes =
  | { key: "aired"; n: number; total: number }
  | { key: "airedOpen"; n: number }
  | { key: "total"; n: number }
  | null;

/** A running show counts what has aired, since "12 / 12" reads as finished; one episode says nothing the format does not. */
export function heroEpisodes(media: {
  status: string | null;
  episodes: number | null;
  nextAiringEpisode: { episode: number } | null;
}): HeroEpisodes {
  const next = media.nextAiringEpisode?.episode;
  if (media.status === "RELEASING" && next != null) {
    const aired = Math.max(0, next - 1);
    return media.episodes != null ? { key: "aired", n: aired, total: media.episodes } : { key: "airedOpen", n: aired };
  }
  return media.episodes != null && media.episodes > 1 ? { key: "total", n: media.episodes } : null;
}
