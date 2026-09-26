// Copied from src/components/ui/card.tsx; the site keeps its own copy on
// purpose — CLAUDE.md, "The website".
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A raised panel: the surface fill, the neutral wash of light along its top and
 * the 1px catch-light on the edge — see `panel-wash` and `panel-top` in the
 * generated tokens.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // No `overflow-hidden`: the catch-light is a gradient that starts and
        // ends transparent, so it already fades out before the rounded corners
        // and clipping would only risk cutting off anything a card contains.
        "panel-wash panel-top rounded-panel border border-hair bg-surface-900 p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold text-ink-100", className)}
      {...props}
    />
  );
}
