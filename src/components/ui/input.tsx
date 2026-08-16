import { forwardRef, type InputHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Renders a clear button inside the right edge, and calls this when it is
   * pressed. Absent by default, and that is load-bearing.
   *
   * The clear button needs a positioned wrapper, but ~25 call sites pass width
   * classes (`w-20`, `w-24`, `w-72`) expecting them to land on the `<input>`
   * itself — an unconditional wrapper would silently move every one of them onto
   * a `<div>` and leave the field full-width inside it. So the wrapper only
   * exists when a caller asks for the button.
   *
   * The caller keeps ownership of the value: this only reports the press.
   */
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
        {/* Only when there is something to clear — a button that does nothing is
            worse than no button, and it would sit in the tab order permanently.
            `sr-only` text rather than `aria-label` so the name is translated by
            the same mechanism as everything else on screen. */}
        {String(props.value ?? "").length > 0 && (
          <button
            type="button"
            // The field owns the focus; taking it on mousedown would blur the
            // caret and, on the boxes with `onBlur` commit handlers, fire them.
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
