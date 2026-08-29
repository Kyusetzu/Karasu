import { useState, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { HERO_ATTR } from "@/hooks/useViewTransitions";
import { useTranslation } from "react-i18next";

/**
 * One cover in a grid: the artwork, whatever is laid over it, and the lines
 * beneath.
 *
 * Everything that sits *on* the cover gets a near-opaque backdrop rather than a
 * translucent one. Cover art is arbitrary — white, busy, bright — so a
 * `bg-black/40` badge has no contrast floor at all, and the one thing a score
 * or a progress bar must be is legible on every poster in the list.
 */
export function CoverCell({
  to,
  cover,
  score,
  adult,
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
  /** Whatever belongs in the gold star badge — already formatted, since the
      user's own score and AniList's average are on different scales. */
  score?: ReactNode;
  /**
   * Marks the title 18+. Top-right, because the score badge has top-left and
   * the select checkbox shares it.
   *
   * Only ever visible with the content filter off: at `moderate` and `strict`
   * the adult titles are excluded *server-side* by `adultQueryArg`, so they
   * never reach a card at all. That is correct rather than a gap.
   */
  adult?: boolean;
  /** Accessible name for the reveal button — the title, so a grid does not
      announce thirty identical "Show"s. */
  revealLabel?: string;
  /**
   * Blur the artwork until it is clicked — the softer half of the content
   * filter, for someone who wants explicit titles *present* but not on display.
   * See `shouldBlur`; the badge above still shows through, so the cell is never
   * an unexplained grey rectangle.
   */
  blurred?: boolean;
  /** Draws the bar flush to the bottom edge. Omit when there is no total. */
  progress?: { current: number; total: number } | null;
  /** Overlaid bottom-right — the action circles. */
  actions?: ReactNode;
  /** Anything else laid over the artwork: a hover scrim, a checkbox. Rendered
      above the base scrim and below the badge and actions. */
  overlay?: ReactNode;
  /** Replaces the link on the artwork itself. Bulk-edit hands this in so a
      click selects instead of navigating — one interaction model at a time. */
  onCoverClick?: () => void;
  /** Accessible name for `onCoverClick`. */
  coverLabel?: string;
  /** Bulk-edit selection ring. */
  selected?: boolean;
  /**
   * A colour for the list status this title is in, drawn as a ring *inside* the
   * frame — see `lib/statusColors`.
   *
   * Inset on purpose. `selected` draws an `outline` two pixels outside the
   * frame and `MediaCard` draws a focus `ring` outside that; a third band out
   * there would either sit on top of one of them or be mistaken for it. Inside
   * the artwork it reads as a property of the title rather than of the
   * interaction, which is what it is.
   */
  statusRing?: string | null;
  className?: string;
  /** The metadata lines below the cover. */
  children?: ReactNode;
}) {
  const pct = progress
    ? Math.min((progress.current / progress.total) * 100, 100)
    : 0;

  // Revealed per cell and forgotten on unmount: a reveal that persisted would
  // be a second setting nobody asked for, and scrolling back to a grid you had
  // uncovered is exactly when you would want it covered again.
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  // `cover != null` because a missing cover has nothing to veil: it used to
  // put a 45% wash and a "Show" pill over an empty `bg-surface-800` box.
  const veiled = blurred && !revealed && cover != null;

  const art = cover && (
    <img
      src={cover}
      alt=""
      loading="lazy"
      // The outgoing half of the cover-to-hero morph. Only an attribute here:
      // the `view-transition-name` is applied by the click handler to the one
      // cover actually clicked, because two elements sharing a name in the same
      // snapshot make the browser skip the pairing altogether — and a grid
      // holds dozens of these.
      {...{ [HERO_ATTR]: "" }}
      className={cn(
        "h-full w-full object-cover transition-[filter] duration-(--duration-expressive)",
        // `scale-105` because a blur samples past the element's edge and would
        // otherwise leave a soft transparent rim around the artwork.
        veiled && "scale-105 blur-xl",
      )}
    />
  );

  return (
    <div className={cn("group", className)} {...rest}>
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800",
          selected && "outline-2 outline-offset-2 outline-accent-500",
        )}
      >
        {onCoverClick ? (
          <button
            type="button"
            onClick={onCoverClick}
            aria-label={coverLabel}
            className="block h-full w-full"
          >
            {art}
          </button>
        ) : (
          <Link to={to} className="block h-full">
            {art}
          </Link>
        )}

        {/* Sized to the content it has to carry, not to the cover. */}
        <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-14" />

        {overlay}

        {/* Over the art and under the badges, so the 18+ mark stays legible —
            the cell has to say *why* it is covered. */}
        {veiled && (
          <button
            type="button"
            aria-label={revealLabel ?? t("settings.blurReveal")}
            onClick={(e) => {
              // The cover is a link; revealing must not also navigate.
              e.preventDefault();
              e.stopPropagation();
              setRevealed(true);
            }}
            // **No `z-` class.** It had `z-10`, and the status ring, both
            // badges, the action circles and the progress bar all sit at
            // `z-index: auto` — CSS paints a positive z-index positioned
            // descendant after auto ones regardless of tree order, and
            // hit-testing follows paint order. So the veil covered the edit
            // pencil and the add/status circle: a visibly-enabled control that
            // did nothing on click, while Tab+Enter still fired it. Plain
            // `absolute` is enough — the veil follows the art and the scrim in
            // tree order and precedes everything that must sit above it.
            className="absolute inset-0 grid place-items-center bg-[rgba(4,5,8,.45)] text-2xs font-semibold text-ink-100"
          >
            <span className="rounded-full bg-[rgba(4,5,8,.85)] px-2.5 py-1">
              {t("settings.blurReveal")}
            </span>
          </button>
        )}

        {/* Above the hover scrim, below the badges: a wash that dimmed the ring
            would make an entry look like it had left the list. */}
        {statusRing && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg"
            style={{ boxShadow: `inset 0 0 0 2px ${statusRing}` }}
          />
        )}

        {score != null && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-[.625rem] bg-[rgba(4,5,8,.93)] px-1.5 py-0.5 text-2xs font-semibold text-gold">
            <Star className="size-2.5" fill="currentColor" />
            {score}
          </span>
        )}

        {/* Matched to the score badge deliberately — same radius, same padding,
            same near-opaque fill. Cover art is arbitrary (white, busy, bright),
            so a translucent badge has no contrast floor at all. */}
        {adult && (
          <span className="absolute right-2 top-2 rounded-[.625rem] bg-[rgba(4,5,8,.93)] px-1.5 py-0.5 text-2xs font-semibold text-danger">
            18+
          </span>
        )}

        {actions && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {actions}
          </div>
        )}

        {progress && (
          // Borders, not bars: a straight strip inside the `rounded-lg` clip
          // had its ends eaten by the corner circles and read as a floating
          // stub. A bottom border on an inset-0 overlay follows the frame's
          // own curve — full progress bends into both corners, partial
          // progress bends at the left and cuts flat at its live edge. The
          // fill is revealed by clip-path, so a +1 still grows the line on
          // the house curve instead of snapping.
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 rounded-lg border-b-[3px] border-[rgba(4,5,8,.6)]" />
            <div
              className="absolute inset-0 rounded-lg border-b-[3px] border-accent-500 transition-[clip-path] duration-(--duration-expressive) ease-(--ease-out-expo)"
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
