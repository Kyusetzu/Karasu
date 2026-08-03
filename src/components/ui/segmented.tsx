import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** Only needed when `label` is not plain text. */
  title?: string;
}

/**
 * Two or three mutually exclusive options, shown all at once.
 *
 * For switches between *views of the same thing* — grid or rows, anime or
 * manga, PNG or JPEG. The whole control is one bordered track and the active
 * segment is a raised fill inside it, which is what distinguishes it from a
 * row of {@link Pill}s: those choose a value, this chooses a lens.
 */
export function Segmented<T extends string>({
  segments,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 rounded-lg border border-surface-800 p-0.5",
        className,
      )}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={segment.title}
            aria-label={segment.title}
            onClick={() => onChange(segment.value)}
            className={cn(
              "grid h-7.5 min-w-7.5 place-items-center rounded-md px-2.5 text-xs font-medium transition-surface",
              "focus-visible:outline-2 focus-visible:outline-accent-500",
              active
                ? "bg-surface-800 text-ink-100"
                : "text-ink-500 hover:text-ink-300",
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
