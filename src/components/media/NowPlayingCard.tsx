import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Check, MonitorPlay, SearchCheck, Tv, X } from "lucide-react";
import {
  clearDetectionOverride,
  scrobbleCancel,
  scrobbleNow,
  setDetectionOverride,
  useNowPlaying,
  type BlockReason,
  type NowPlaying,
} from "@/stores/nowPlaying";
import { isTauri } from "@/api/anilist";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Presence } from "@/components/ui/presence";
import MatchPicker from "@/components/overlays/MatchPicker";
import { cn } from "@/lib/utils";
import { countdownFraction, ringOffset, splitRemaining } from "@/lib/countdown";
import { usePresentValue } from "@/hooks/usePresence";
import { canScrobbleCancel, canScrobbleNow } from "@/lib/actions";

/** Countdown text and ring fraction; both ends come from the backend, so a mid-session mount draws where the text says. */
function useCountdown(wait: {
  armedAtMs: number | null;
  updateAtMs: number | null;
}): {
  label: string | null;
  fraction: number;
} {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  const targetMs = wait.updateAtMs;
  const firstSeen = useRef<{ target: number; at: number } | null>(null);

  useEffect(() => {
    if (targetMs === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  if (targetMs === null) {
    firstSeen.current = null;
    return { label: null, fraction: 0 };
  }

  const now = Date.now();
  if (firstSeen.current?.target !== targetMs) {
    firstSeen.current = { target: targetMs, at: now };
  }
  // A stamp arriving without its twin pins the start at first sight rather than drawing a full ring.
  const armedAt = wait.armedAtMs ?? firstSeen.current.at;
  const diff = targetMs - now;

  const fraction = countdownFraction(armedAt, targetMs, now);
  if (diff <= 0) return { label: t("nowPlaying.soon"), fraction: 1 };
  const { minutes, seconds } = splitRemaining(diff);
  return {
    label: minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`,
    fraction,
  };
}

/** Circumference of the r=20 ring below, for the dash maths. */
const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

/** Banner for the currently detected playback, including scrobble state. */
export default function NowPlayingCard() {
  const current = useNowPlaying((s) => s.current);
  const scrobble = useNowPlaying((s) => s.scrobble);
  const countdown = useCountdown(
    // Blocked carries a time only for an armed episode gap, so one hook serves all three phases.
    scrobble.phase === "watching" ||
      scrobble.phase === "blocked" ||
      scrobble.phase === "yielding"
      ? scrobble
      : { armedAtMs: null, updateAtMs: null },
  );
  const qc = useQueryClient();
  const { t } = useTranslation();
  // Retained through the exit so the card animates away with its title rather than emptying first.
  const shown = usePresentValue(current);

  // Only the changed type, read from the store at fire time; keep the broad-key fallback or an absent type never refreshes.
  useEffect(() => {
    if (!isTauri) return;
    const registered = listen("scrobble-done", () => {
      const mediaType = useNowPlaying.getState().current?.mediaType;
      qc.invalidateQueries({
        queryKey: mediaType ? ["mediaList", mediaType] : ["mediaList"],
      });
    });
    return () => {
      // Await the registration itself: under StrictMode the cleanup runs before it settles and a variable is still empty.
      registered.then((un) => un());
    };
  }, [qc]);

  // Playback ending removed the card mid-frame, though it arrived with a rise.
  if (!shown.value) return null;
  const playing = shown.value;

  const title = playing.matchedTitle ?? playing.parsedTitle;
  const isManga = playing.mediaType === "MANGA";

  return (
    // Cut into the page rather than raised off it: the card arrives unprompted, so it announces itself without shouting.
    <div
      className={cn(
        "inset-well well-edge relative overflow-hidden rounded-[.875rem] px-4.5 py-4",
        shown.leaving ? "animate-rise-out" : "animate-rise-in",
      )}
    >
      {/* Its own element: the card's `animation` is spoken for by the entrance/exit and `inset-well` owns `box-shadow`. */}
      {scrobble.phase === "watching" && !shown.leaving && (
        <span
          aria-hidden
          className="animate-idle-glow pointer-events-none absolute inset-0 rounded-[.875rem]"
        />
      )}
      <div className="relative flex items-center gap-4">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
          {/* The wait drawn as a closing ring, and only while counting down: a static full ring reads as pending. */}
          {scrobble.phase === "watching" && countdown.label && (
            <svg
              className="absolute inset-0 size-11 -rotate-90"
              viewBox="0 0 44 44"
              aria-hidden
            >
              <circle
                cx="22"
                cy="22"
                r={RING_R}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={ringOffset(countdown.fraction, RING_C)}
                // A plain transition, so the reduce-motion rules reach it and the ring only stops sliding.
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>
          )}
          {isManga ? (
            <BookOpen className="size-5" />
          ) : playing.streaming ? (
            <Tv className="size-5" />
          ) : (
            <MonitorPlay className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-medium uppercase tracking-[.09em] text-accent-400">
            {t(isManga ? "nowPlaying.headingManga" : "nowPlaying.heading", {
              process: playing.process.replace(".exe", ""),
            })}
          </p>
          <p className="truncate text-[1.0625rem] font-semibold text-ink-100">
            {playing.mediaId ? (
              <Link to={`/media/${playing.mediaId}`} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
            {playing.episode !== null && (
              <span className="font-medium text-ink-500">
                {" "}
                —{" "}
                {t(isManga ? "common.chapter" : "common.episode", {
                  n: playing.episode,
                })}
              </span>
            )}
          </p>
          {/* Keyed on the phase so each state fades in; a silent text swap is easy to miss while looking at it. */}
          <div key={scrobble.phase} className="animate-fade-in">
            <ScrobbleStatus countdown={countdown.label} />
          </div>
        </div>
        <ScrobbleActions playing={playing} />
      </div>
    </div>
  );
}

function ScrobbleStatus({ countdown }: { countdown: string | null }) {
  const { t } = useTranslation();
  const current = useNowPlaying((s) => s.current);
  const scrobble = useNowPlaying((s) => s.scrobble);
  const signedIn = !!useAuth((s) => s.viewer);

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
    case "yielding":
      // Another Karasu on the same Jellyfin account goes first; quiet rather than gold, since nothing is wrong.
      return (
        <p className="text-xs text-ink-500">
          {t("nowPlaying.yielding", {
            device: scrobble.yieldingTo?.device ?? "",
            time: countdown ?? t("nowPlaying.soon"),
          })}
        </p>
      );
    case "pending":
      return (
        <p className="text-xs font-medium text-gold">
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
        <p className="flex items-center gap-1 text-xs font-medium text-success">
          {/* The one genuinely good outcome here, so it lands rather than appears. */}
          <Check className="size-3 animate-land" />{" "}
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
    case "queued":
      return (
        // Not the success green: the write is in SQLite, not on AniList, and this is where that difference shows.
        <p className="text-xs text-ink-500">
          {t("nowPlaying.queued", {
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
        <p className="text-xs text-gold">
          {scrobble.reason ? blockedText(scrobble.reason, t) : t("nowPlaying.blocked")}
          {/* Only an armed episode gap has a countdown here: watching on is about to count as being sure. */}
          {countdown && (
            <span className="text-ink-500">
              {" "}
              · {t("nowPlaying.blockedGapAuto", { time: countdown })}
            </span>
          )}
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
      // Without an account there is nothing to match against, so "no entry recognized" would read as a failure.
      return (
        <p className="text-xs text-ink-500">
          {t(signedIn ? "nowPlaying.noMatch" : "nowPlaying.noAccount")}
        </p>
      );
  }
}

/** The block in the reader's language, with a literal `t()` per branch because `i18nKeys.test.ts` only sees those. */
function blockedText(
  reason: BlockReason,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  switch (reason.code) {
    case "alreadyWatched":
      return t("nowPlaying.blockedAlreadyWatched", {
        n: reason.episode,
        progress: reason.progress,
      });
    case "episodeGap":
      return t("nowPlaying.blockedGap", {
        n: reason.episode,
        progress: reason.progress,
      });
    case "unknownSeason":
      return t("nowPlaying.blockedSeason", { n: reason.season });
    case "failed":
      return t("nowPlaying.blockedFailed", { message: reason.message });
  }
}

/** The card's buttons; the correction one is always there, since a wrong match needs fixing as much as a missing one. */
function ScrobbleActions({ playing }: { playing: NowPlaying }) {
  const { t } = useTranslation();
  const scrobble = useNowPlaying((s) => s.scrobble);
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState<NowPlaying | null>(null);
  const [error, setError] = useState<string | undefined>();

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // Errors land in the dialog rather than a toast, because the dialog is where the decision was made.
  const correct = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
      setCorrecting(null);
    } catch (e) {
      setError(String(e));
    }
  };

  // The phase table lives in `lib/actions`, where the context menu and the long-press sheet read the same answer.
  const canScrobble = canScrobbleNow(scrobble.phase, scrobble.forceable);
  const canSkip = canScrobbleCancel(scrobble.phase, scrobble.forceable);

  return (
    <>
      {/* Wrappable: two labelled buttons outgrow a phone in German, and `shrink-0` pushed the page wide instead. */}
      <div className="flex flex-wrap justify-end gap-2">
        {canScrobble && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(scrobbleNow)}
              title={t("nowPlaying.updateNowTitle")}
            >
              <Check className="size-3.5" /> {t("nowPlaying.updateNow")}
            </Button>
            {canSkip && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => act(scrobbleCancel)}
                title={t("nowPlaying.skipTitle")}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(undefined);
            setCorrecting(playing);
          }}
          title={t("nowPlaying.correctTitle")}
          aria-label={t("nowPlaying.correctTitle")}
        >
          <SearchCheck className="size-3.5" />
        </Button>
      </div>

      {/* `Presence`, not `PresenceIf`: the picker is opened by a value and would lose its seeded title during the exit. */}
      <Presence value={correcting}>
        {(np, leaving) => (
          <MatchPicker
            leaving={leaving}
            parsedTitle={np.parsedTitle}
            season={np.season ?? -1}
            current={np.matchedTitle ?? undefined}
            error={error}
            mediaType={np.mediaType}
            // Only when a season is the open question: sequels for an ordinary wrong match are noise and cost a request.
            suggestSequelsOf={
              scrobble.reason?.code === "unknownSeason" ? np.mediaId : null
            }
            detectedEpisode={np.episode}
            onPick={(mediaId, displayTitle, realEpisode) =>
              void correct(() =>
                setDetectionOverride({
                  title: np.parsedTitle,
                  season: np.season,
                  mediaType: np.mediaType,
                  mediaId,
                  displayTitle,
                  // Measured against `sourceEpisode`, never `episode`, which already carries this offset and any redirect.
                  episodeOffset:
                    realEpisode != null && np.sourceEpisode != null
                      ? realEpisode - np.sourceEpisode
                      : 0,
                }),
              )
            }
            onClear={
              np.overridden
                ? () =>
                    void correct(() =>
                      clearDetectionOverride({
                        title: np.parsedTitle,
                        season: np.season,
                        mediaType: np.mediaType,
                      }),
                    )
                : undefined
            }
            onCancel={() => setCorrecting(null)}
          />
        )}
      </Presence>
    </>
  );
}
