import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
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
import { useAuth } from "@/stores/auth";
import { IconButton } from "@/components/ui/icon-button";
import { Presence } from "@/components/ui/presence";
import MatchPicker from "@/components/overlays/MatchPicker";
import { DecodedImage } from "@/components/media/DecodedImage";
import type { Media } from "@/api/types";
import { useContentFilter } from "@/stores/contentFilter";
import { shouldBlur } from "@/lib/contentFilter";
import { formatLabel } from "@/lib/format";
import { episodeLabel, joinMeta, metaParts, nativeLine } from "@/lib/detectionIdentity";
import { cn } from "@/lib/utils";
import { countdownFraction, ringOffset, splitRemaining } from "@/lib/countdown";
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

/** How much of the detection is drawn; compact keeps only what says a detection exists and where it has got to. */
export type DetectionVariant = "expanded" | "compact";

/** The countdown drawn as a closing ring, only while counting down: a static full ring would read as pending. */
function CountdownRing({ fraction, className }: { fraction: number; className: string }) {
  return (
    <svg className={cn("absolute inset-0 -rotate-90", className)} viewBox="0 0 44 44" aria-hidden>
      <circle
        cx="22"
        cy="22"
        r={RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={ringOffset(fraction, RING_C)}
        // A plain transition, so the reduce-motion rules reach it and the ring only stops sliding.
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}

/** The source's kind at a glance: a reader, a browser tab or a player window. */
function KindIcon({ playing, className }: { playing: NowPlaying; className: string }) {
  if (playing.mediaType === "MANGA") return <BookOpen className={className} />;
  return playing.streaming ? <Tv className={className} /> : <MonitorPlay className={className} />;
}

/** What the detector sees now, plus the scrobble state and its actions; the wrapper and the animation belong to callers. */
export default function DetectionSurface({
  playing,
  variant = "expanded",
  media = null,
}: {
  playing: NowPlaying;
  variant?: DetectionVariant;
  /** The matched entry's media, for the cover and the meta line; null draws the placeholder. */
  media?: Media | null;
}) {
  const scrobble = useNowPlaying((s) => s.scrobble);
  const countdown = useCountdown(
    // Blocked carries a time only for an armed episode gap, so one hook serves all three phases.
    scrobble.phase === "watching" ||
      scrobble.phase === "blocked" ||
      scrobble.phase === "yielding"
      ? scrobble
      : { armedAtMs: null, updateAtMs: null },
  );
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);

  const title = playing.matchedTitle ?? playing.parsedTitle;
  const compact = variant === "compact";
  const ringing = scrobble.phase === "watching" && countdown.label !== null;
  const label = episodeLabel(playing);
  const labelText =
    label === null
      ? null
      : label.kind === "seasonEpisode"
        ? t("nowPlaying.seasonEpisode", { s: label.season, n: label.episode })
        : label.kind === "episode"
          ? t("nowPlaying.episodeShort", { n: label.episode })
          : t("nowPlaying.chapterShort", { n: label.chapter });
  const native = nativeLine(media?.title, title);
  const meta = metaParts(media, playing.mediaType);
  const metaText = meta
    ? joinMeta([
        formatLabel(meta.format, t),
        meta.seasonYear
          ? meta.season
            ? `${t(`season.${meta.season}`, { defaultValue: meta.season })} ${meta.seasonYear}`
            : String(meta.seasonYear)
          : null,
        meta.total === null
          ? null
          : meta.total.kind === "episodes"
            ? t("nowPlaying.episodesShort", { n: meta.total.n })
            : t("nowPlaying.chaptersShort", { n: meta.total.n }),
      ])
    : "";
  const cover = media?.coverImage.large ?? null;
  const veiled = media ? shouldBlur(media, level, blurAdult) : false;

  const titleNode = playing.mediaId ? (
    <Link to={`/media/${playing.mediaId}`} className="hover:underline">
      {title}
    </Link>
  ) : (
    title
  );

  if (compact) {
    return (
      <div className="relative flex items-center gap-2.5">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
          {ringing && <CountdownRing fraction={countdown.fraction} className="size-8" />}
          <KindIcon playing={playing} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[.8125rem] font-semibold text-ink-100">
            {titleNode}
            {labelText && <span className="font-medium text-ink-500"> · {labelText}</span>}
          </p>
          <div key={scrobble.phase} className="animate-fade-in">
            <ScrobbleStatus countdown={countdown.label} compact />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-3">
        <div className="relative h-21 w-14 shrink-0">
          <div className="h-full w-full overflow-hidden rounded-md bg-surface-800">
            {cover ? (
              <DecodedImage
                src={cover}
                className={cn("h-full w-full object-cover", veiled && "scale-105 blur-xl")}
              />
            ) : (
              <span className="grid h-full place-items-center text-ink-600">
                <KindIcon playing={playing} className="size-5" />
              </span>
            )}
          </div>
          {/* The ring sits on the cover's corner, where the icon disc used to be the whole picture. */}
          <span className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-full bg-surface-900 text-accent-400 ring-2 ring-surface-900">
            {ringing && <CountdownRing fraction={countdown.fraction} className="size-7" />}
            <KindIcon playing={playing} className="size-3.5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[.9375rem] font-semibold text-ink-100">{titleNode}</p>
          {native && <p className="truncate font-brand-jp text-2xs text-ink-600">{native}</p>}
          {(labelText || playing.episodeTitle) && (
            <p className="truncate text-xs text-ink-300">
              {labelText && <span className="font-medium tabular-nums text-ink-100">{labelText}</span>}
              {labelText && playing.episodeTitle && " · "}
              {playing.episodeTitle}
            </p>
          )}
          {metaText && <p className="truncate text-2xs text-ink-500">{metaText}</p>}
          {/* Keyed on the phase so each state fades in; a silent text swap is easy to miss while looking at it. */}
          <div key={scrobble.phase} className="mt-1 animate-fade-in">
            <ScrobbleStatus countdown={countdown.label} compact={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScrobbleStatus({
  countdown,
  compact = false,
}: {
  countdown: string | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const current = useNowPlaying((s) => s.current);
  const scrobble = useNowPlaying((s) => s.scrobble);
  const signedIn = !!useAuth((s) => s.viewer);

  // Compact keeps the countdown and nothing else: the sentences below need room the collapsed strip does not have.
  if (compact) {
    return countdown ? (
      <p className="truncate text-2xs tabular-nums text-ink-500">{countdown}</p>
    ) : null;
  }

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
      // A match without a progress is a correction made signed out: there is an entry, but no list that holds it.
      if (current?.mediaId && current.progress !== null) {
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

/** The window's three verbs as icon buttons; the correction one is always there, a wrong match needs fixing too. */
export function ScrobbleActions({ playing }: { playing: NowPlaying }) {
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
      <div className="flex shrink-0 items-center gap-0.5">
        {canScrobble && (
          <IconButton
            size="xs"
            variant="success"
            disabled={busy}
            onClick={() => act(scrobbleNow)}
            title={t("nowPlaying.updateNowTitle")}
            aria-label={t("nowPlaying.updateNowTitle")}
          >
            <Check className="size-3.5" />
          </IconButton>
        )}
        {canScrobble && canSkip && (
          <IconButton
            size="xs"
            disabled={busy}
            onClick={() => act(scrobbleCancel)}
            title={t("nowPlaying.skipTitle")}
            aria-label={t("nowPlaying.skipTitle")}
          >
            <X className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          size="xs"
          onClick={() => {
            setError(undefined);
            setCorrecting(playing);
          }}
          title={t("nowPlaying.correctTitle")}
          aria-label={t("nowPlaying.correctTitle")}
        >
          <SearchCheck className="size-3.5" />
        </IconButton>
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
