import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * A raised panel: the surface fill, the iridescent wash and the 1px catch-light
 * along the top edge. The wash is what makes overlapping panels read as
 * feathers rather than stacked grey cards, and it follows the user's accent —
 * see `panel-wash` in index.css.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // No `overflow-hidden`: the catch-light is a gradient that starts and
        // ends transparent, so it already fades out before the rounded corners
        // and clipping would only risk cutting off anything a card contains.
        "panel-wash panel-top rounded-xl border border-surface-800 bg-surface-900 p-5",
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
    <h2
      className={cn("text-base font-semibold text-ink-100", className)}
      {...props}
    />
  );
}
