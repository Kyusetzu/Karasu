import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { isTauri } from "@/api/anilist";
import { currentSeason, seasonHero, type HeroMedia } from "@/api/queries";
import { displayTitle } from "@/api/types";
import { DecodedImage } from "@/components/media/DecodedImage";
import { BannerImage } from "@/components/media/BannerImage";
import { Shimmer } from "@/components/Skeleton";
import { adultQueryArg, isBlocked, shouldBlur } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { formatLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

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

  useEffect(() => {
    if (items.length < 2) return;
    const tick = window.setTimeout(
      () => setAt((i) => (i + 1) % Math.max(1, count.current)),
      HOLD_MS,
    );
    return () => window.clearTimeout(tick);
    // `at` is a dependency on purpose: each slide schedules the next, so a hidden tab does not wake owing several at once.
  }, [at, items.length]);

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

  // No skeleton once there is nothing to show; the Overview simply starts at its first section.
  if (isLoading) return <Shimmer className="h-48 md:h-72 w-full rounded-2xl" />;
  if (items.length === 0) return null;

  const current = items[Math.min(at, items.length - 1)];

  return (
    <section aria-label={t("dashboard.heroLabel")} className="relative">
      <div className="relative h-48 md:h-72 overflow-hidden rounded-2xl bg-surface-900">
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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 ink-halo">
          <p className="text-2xs font-semibold uppercase tracking-[.14em] text-accent-400">
            {t(`season.${season}`)} {year} · {t("dashboard.heroKicker")}
          </p>
          {/* The link is the title and the whole image is a second one, so a click anywhere on the hero works. */}
          <h2 className="mt-1 max-w-3xl">
            <Link
              to={`/media/${current.id}`}
              className="pointer-events-auto text-2xl font-bold leading-tight text-white hover:underline"
            >
              {displayTitle(current.title)}
            </Link>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-white/85">
            {current.format && <span>{formatLabel(current.format, t)}</span>}
            {current.episodes != null && (
              <span>{t("common.progressEpisodes", { n: current.episodes, total: current.episodes })}</span>
            )}
            {current.averageScore != null && (
              <span className="text-gold">{current.averageScore}%</span>
            )}
          </p>
        </div>

        {/* Top-right, not centred: on a phone the bottom-anchored text reaches mid-banner, and a centred arrow sat on the title. */}
        {items.length > 1 && (
          <div className="absolute right-3 top-3 flex gap-1.5">
            <IconButton
              variant="onCover"
              round
              onClick={() => step(-1)}
              aria-label={t("dashboard.heroPrev")}
              title={t("dashboard.heroPrev")}
            >
              <ChevronLeft className="size-4.5" />
            </IconButton>
            <IconButton
              variant="onCover"
              round
              onClick={() => step(1)}
              aria-label={t("dashboard.heroNext")}
              title={t("dashboard.heroNext")}
            >
              <ChevronRight className="size-4.5" />
            </IconButton>
          </div>
        )}
      </div>

      {items.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {items.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setAt(i)}
              aria-label={displayTitle(m.title)}
              aria-current={i === at}
              className={cn(
                "h-1 rounded-full transition-surface",
                i === at ? "w-6 bg-accent-500" : "w-3 bg-surface-700 hover:bg-surface-600",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
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
