import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A count or a dot beside something: accent for what wants attention, neutral for a plain tally. */
export function Badge({
  count,
  max,
  tone = "accent",
  floating = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  /** Omitted with no children, the badge is a dot; children replace the number, as in `+3`. */
  count?: number;
  /** Above this the badge reads `max+`. */
  max?: number;
  tone?: "accent" | "neutral";
  /** Set over an icon or a control: a ring in the page colour cuts it free, and the caller places it. */
  floating?: boolean;
}) {
  const dot = count === undefined && children == null;
  return (
    <span
      className={cn(
        "shrink-0 tabular-nums",
        floating && "absolute border border-surface-950",
        dot
          ? cn("rounded-full bg-accent-500", floating ? "size-2" : "size-1.5")
          : tone === "accent"
            ? "grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent-500 px-1 text-2xs font-semibold leading-none text-accent-ink"
            : "rounded-inner bg-surface-800 px-1 text-2xs text-ink-300",
        className,
      )}
      {...rest}
    >
      {children ?? (count !== undefined && max !== undefined && count > max ? `${max}+` : count)}
    </span>
  );
}
