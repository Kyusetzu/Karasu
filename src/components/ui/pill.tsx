import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** A single-select chip; inactive is an outline, not a fill, so a row reads as one control with one thing chosen. */
export const Pill = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    /** The colour the choice stands for, as a status does: its dot always, and its tint once chosen. */
    tint?: string;
  }
>(({ active = false, tint, className, style, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-pressed={active}
    style={tint ? ({ ...style, "--tint": tint } as CSSProperties) : style}
    className={cn(
      "relative press coarse:hit-area inline-flex h-7.5 items-center justify-center gap-1.5 rounded-control px-3 text-xs font-medium transition-surface",
      "focus-visible:outline-2 focus-visible:outline-accent-500 disabled:pointer-events-none disabled:opacity-50",
      active
        ? cn("border tint-fill text-ink-100", !tint && "tint-accent")
        : "border border-surface-700 text-ink-300 hover:border-surface-600 hover:bg-surface-850 hover:text-ink-100",
      className,
    )}
    {...props}
  >
    {tint && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tint }} />}
    {children}
  </button>
));
Pill.displayName = "Pill";
