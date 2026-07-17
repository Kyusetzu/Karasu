import { Link } from "react-router-dom";
import { MonitorPlay, Tv } from "lucide-react";
import { useNowPlaying } from "@/stores/nowPlaying";

/** Banner für die aktuell erkannte Wiedergabe (Dashboard). */
export default function NowPlayingCard() {
  const current = useNowPlaying((s) => s.current);
  if (!current) return null;

  const title = current.matchedTitle ?? current.parsedTitle;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-accent-600/40 bg-gradient-to-r from-accent-600/15 to-transparent p-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
        {current.streaming ? <Tv size={20} /> : <MonitorPlay size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-accent-400">
          Läuft gerade · {current.process.replace(".exe", "")}
        </p>
        <p className="truncate font-semibold">
          {current.mediaId ? (
            <Link to={`/anime/${current.mediaId}`} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
          {current.episode !== null && (
            <span className="text-ink-300"> — Episode {current.episode}</span>
          )}
        </p>
        {current.mediaId ? (
          <p className="text-xs text-ink-500">
            Dein Fortschritt: {current.progress}
            {current.totalEpisodes ? ` / ${current.totalEpisodes}` : ""}
          </p>
        ) : (
          <p className="text-xs text-ink-500">
            Kein Eintrag deiner Liste erkannt.
          </p>
        )}
      </div>
    </div>
  );
}
