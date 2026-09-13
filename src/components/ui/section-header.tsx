import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The heading every Overview section wears; `meta` is the quiet one-line justification a section sometimes owes. */
export function SectionHeader({
  icon: Icon,
  title,
  meta,
  className,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Icon className="size-4 shrink-0 text-accent-400" />
      {/* Keep `min-w-0`, or the flex default of `min-width: auto` hands <main> a sideways scroll on a long title. */}
      <h2 className="min-w-0 truncate text-[.9375rem] font-semibold text-ink-100">
        {title}
      </h2>
      {meta && (
        <span className="shrink-0 text-2xs uppercase tracking-[.09em] text-ink-600">
          {meta}
        </span>
      )}
      <span className="section-rule" />
    </div>
  );
}
