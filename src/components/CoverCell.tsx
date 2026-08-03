import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

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
  progress,
  actions,
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
  /** Draws the bar flush to the bottom edge. Omit when there is no total. */
  progress?: { current: number; total: number } | null;
  /** Overlaid bottom-right — the action circles. */
  actions?: ReactNode;
  /** Bulk-edit selection ring. */
  selected?: boolean;
  className?: string;
  /** The metadata lines below the cover. */
  children?: ReactNode;
}) {
  const pct = progress
    ? Math.min((progress.current / progress.total) * 100, 100)
    : 0;

  return (
    <div className={cn("group", className)} {...rest}>
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800",
          selected && "outline-2 outline-offset-2 outline-accent-500",
        )}
      >
        <Link to={to} className="block h-full">
          {cover && (
            <img
              src={cover}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </Link>

        {/* Sized to the content it has to carry, not to the cover. */}
        <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-14" />

        {score != null && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-[.625rem] bg-[rgba(4,5,8,.93)] px-1.5 py-0.5 text-2xs font-semibold text-gold">
            <Star className="size-2.5" fill="currentColor" />
            {score}
          </span>
        )}

        {actions && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {actions}
          </div>
        )}

        {progress && (
          <div className="absolute inset-x-0 bottom-0 h-0.75 bg-[rgba(4,5,8,.6)]">
            <div
              className="h-full bg-accent-500"
              style={{ width: `${pct}%` }}
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
