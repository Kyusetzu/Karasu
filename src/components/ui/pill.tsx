import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A single-select chip; inactive is an outline, not a fill, so a row reads as one control with one thing chosen. */
export const Pill = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ active = false, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-pressed={active}
    className={cn(
      "inline-flex h-7.5 items-center justify-center gap-1.5 rounded-control px-3 text-xs font-medium transition-surface",
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
