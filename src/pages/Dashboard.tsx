import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, Play, Plus } from "lucide-react";
import { fetchAnimeList } from "@/api/anilist";
import { displayTitle, type MediaListEntry } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useListMutations } from "@/hooks/useListMutations";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const viewer = useAuth((s) => s.viewer);
  const loading = useAuth((s) => s.loading);

  if (loading) return null;

  if (!viewer) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold">Willkommen bei Karasu 🐦‍⬛</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Dein Anime-Tracker für AniList. Verbinde deinen Account, um deine
            Liste zu verwalten und deinen Fortschritt automatisch zu tracken.
          </p>
          <Link to="/settings">
            <Button className="mt-5">Mit AniList verbinden</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <DashboardContent userId={viewer.id} />;
}

function DashboardContent({ userId }: { userId: number }) {
  const { data } = useQuery({
    queryKey: ["animeList", userId],
    queryFn: () => fetchAnimeList(userId),
  });
  const { save } = useListMutations(userId);

  const watching = useMemo(() => {
    const entries =
      data?.lists
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter((e) => e.status === "CURRENT" || e.status === "REPEATING") ??
      [];
    return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [data]);

  const upcoming = useMemo(() => {
    const entries =
      data?.lists
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter(
          (e) =>
            e.media.nextAiringEpisode &&
            (e.status === "CURRENT" ||
              e.status === "REPEATING" ||
              e.status === "PLANNING"),
        ) ?? [];
    return [...entries].sort(
      (a, b) =>
        a.media.nextAiringEpisode!.airingAt - b.media.nextAiringEpisode!.airingAt,
    );
  }, [data]);

  return (
    <div className="space-y-8 p-8">
      <section>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Play size={18} className="text-accent-400" /> Weiterschauen
        </h2>
        {watching.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">
            Du schaust gerade nichts — stöbere in der{" "}
            <Link to="/seasonal" className="text-accent-400 hover:underline">
              aktuellen Saison
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {watching.map((entry) => (
              <ContinueCard
                key={entry.id}
                entry={entry}
                onPlusOne={() =>
                  save.mutate({
                    mediaId: entry.mediaId,
                    progress: entry.progress + 1,
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock size={18} className="text-accent-400" /> Demnächst
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">
            Keine anstehenden Episoden in deiner Liste.
          </p>
        ) : (
          <div className="mt-4 space-y-1">
            {upcoming.slice(0, 10).map((entry) => (
              <AiringRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ContinueCard({
  entry,
  onPlusOne,
}: {
  entry: MediaListEntry;
  onPlusOne: () => void;
}) {
  const { media } = entry;
  const canPlus = media.episodes === null || entry.progress < media.episodes;
  const pct = media.episodes ? (entry.progress / media.episodes) * 100 : 0;

  return (
    <div className="group w-36 shrink-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
        <Link to={`/anime/${media.id}`}>
          {media.coverImage.large && (
            <img
              src={media.coverImage.large}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </Link>
        {canPlus && (
          <button
            onClick={onPlusOne}
            className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-white opacity-0 transition-opacity hover:bg-accent-500 group-hover:opacity-100"
            aria-label="Episode +1"
            title={`Episode ${entry.progress + 1} gesehen`}
          >
            <Plus size={16} />
          </button>
        )}
        {media.episodes !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div
              className="h-full bg-accent-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>
      <Link to={`/anime/${media.id}`}>
        <p className="mt-2 line-clamp-2 text-xs font-medium text-ink-300 group-hover:text-ink-100">
          {displayTitle(media.title)}
        </p>
      </Link>
      <p className="text-xs text-ink-600">
        {entry.progress}
        {media.episodes ? ` / ${media.episodes}` : ""}
      </p>
    </div>
  );
}

function formatAiring(airingAt: number): string {
  const diff = airingAt * 1000 - Date.now();
  if (diff <= 0) return "jetzt";
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days} T ${hours % 24} Std`;
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return `in ${hours} Std ${minutes} min`;
}

function AiringRow({ entry }: { entry: MediaListEntry }) {
  const airing = entry.media.nextAiringEpisode!;
  return (
    <Link
      to={`/anime/${entry.media.id}`}
      className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-900"
    >
      <img
        src={entry.media.coverImage.large ?? ""}
        alt=""
        loading="lazy"
        className="h-12 w-9 rounded object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">
          {displayTitle(entry.media.title)}
        </p>
        <p className="text-xs text-ink-600">
          Episode {airing.episode}
          {entry.progress < airing.episode - 1 &&
            ` · du bist bei ${entry.progress}`}
        </p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-accent-400">
        {formatAiring(airing.airingAt)}
      </span>
    </Link>
  );
}
