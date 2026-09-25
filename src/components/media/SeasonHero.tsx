import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import { currentSeason, seasonHero, type HeroMedia } from "@/api/queries";
import { displayTitle } from "@/api/types";
import { DecodedImage } from "@/components/media/DecodedImage";
import { BannerImage } from "@/components/media/BannerImage";
import { Shimmer } from "@/components/Skeleton";
import { adultQueryArg, isBlocked, shouldBlur } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { formatLabel } from "@/lib/format";
import { heroEpisodes } from "@/lib/heroEpisodes";
import { cn } from "@/lib/utils";
import { useTabSwipe } from "@/hooks/useTabSwipe";
import { usePointerSwipe } from "@/hooks/usePointerSwipe";

/** How long each title holds before the next fades in. */
const HOLD_MS = 7000;

/** The season's top anime; keep rotating under reduced motion, since the next title is content, not motion. */
export default function SeasonHero() {
  const { t } = useTranslation();
  const [{ season, year }] = useState(currentSeason);
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);
  const filterReady = useContentFilter((s) => s.ready);

  const { data, isLoading } = useQuery({
    queryKey: ["seasonHero", season, year, level],
    queryFn: () => seasonHero(season, year, adultQueryArg(level)),
    enabled: isTauri && filterReady,
    staleTime: 30 * 60 * 1000,
  });

  // The same filter as every dashboard section: the query argument covers the server side, this covers the genre rule.
  const items = (data ?? []).filter((m) => !isBlocked(m, level));

  const [at, setAt] = useState(0);
  // A ref, so the timer is scheduled once per slide instead of rebuilt by every unrelated re-render of the Overview.
  const count = useRef(items.length);
  count.current = items.length;
  // A finger or a mouse button resting on the hero holds the rotation, so a slide never changes under a drag.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (items.length < 2 || held) return;
    const tick = window.setTimeout(
      () => setAt((i) => (i + 1) % Math.max(1, count.current)),
      HOLD_MS,
    );
    return () => window.clearTimeout(tick);
    // `at` is a dependency on purpose: each slide schedules the next, so a hidden tab does not wake owing several at once.
  }, [at, items.length, held]);

  // Released anywhere, not only over the hero: a drag that ends outside it must not leave the rotation stopped.
  useEffect(() => {
    if (!held) return;
    const release = () => setHeld(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("touchend", release);
    window.addEventListener("touchcancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("touchend", release);
      window.removeEventListener("touchcancel", release);
    };
  }, [held]);

  // Mount slides as they are reached, not every banner at once, and keep a seen one: unmounting re-decodes and flashes.
  const [seen, setSeen] = useState(() => new Set([0, 1]));
  useEffect(() => {
    setSeen((prev) => {
      const next = (at + 1) % Math.max(1, count.current);
      if (prev.has(at) && prev.has(next)) return prev;
      const grown = new Set(prev);
      grown.add(at);
      grown.add(next);
      return grown;
    });
  }, [at]);

  const step = (dir: 1 | -1) =>
    setAt((i) => (i + dir + count.current) % Math.max(1, count.current));

  // Endless both ways like the rotation: a finger on the phone, a mouse drag or a sideways trackpad scroll elsewhere.
  const card = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const swipeable = items.length > 1;
  useTabSwipe({ surface: card, content: track, enabled: swipeable, canStep: () => true, onStep: step });
  usePointerSwipe({ surface: card, content: track, enabled: swipeable, onStep: step });

  // No skeleton once there is nothing to show; the Overview simply starts at its first section.
  if (isLoading) return <Shimmer className="h-48 md:h-72 w-full rounded-sheet" />;
  if (items.length === 0) return null;

  const current = items[Math.min(at, items.length - 1)];

  return (
    <section aria-label={t("dashboard.heroLabel")} className="relative">
      <div
        ref={card}
        onPointerDown={() => setHeld(true)}
        onTouchStart={() => setHeld(true)}
        className="relative h-48 md:h-72 select-none overflow-hidden rounded-sheet bg-surface-900"
      >
        {/* Everything that follows a swipe; the card around it stays put and clips it. */}
        <div ref={track} className="absolute inset-0">
          {/* Cross-faded by opacity, not swapped: swapping unmounts the decoded image and every rotation would flash. */}
          {items.map((m, i) =>
            seen.has(i) ? (
              <Slide
                key={m.id}
                media={m}
                active={i === at}
                veiled={shouldBlur(m, level, blurAdult)}
              />
            ) : null,
          )}

          {/* Only under the text and dark in both themes, so the banner stays whole and the haloed text stays legible. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
            {/* A plate, not an outline, which eats letters this small; a block box, since only one can trim to the caps. */}
            <p className="inline-block rounded-full bg-black/55 px-2 py-1.5 text-2xs font-semibold uppercase leading-none tracking-[.14em] text-accent-400 backdrop-blur-sm [text-box:trim-both_cap_alphabetic]">
              {t(`season.${season}`)} {year} · {t("dashboard.heroKicker")}
            </p>
            {/* The link is the title and the whole image is a second one, so a click anywhere on the hero works. */}
            <h2 className="mt-1.5 max-w-3xl ink-halo">
              <Link
                to={`/media/${current.id}`}
                className="pointer-events-auto text-2xl font-bold leading-tight text-white hover:underline"
              >
                {displayTitle(current.title)}
              </Link>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-white/85 ink-halo">
                {current.format && <span>{formatLabel(current.format, t)}</span>}
                <EpisodeLine media={current} />
                {current.averageScore != null && (
                  <span className="text-gold">{current.averageScore}%</span>
                )}
              </p>
              {/* On the picture and in the meta line's row, so the dots can never sit on the title. */}
              {swipeable && (
                <div className="pointer-events-auto ml-auto flex items-center rounded-full bg-black/45 px-1 backdrop-blur-sm">
                  {items.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAt(i)}
                      aria-label={displayTitle(m.title)}
                      aria-current={i === at}
                      className="group grid h-4 place-items-center px-0.5"
                    >
                      <span
                        className={cn(
                          "block h-1 rounded-full transition-surface",
                          i === at ? "w-4 bg-white" : "w-1 bg-white/45 group-hover:bg-white/75",
                        )}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Aired against total for a running show, the total otherwise; `heroEpisodes` decides, this only says it. */
function EpisodeLine({ media }: { media: HeroMedia }) {
  const { t } = useTranslation();
  const line = heroEpisodes(media);
  switch (line?.key) {
    case "aired":
      return <span>{t("dashboard.heroAired", { n: line.n, total: line.total })}</span>;
    case "airedOpen":
      return <span>{t("dashboard.heroAiredOpen", { n: line.n })}</span>;
    case "total":
      return <span>{t("dashboard.heroEpisodes", { n: line.n })}</span>;
    default:
      return null;
  }
}

/** One title's artwork: the banner whole over a blur of itself, or the cover as a dimmed wash when there is none. */
function Slide({
  media,
  active,
  veiled,
}: {
  media: HeroMedia;
  active: boolean;
  /** Computed by the carousel, which already holds both store values. */
  veiled: boolean;
}) {
  const banner = media.bannerImage;
  const fallback = media.coverImage.extraLarge ?? media.coverImage.large;
  return (
    <Link
      to={`/media/${media.id}`}
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 transition-opacity duration-(--duration-expressive)",
        active ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {banner ? (
        // Top-anchored: on a phone the banner is a strip, and the title below it then sits on the fill, not the picture.
        <BannerImage src={banner} veiled={veiled} anchor="top" />
      ) : (
        fallback && (
          // A poster is not a banner, so it stays a blurred wash rather than a contained portrait beside the text.
          <DecodedImage
            src={fallback}
            className="h-full w-full scale-110 object-cover blur-lg"
            loadedOpacity={0.55}
          />
        )
      )}
    </Link>
  );
}
