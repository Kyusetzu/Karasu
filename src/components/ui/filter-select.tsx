import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

/** A labelled dropdown readable unopened; keep the real `<select>` stretched over it for the native keyboard and a11y. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Shown as the value when nothing is selected. */
  placeholder?: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);

  return (
    <div
      className={cn(
        "relative flex h-8.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control",
        "border border-surface-800 bg-surface-900 px-2.5 transition-surface",
        "focus-within:border-accent-500 hover:bg-surface-850",
        className,
      )}
    >
      <span className="text-[.6875rem] uppercase tracking-[.08em] text-ink-600">
        {label}
      </span>
      <span className="max-w-32 truncate text-xs text-ink-300">
        {current?.label ?? placeholder}
      </span>
      <ChevronDown className="size-3 shrink-0 text-ink-600" />
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
