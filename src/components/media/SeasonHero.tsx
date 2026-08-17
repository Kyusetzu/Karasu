import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import { currentSeason, seasonHero, type HeroMedia } from "@/api/queries";
import { displayTitle } from "@/api/types";
import { DecodedImage } from "@/components/media/DecodedImage";
import { Shimmer } from "@/components/Skeleton";
import { adultQueryArg, isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { formatLabel } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** How long each title holds before the next fades in. */
const HOLD_MS = 7000;

/**
 * The season's most popular anime, across the top of the Overview.
 *
 * One request per mount, `perPage: 5`, cached for half an hour — the season's
 * popularity ranking does not move minute to minute. It is the app's third
 * dashboard query and the only one that needs `bannerImage`, which is why it
 * has a query of its own rather than widening the 50-a-page seasonal one.
 *
 * The rotation is a `setTimeout`, and **CSS reduce-motion cannot see a
 * `setTimeout`** — the `!important` overrides in `index.css` act on animation
 * and transition properties and nothing else. So it asks `prefersReducedMotion`
 * directly and simply holds on the first title, which is also the most popular
 * one and therefore the right one to hold on.
 */
export default function SeasonHero() {
  const { t } = useTranslation();
  const [{ season, year }] = useState(currentSeason);
  const level = useContentFilter((s) => s.level);
  const filterReady = useContentFilter((s) => s.ready);

  const { data, isLoading } = useQuery({
    queryKey: ["seasonHero", season, year, level],
    queryFn: () => seasonHero(season, year, adultQueryArg(level)),
    enabled: isTauri && filterReady,
    staleTime: 30 * 60 * 1000,
  });

  // The same filter every other dashboard section runs through. The query
  // argument covers the server side; this covers the genre rule, which AniList
  // has no equivalent for.
  const items = (data ?? []).filter((m) => !isBlocked(m, level));

  const [at, setAt] = useState(0);
  // A ref, so the timer can be scheduled once per slide instead of being torn
  // down and rebuilt by every unrelated re-render of the Overview.
  const count = useRef(items.length);
  count.current = items.length;

  useEffect(() => {
    if (items.length < 2 || prefersReducedMotion()) return;
    const tick = window.setTimeout(
      () => setAt((i) => (i + 1) % Math.max(1, count.current)),
      HOLD_MS,
    );
    return () => window.clearTimeout(tick);
    // `at` is the dependency on purpose: each slide schedules the next, so a
    // tab that was hidden does not wake up owing several transitions at once.
  }, [at, items.length]);

  // Nothing is a better hero than a broken one — no skeleton once it is known
  // there is nothing to show, so the Overview simply starts at its first
  // section as it always did.
  if (isLoading) return <Shimmer className="h-56 w-full rounded-2xl" />;
  if (items.length === 0) return null;

  const current = items[Math.min(at, items.length - 1)];

  return (
    <section aria-label={t("dashboard.heroLabel")} className="relative">
      <div className="relative h-56 overflow-hidden rounded-2xl bg-surface-900">
        {/* Every slide is mounted and cross-faded by opacity rather than
            swapped: swapping unmounts the decoded image, so each rotation would
            re-decode and flash. The inactive ones are inert to the pointer. */}
        {items.map((m, i) => (
          <Slide key={m.id} media={m} active={i === at} />
        ))}

        {/* Over the art, under the text. `from-surface-950` matches the page,
            so the image reads as the page rather than as a card on it. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-950 via-surface-950/55 to-transparent" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
          <p className="text-2xs font-semibold uppercase tracking-[.14em] text-accent-400">
            {t(`season.${season}`)} {year} · {t("dashboard.heroKicker")}
          </p>
          {/* The link is the title, and the whole image is a second one — both
              go to the same place, so a click anywhere on the hero works. */}
          <h2 className="mt-1 max-w-3xl">
            <Link
              to={`/media/${current.id}`}
              className="pointer-events-auto text-2xl font-bold leading-tight text-ink-100 drop-shadow-[0_2px_12px_rgba(0,0,0,.75)] hover:underline"
            >
              {displayTitle(current.title)}
            </Link>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-ink-400">
            {current.format && <span>{formatLabel(current.format, t)}</span>}
            {current.episodes != null && (
              <span>{t("common.progressEpisodes", { n: current.episodes, total: current.episodes })}</span>
            )}
            {current.averageScore != null && (
              <span className="text-gold">{current.averageScore}%</span>
            )}
          </p>
        </div>
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

/**
 * One title's artwork.
 *
 * `bannerImage` is a 2:1 crop and the right shape here. Falling back to the
 * cover means stretching a 2:3 poster across a wide box, so it is blurred and
 * dimmed and treated as a backdrop rather than as the picture — the same trick
 * `AnimeDetail` uses when a title has no banner.
 */
function Slide({ media, active }: { media: HeroMedia; active: boolean }) {
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
      {(banner ?? fallback) && (
        <DecodedImage
          src={banner ?? fallback ?? undefined}
          className={cn(
            "h-full w-full object-cover",
            !banner && "scale-110 blur-lg",
          )}
          loadedOpacity={banner ? 1 : 0.55}
        />
      )}
    </Link>
  );
}
