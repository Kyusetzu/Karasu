import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A text field; a search is `SearchField`, a count `NumberInput`. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-control border border-surface-700 bg-surface-900 px-3 text-sm text-ink-100",
      "placeholder:text-ink-600 focus:border-accent-500 focus:outline-none",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
