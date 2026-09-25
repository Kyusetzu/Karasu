import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A native choice with the field's frame; the system draws the list, so every platform keeps its own picker. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 rounded-control border border-surface-700 bg-surface-900 px-2 text-sm text-ink-100",
      "focus:border-accent-500 focus:outline-none",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";
