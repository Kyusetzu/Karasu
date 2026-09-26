import { useState, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldBlur, type Filterable } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { HERO_ATTR } from "@/hooks/useViewTransitions";
import { useTranslation } from "react-i18next";

/** One cover in a grid; everything laid on it gets a near-opaque backdrop, since arbitrary art has no contrast floor. */
export function CoverCell({
  to,
  cover,
  score,
  adult,
  media,
  blurred,
  revealLabel,
  progress,
  actions,
  overlay,
  statusRing,
  onCoverClick,
  coverLabel,
  selected,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  to: string;
  cover: string | null;
  /** The gold star badge's content, already formatted: the user's score and AniList's average differ in scale. */
  score?: ReactNode;
  /** Marks the title 18+; only visible with the filter off, since `adultQueryArg` excludes adult titles server-side. */
  adult?: boolean;
  /** Accessible name for the reveal button, the title, so a grid does not announce identical "Show"s. */
  revealLabel?: string;
  /** The title this cover belongs to, so the cell decides the blur itself; prefer it over `blurred`. */
  media?: Filterable | null;
  /** Blur the artwork until clicked; an explicit override that wins over `media`, so leave it out unless needed. */
  blurred?: boolean;
  /** Draws the bar flush to the bottom edge. Omit when there is no total. */
  progress?: { current: number; total: number } | null;
  /** Overlaid bottom-right — the action circles. */
  actions?: ReactNode;
  /** Anything else laid over the artwork, rendered above the base scrim and below the badge and actions. */
  overlay?: ReactNode;
  /** Replaces the link on the artwork; bulk-edit hands this in so a click selects instead of navigating. */
  onCoverClick?: () => void;
  /** Accessible name for `onCoverClick`. */
  coverLabel?: string;
  /** Bulk-edit selection ring. */
  selected?: boolean;
  /** List-status colour drawn as a ring inside the frame, where the selection outline and focus ring cannot collide. */
  statusRing?: string | null;
  className?: string;
  /** The metadata lines below the cover. */
  children?: ReactNode;
}) {
  const pct = progress
    ? Math.min((progress.current / progress.total) * 100, 100)
    : 0;

  // Revealed per cell and forgotten on unmount: a reveal that persisted would be a second setting nobody asked for.
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  // Decided here rather than at each call site; `blurred` still wins when a caller states it, and no cover means no veil.
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);
  const wanted = blurred ?? shouldBlur(media, level, blurAdult);
  const veiled = wanted && !revealed && cover != null;

  const art = cover && (
    <img
      src={cover}
      alt=""
      loading="lazy"
      // Only an attribute: the click handler names the one clicked cover, since two elements sharing a name skip the morph.
      {...{ [HERO_ATTR]: "" }}
      className={cn(
        "h-full w-full object-cover transition-[filter] duration-(--duration-expressive) ease-(--ease-out-expo)",
        // `scale-105` because a blur samples past the edge and would otherwise leave a transparent rim.
        veiled && "scale-105 blur-xl",
      )}
    />
  );

  return (
    <div className={cn("group", className)} {...rest}>
      <div
        className={cn(
          "focus-frame @container relative aspect-[2/3] overflow-hidden rounded-control bg-surface-800",
          selected && "outline-2 outline-offset-2 outline-accent-500",
        )}
      >
        {onCoverClick ? (
          <button
            type="button"
            onClick={onCoverClick}
            aria-label={coverLabel}
            data-fills-frame
            className="block h-full w-full"
          >
            {art}
          </button>
        ) : (
          <Link to={to} data-fills-frame className="block h-full">
            {art}
          </Link>
        )}

        {/* Sized to the content it has to carry, not to the cover. */}
        <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-14" />

        {overlay}

        {/* Over the art and under the badges, so the 18+ mark still says why the cell is covered. */}
        {veiled && (
          <button
            type="button"
            aria-label={revealLabel ?? t("settings.blurReveal")}
            data-fills-frame
            onClick={(e) => {
              // The cover is a link; revealing must not also navigate.
              e.preventDefault();
              e.stopPropagation();
              setRevealed(true);
            }}
            // No `z-` class: a positive z-index paints over the auto-indexed badges and actions and swallows their clicks.
            className="absolute inset-0 grid place-items-center bg-on-cover/45 text-2xs font-semibold text-on-cover-edge"
          >
            <span className="rounded-full bg-on-cover/85 px-2.5 py-1">
              {t("settings.blurReveal")}
            </span>
          </button>
        )}

        {/* Above the hover scrim, below the badges: a wash dimming the ring would make an entry look off the list. */}
        {statusRing && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-control"
            style={{ boxShadow: `inset 0 0 0 2px ${statusRing}` }}
          />
        )}

        {score != null && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-cover bg-on-cover/93 px-1.5 py-0.5 text-2xs font-semibold text-on-cover-gold">
            <Star className="size-2.5" fill="currentColor" />
            {score}
          </span>
        )}

        {/* Matched to the score badge on purpose; a translucent badge has no contrast floor on arbitrary art. */}
        {adult && (
          <span className="absolute right-2 top-2 rounded-cover bg-on-cover/93 px-1.5 py-0.5 text-2xs font-semibold text-on-cover-danger">
            18+
          </span>
        )}

        {actions && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {actions}
          </div>
        )}

        {progress && (
          // A border revealed by clip-path, not a bar: a straight strip inside the rounded clip loses its ends to the corners.
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 rounded-control border-b-[3px] border-on-cover/60" />
            <div
              className="absolute inset-0 rounded-control border-b-[3px] border-accent-500 transition-[clip-path] duration-(--duration-expressive) ease-(--ease-out-expo)"
              style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
            />
          </div>
        )}
      </div>

      {children}
    </div>
  );
}

/** The quiet third line under a cover — progress, or format and year. */
export function CoverMeta({ children }: { children: ReactNode }) {
  return (
    <p className="mt-0.5 text-2xs tabular-nums text-ink-600">{children}</p>
  );
}
