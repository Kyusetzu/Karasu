import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Check, MonitorPlay, Tv, X } from "lucide-react";
import {
  scrobbleCancel,
  scrobbleNow,
  useNowPlaying,
} from "@/stores/nowPlaying";
import { isTauri } from "@/api/anilist";
import { Button } from "@/components/ui/button";

function useCountdown(targetMs: number | null): string | null {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  useEffect(() => {
    if (targetMs === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [targetMs]);
  if (targetMs === null) return null;
  const diff = targetMs - Date.now();
  if (diff <= 0) return t("nowPlaying.soon");
  const min = Math.floor(diff / 60_000);
  const sec = Math.floor((diff % 60_000) / 1000);
  return min > 0 ? `${min} min ${sec} s` : `${sec} s`;
}

/** Banner für die aktuell erkannte Wiedergabe inkl. Scrobble-Status. */
export default function NowPlayingCard() {
  const current = useNowPlaying((s) => s.current);
  const scrobble = useNowPlaying((s) => s.scrobble);
  const countdown = useCountdown(
    scrobble.phase === "watching" ? scrobble.updateAtMs : null,
  );
  const qc = useQueryClient();
  const { t } = useTranslation();

  // Nach erfolgreichem Auto-Update die Liste neu laden
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    listen("scrobble-done", () => {
      qc.invalidateQueries({ queryKey: ["mediaList"] });
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, [qc]);

  if (!current) return null;

  const title = current.matchedTitle ?? current.parsedTitle;
  const isManga = current.mediaType === "MANGA";

  return (
    <div className="rounded-xl border border-accent-600/40 bg-gradient-to-r from-accent-600/15 to-transparent p-4">
      <div className="flex items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
          {isManga ? (
            <BookOpen size={20} />
          ) : current.streaming ? (
            <Tv size={20} />
          ) : (
            <MonitorPlay size={20} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-400">
            {t(isManga ? "nowPlaying.headingManga" : "nowPlaying.heading", {
              process: current.process.replace(".exe", ""),
            })}
          </p>
          <p className="truncate font-semibold">
            {current.mediaId ? (
              <Link to={`/media/${current.mediaId}`} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
            {current.episode !== null && (
              <span className="text-ink-300">
                {" "}
                —{" "}
                {t(isManga ? "common.chapter" : "common.episode", {
                  n: current.episode,
                })}
              </span>
            )}
          </p>
          <ScrobbleStatus countdown={countdown} />
        </div>
        <ScrobbleActions />
      </div>
    </div>
  );
}

function ScrobbleStatus({ countdown }: { countdown: string | null }) {
  const { t } = useTranslation();
  const current = useNowPlaying((s) => s.current);
  const scrobble = useNowPlaying((s) => s.scrobble);

  switch (scrobble.phase) {
    case "watching":
      return (
        <p className="text-xs text-ink-500">
          {countdown
            ? t("nowPlaying.updateIn", { time: countdown })
            : t(
                current?.mediaType === "MANGA"
                  ? "nowPlaying.reading"
                  : "nowPlaying.watching",
              )}
        </p>
      );
    case "pending":
      return (
        <p className="text-xs font-medium text-amber-300">
          {t(
            current?.mediaType === "MANGA"
              ? "nowPlaying.confirmPromptManga"
              : "nowPlaying.confirmPrompt",
            { n: scrobble.episode },
          )}
        </p>
      );
    case "updating":
      return <p className="text-xs text-ink-500">{t("nowPlaying.updating")}</p>;
    case "updated":
      return (
        <p className="flex items-center gap-1 text-xs font-medium text-emerald-400">
          <Check size={12} />{" "}
          {t("nowPlaying.updated", {
            n: t(
              current?.mediaType === "MANGA"
                ? "common.chapter"
                : "common.episode",
              { n: scrobble.episode },
            ),
          })}
        </p>
      );
    case "blocked":
      return (
        <p className="text-xs text-amber-300">
          {scrobble.reason ?? t("nowPlaying.blocked")}
        </p>
      );
    case "cancelled":
      return <p className="text-xs text-ink-500">{t("nowPlaying.skipped")}</p>;
    default:
      if (current?.mediaId) {
        return (
          <p className="text-xs text-ink-500">
            {t("nowPlaying.yourProgress", {
              progress: `${current.progress}${
                current.totalEpisodes ? ` / ${current.totalEpisodes}` : ""
              }`,
            })}
          </p>
        );
      }
      return <p className="text-xs text-ink-500">{t("nowPlaying.noMatch")}</p>;
  }
}

function ScrobbleActions() {
  const { t } = useTranslation();
  const scrobble = useNowPlaying((s) => s.scrobble);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (
    scrobble.phase === "pending" ||
    scrobble.phase === "blocked" ||
    scrobble.phase === "watching" ||
    scrobble.phase === "cancelled"
  ) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => act(scrobbleNow)}
          title={t("nowPlaying.updateNowTitle")}
        >
          <Check size={14} /> {t("nowPlaying.updateNow")}
        </Button>
        {scrobble.phase !== "cancelled" && scrobble.phase !== "blocked" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => act(scrobbleCancel)}
            title={t("nowPlaying.skipTitle")}
          >
            <X size={14} />
          </Button>
        )}
      </div>
    );
  }
  return null;
}
