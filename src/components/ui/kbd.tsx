import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A key cap; `quiet` dims it for a hint at the end of a field, where it must not outshout what is typed. */
export function Kbd({ children, quiet, className }: { children: ReactNode; quiet?: boolean; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5.5 min-w-5.5 shrink-0 place-items-center rounded-inner border border-surface-700 bg-surface-850 px-1.5 font-brand text-2xs font-semibold",
        quiet ? "text-ink-600" : "text-ink-300",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A combination, one cap per key in the order they are pressed. */
export function KeyCombo({ keys, quiet }: { keys: readonly string[]; quiet?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key} quiet={quiet}>
          {key}
        </Kbd>
      ))}
    </span>
  );
}
