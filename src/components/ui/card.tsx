import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A raised panel: the surface fill, the accent-following wash (`panel-wash` in index.css) and the top catch-light. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // No `overflow-hidden`: the catch-light fades out before the corners, and clipping would only cut off contents.
        "panel-wash panel-top rounded-panel border border-surface-800 bg-surface-900 p-5",
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
