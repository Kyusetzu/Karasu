import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * A single-select chip.
 *
 * The entry editor spends six of these on status rather than a dropdown,
 * because status is the most-changed field in the app and a dropdown hides
 * five of the six options behind a click. Also used for the search filter
 * chips and the export dialog's format and scale rows.
 *
 * Inactive is an outline rather than a fill, so a row of them reads as one
 * control with one thing chosen — not six buttons.
 */
export const Pill = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ active = false, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-pressed={active}
    className={cn(
      "inline-flex h-7.5 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-surface",
      "focus-visible:outline-2 focus-visible:outline-accent-500 disabled:pointer-events-none disabled:opacity-50",
      active
        ? "bg-accent-500 text-accent-ink"
        : "border border-surface-700 text-ink-300 hover:border-surface-600 hover:bg-surface-850 hover:text-ink-100",
      className,
    )}
    {...props}
  />
));
Pill.displayName = "Pill";
