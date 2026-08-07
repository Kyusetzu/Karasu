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

/**
 * The detail screen while it loads, at the hero's real proportions.
 *
 * It used to be a single line of text at the top-left, so the page arrived
 * *underneath* it and everything moved twice — the same objection MediaList's
 * comment raises against a sentence where a wall of covers is about to appear.
 */
export function DetailSkeleton() {
  return (
    <div aria-hidden="true">
      <Shimmer index={0} className="h-64 w-full rounded-none" />
      <div className="relative mx-auto max-w-4xl px-8 pb-10 2xl:max-w-none">
        <div className="-mt-14 flex gap-6">
          <Shimmer index={1} className="h-57 w-38 shrink-0 rounded-[.625rem]" />
          <div className="min-w-0 flex-1 pt-16">
            <Shimmer index={2} className="h-6 w-2/3" />
            <Shimmer index={3} className="mt-2 h-4 w-2/5" />
            <Shimmer index={4} className="mt-3.5 h-3 w-1/2" />
            <div className="mt-4 flex gap-2">
              <Shimmer index={5} className="h-8 w-28 rounded-md" />
              <Shimmer index={6} className="h-8 w-24 rounded-md" />
            </div>
          </div>
        </div>
        <Shimmer index={7} className="mt-8 h-3 w-full" />
        <Shimmer index={8} className="mt-2 h-3 w-11/12" />
        <Shimmer index={9} className="mt-2 h-3 w-4/5" />
      </div>
    </div>
  );
}
