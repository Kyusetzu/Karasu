import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { fetchAnimeList } from "@/api/anilist";
import { displayTitle } from "@/api/types";
import { Button } from "@/components/ui/button";

export default function AnimeList() {
  const viewer = useAuth((s) => s.viewer);
  const loading = useAuth((s) => s.loading);

  if (loading) return null;

  if (!viewer) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="text-center">
          <p className="text-ink-500">
            Verbinde dich mit AniList, um deine Liste zu sehen.
          </p>
          <Link to="/settings">
            <Button className="mt-4">Zu den Einstellungen</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <ListView userId={viewer.id} />;
}

function ListView({ userId }: { userId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["animeList", userId],
    queryFn: () => fetchAnimeList(userId),
  });

  if (isLoading) {
    return <p className="p-8 text-ink-500">Lade deine Liste …</p>;
  }
  if (error) {
    return (
      <p className="p-8 text-red-300">Fehler beim Laden: {String(error)}</p>
    );
  }

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-bold">Meine Liste</h1>
      {data?.map((group) => (
        <section key={group.name}>
          <h2 className="mb-3 text-lg font-semibold text-ink-300">
            {group.name}{" "}
            <span className="text-sm text-ink-600">
              ({group.entries.length})
            </span>
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
            {group.entries.map((entry) => (
              <Link
                key={entry.id}
                to={`/anime/${entry.mediaId}`}
                className="group"
              >
                <div className="aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
                  {entry.media.coverImage.large && (
                    <img
                      src={entry.media.coverImage.large}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-medium text-ink-300 group-hover:text-ink-100">
                  {displayTitle(entry.media.title)}
                </p>
                <p className="text-xs text-ink-600">
                  {entry.progress}
                  {entry.media.episodes ? ` / ${entry.media.episodes}` : ""}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
