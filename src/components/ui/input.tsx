import { forwardRef, type InputHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders a clear button that reports the press; keep it opt-in, or its wrapper moves width classes off the field. */
  onClear?: () => void;
  /** Accessible name for that button — required whenever `onClear` is given. */
  clearLabel?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, onClear, clearLabel, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-lg border border-surface-700 bg-surface-900 px-3 text-sm text-ink-100",
          "placeholder:text-ink-600 focus:border-accent-500 focus:outline-none",
          // Room for the button, so a long value does not slide under it.
          onClear && "pr-8",
          className,
        )}
        {...props}
      />
    );

    if (!onClear) return field;

    return (
      <div className="relative w-full">
        {field}
        {/* Only when there is something to clear; a button that does nothing would sit in the tab order permanently. */}
        {String(props.value ?? "").length > 0 && (
          <button
            type="button"
            // The field owns the focus; taking it on mousedown would blur the caret and fire `onBlur` commit handlers.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-100"
          >
            <X className="size-3.25" />
            <span className="sr-only">{clearLabel}</span>
          </button>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
