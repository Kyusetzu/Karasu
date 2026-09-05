// Copied from src/components/ui/pill.tsx; the site keeps its own copy on
// purpose — CLAUDE.md, "The website".
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A single-select chip. Inactive is an outline rather than a fill, so a row of
 * them reads as one control with one thing chosen — not six buttons.
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
