import type { ReactNode } from "react";
import { KarasuMarkFlat } from "@/components/KarasuMark";
import { cn } from "@/lib/utils";

/**
 * An empty surface, said out loud.
 *
 * Each visual below is a different composition on purpose. Nine identical
 * "nothing here" panels read as one unfinished template; a small set of
 * distinct ones reads as a considered part of the app. This is also the only
 * place the corvid shows itself — the daily surfaces stay quiet, and an empty
 * one has the room.
 */
export function EmptyState({
  visual,
  title,
  hint,
  actions,
  className,
}: {
  visual?: ReactNode;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center py-10 text-center", className)}>
      {visual}
      <p className="mt-4 text-[.9375rem] font-medium text-ink-300">{title}</p>
      {hint && (
        <p className="mt-1 max-w-80 text-2xs leading-relaxed text-ink-600">
          {hint}
        </p>
      )}
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A rule fading to nothing with the mark perched on it — for a queue that has
 * run out rather than one that was never filled.
 */
export function PerchRule() {
  return (
    <div className="relative h-8 w-full max-w-80">
      <span className="section-rule absolute inset-x-0 bottom-0 block" />
      {/* The bird actually lands. This visual is a corvid perched on a
          rule — the one place the file's own comment says the mark may
          show itself — and it arrived already sitting there. */}
      <KarasuMarkFlat className="animate-land absolute bottom-0 left-1/2 size-6 -translate-x-1/2 text-ink-500 opacity-60" />
    </div>
  );
}

/**
 * Graded tick marks — an empty schedule drawn as the thing it is missing.
 * Used for a quiet week and for an empty notification list.
 */
export function TickMarks({ count = 7 }: { count?: number }) {
  // Graded rather than uniform so it reads as a chart with no data, not as a
  // decorative divider.
  const heights = [40, 64, 28, 80, 36, 56, 24];
  return (
    <div className="flex h-20 items-end gap-2.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="w-px bg-surface-700"
          style={{ height: `${heights[i % heights.length]}%` }}
        />
      ))}
    </div>
  );
}

/** A dashed 2:3 cover that never got filled, holding the mark. */
export function CoverOutline() {
  return (
    <div className="grid h-30 w-20 place-items-center rounded-lg border border-dashed border-surface-700">
      {/* Two pixels over six seconds. An empty screen is the one place in the
          app with nothing else asking for attention, so the bird is allowed to
          be alive here — but only just. `PerchRule`'s bird deliberately does
          not get this: it already animates on arrival, and `land` owns the
          same `transform` an idle float would need. */}
      <KarasuMarkFlat className="animate-idle-float size-14 text-ink-500 opacity-55" />
    </div>
  );
}

/** Three empty folders, stacked and knocked slightly out of true. */
export function FolderStack() {
  return (
    <div className="relative h-24 w-22" aria-hidden="true">
      {[-7, 3, 0].map((angle, i) => (
        <span
          key={angle}
          className="absolute left-1/2 h-15 w-22 -translate-x-1/2 rounded-md border border-dashed border-surface-700"
          style={{ top: `${i * 0.75}rem`, transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      ))}
    </div>
  );
}

/**
 * A year drawn in outline — the shape of a page that hasn't been filled in.
 *
 * Stroked rather than filled because a solid 7rem number would be the loudest
 * thing on a screen whose whole message is that there is nothing to show.
 */
export function OutlineYear({ year }: { year: number }) {
  return (
    <p
      className="font-brand text-[7rem] font-extrabold leading-none tracking-tight"
      style={{
        color: "transparent",
        WebkitTextStroke: "1px var(--color-surface-700)",
      }}
    >
      {year}
    </p>
  );
}

/**
 * The query that found nothing, struck through at size.
 *
 * Repeating it back is the point: most empty results are a typo or a filter
 * the user forgot was on, and both are answered by seeing the actual string
 * that was searched.
 */
export function StruckQuery({ query }: { query: string }) {
  return (
    <p className="max-w-full truncate text-[2.5rem] font-bold leading-none text-surface-700 line-through">
      {query}
    </p>
  );
}
