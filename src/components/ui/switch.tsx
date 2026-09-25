import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** An on/off control: a track that fills with the accent and a thumb that slides across; `role="switch"`, never a checkbox. */
export function Switch({
  checked,
  onChange,
  disabled,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative press coarse:hit-area inline-flex h-4.75 w-8.5 shrink-0 items-center rounded-full border transition-surface",
        "disabled:pointer-events-none",
        // The off track's edge is the border role, so high contrast draws it where the fill alone would vanish.
        checked ? "border-accent-600 bg-accent-600" : "border-surface-700 bg-surface-700",
        className,
      )}
      {...rest}
    >
      {/* The thumb takes the accent's own readable ink when on, so it holds on any accent in either theme. */}
      <span
        aria-hidden
        className={cn(
          "size-4.25 rounded-full transition-[translate,background-color]",
          checked ? "translate-x-3.75 bg-accent-ink" : "translate-x-0 bg-ink-100",
        )}
      />
    </button>
  );
}
