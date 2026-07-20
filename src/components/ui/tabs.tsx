import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Reusable segmented control, extracted from the media-list status tabs. */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-accent-600 text-accent-ink"
              : "text-ink-500 hover:bg-surface-800 hover:text-ink-100",
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && (
            <span className="ml-1.5 text-xs opacity-70">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
