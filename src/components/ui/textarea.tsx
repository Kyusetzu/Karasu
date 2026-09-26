import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A text field of several lines, in the same frame as `Input`. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-y rounded-control border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-ink-100",
        "placeholder:text-ink-600 focus:border-accent-500 focus:outline-none",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
