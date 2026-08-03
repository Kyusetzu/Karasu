import { cn } from "@/lib/utils";

/** The stagger, so a wall of cells resolves like a flock landing. */
const STEP_MS = 90;
const CYCLE = 6;

/** Title and metadata bar widths — coprime lengths, so the pair doesn't
    repeat every six cells the way the stagger does. */
const TITLE_W = ["w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-full", "w-4/5", "w-3/5"];
const META_W = ["w-1/2", "w-2/5", "w-3/5", "w-1/3", "w-5/12"];

/**
 * One placeholder block.
 *
 * `index` offsets the sweep. Without it every cell on screen lights at the
 * same instant, which reads as one flat pulse the size of the page; six
 * offsets are enough to make it travel without looking like a queue.
 */
export function Shimmer({
  index = 0,
  className,
}: {
  index?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("shimmer-fill rounded-md", className)}
      style={{ animationDelay: `${(index % CYCLE) * STEP_MS}ms` }}
    />
  );
}

/**
 * A cover grid that hasn't loaded yet, at the real track width — so nothing
 * moves sideways when the covers arrive, only the placeholders fill in.
 *
 * The two metadata bars underneath vary in width per cell: identical bars read
 * as a table of one repeated row, and real titles are never the same length.
 */
export function CoverGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="media-grid gap-x-4 gap-y-6" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Shimmer index={i} className="aspect-2/3 w-full rounded-lg" />
          {/* Widths come from the index, not from `Math.random`: a re-render
              must not reshuffle them, which would read as the data changing
              under the placeholder. */}
          <Shimmer index={i} className={cn("mt-2 h-2.5", TITLE_W[i % TITLE_W.length])} />
          <Shimmer index={i} className={cn("mt-1.5 h-2", META_W[i % META_W.length])} />
        </div>
      ))}
    </div>
  );
}

/** A section heading that hasn't arrived: the rule stays, the words don't. */
export function HeaderSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="flex items-center gap-2.5" aria-hidden="true">
      <Shimmer index={index} className="size-4 rounded-sm" />
      <Shimmer index={index} className="h-3.5 w-36" />
      <span className="section-rule" />
    </div>
  );
}
