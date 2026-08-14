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
  type NowPlaying,
} from "@/stores/nowPlaying";
import { isTauri } from "@/api/anilist";
import { Button } from "@/components/ui/button";
import { Presence } from "@/components/ui/presence";
import MatchPicker from "@/components/overlays/MatchPicker";
import { cn } from "@/lib/utils";
import { countdownFraction, ringOffset, splitRemaining } from "@/lib/countdown";
import { usePresentValue } from "@/hooks/usePresence";

/**
 * The countdown, as text and as a fraction for the ring.
 *
 * The span is remembered from the largest remaining time seen for this target,
 * because the backend sends the deadline but not the length of the wait — see
 * `lib/countdown.ts`.
 */
function useCountdown(targetMs: number | null): {
  label: string | null;
  fraction: number;
} {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  const span = useRef<{ target: number; ms: number } | null>(null);

  useEffect(() => {
    if (targetMs === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  if (targetMs === null) {
    span.current = null;
    return { label: null, fraction: 0 };
  }

  const diff = targetMs - Date.now();
  if (span.current?.target !== targetMs) {
    span.current = { target: targetMs, ms: Math.max(diff, 1) };
  } else if (diff > span.current.ms) {
    // A later tick reporting *more* time left means this session started before
    // the card was mounted; widen rather than let the ring run backwards.
    span.current.ms = diff;
  }

  const fraction = countdownFraction(diff, span.current.ms);
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
    scrobble.phase === "watching" ? scrobble.updateAtMs : null,
  );
  const qc = useQueryClient();
  const { t } = useTranslation();
  // Retained through the exit so the card can animate away with its title
  // rather than emptying first.
  const shown = usePresentValue(current, 160);

  // Reload the list after a successful auto-update. Only the collection that
  // actually changed: an anime scrobble cannot alter the manga list, and
  // invalidating both refetched two full MediaListCollections.
  //
  // The event carries no media type, so it comes from the store — read at fire
  // time rather than from a closure, which would pin whatever was playing when
  // the listener was registered. The fallback is not optional: without it, an
  // absent type would leave one list silently never refreshing.
  //
  // Cleanup awaits the registration promise rather than a variable it fills
  // in. `<main key={pathname}>` remounts this on every navigation, and under
  // StrictMode the cleanup always runs before the IPC round trip settles, so
  // the old form found `unlisten` still undefined, did nothing, and left a
  // handler registered for the life of the process — one more on every trip
  // through the Dashboard, each invalidating queries on every scrobble.
  useEffect(() => {
    if (!isTauri) return;
    const registered = listen("scrobble-done", () => {
      const mediaType = useNowPlaying.getState().current?.mediaType;
      qc.invalidateQueries({
        queryKey: mediaType ? ["mediaList", mediaType] : ["mediaList"],
      });
    });
    return () => {
      registered.then((un) => un());
    };
  }, [qc]);

  // Playback ending removed the card mid-frame, though it arrived with a rise.
  if (!shown.value) return null;
  const playing = shown.value;

  const title = playing.matchedTitle ?? playing.parsedTitle;
  const isManga = playing.mediaType === "MANGA";

  return (
    // Cut *into* the page rather than raised off it. This card arrives
    // unprompted every evening, so reading as a different substance is how it
    // announces itself without shouting.
    <div
      className={cn(
        "inset-well well-edge relative overflow-hidden rounded-[.875rem] px-4.5 py-4",
        shown.leaving ? "animate-rise-out" : "animate-rise-in",
      )}
    >
      {/* The one idle loop on this screen, and only while something is
          genuinely running: the well warms and cools on a 4.5s cycle, which is
          the same thing the titlebar dot says at the other end of the window.
          Its own element because the card's `animation` is already spoken for
          by the entrance/exit, and `inset-well` already owns `box-shadow`. */}
      {scrobble.phase === "watching" && !shown.leaving && (
        <span
          aria-hidden
          className="animate-idle-glow pointer-events-none absolute inset-0 rounded-[.875rem]"
        />
      )}
      <div className="relative flex items-center gap-4">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
          {/* The wait, drawn rather than counted. The digits below tick once a
              second and jump; a ring closing over the same interval is the part
              that can be read at a glance. Only while actually counting down —
              a static full ring would suggest something is still pending. */}
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
                // A plain transition, so the reduce-motion rules already reach
                // it — the ring still updates, it just stops sliding.
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
          {/* Keyed on the phase so each state fades in rather than the line
              swapping its words in place — this row is the app reporting on
              something it did without being asked, and a silent text change is
              easy to miss while looking straight at it. */}
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
          {/* The one genuinely good outcome in this machine, so it lands
              rather than appearing. */}
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
    case "blocked":
      return (
        <p className="text-xs text-gold">
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

/**
 * The card's buttons.
 *
 * The scrobble pair appears only in the phases where there is something to
 * confirm or skip. The correction button is always there — a wrong match needs
 * fixing exactly as much as a missing one, and the unmatched case used to
 * render no action at all, which left "No entry recognized" as a statement
 * with nothing to do about it.
 */
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

  // Errors land in the dialog rather than a toast, the way the library's
  // corrections do: the dialog is where the decision was made.
  const correct = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
      setCorrecting(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const canScrobble =
    scrobble.phase === "pending" ||
    scrobble.phase === "blocked" ||
    scrobble.phase === "watching" ||
    scrobble.phase === "cancelled";

  return (
    <>
      <div className="flex shrink-0 gap-2">
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
            {scrobble.phase !== "cancelled" && scrobble.phase !== "blocked" && (
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

      {/* `Presence`, not `PresenceIf`: the picker is opened *by* a value and
          would otherwise lose its seeded title for the length of the exit. */}
      <Presence value={correcting}>
        {(np, leaving) => (
          <MatchPicker
            leaving={leaving}
            parsedTitle={np.parsedTitle}
            season={np.season ?? -1}
            current={np.matchedTitle ?? undefined}
            error={error}
            mediaType={np.mediaType}
            onPick={(mediaId, displayTitle) =>
              void correct(() =>
                setDetectionOverride({
                  title: np.parsedTitle,
                  season: np.season,
                  mediaType: np.mediaType,
                  mediaId,
                  displayTitle,
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
