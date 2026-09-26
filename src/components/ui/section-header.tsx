import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The heading every Overview section wears; `meta` is the quiet one-line justification a section sometimes owes. */
export function SectionHeader({
  icon: Icon,
  title,
  meta,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  /** A link at the far end of the rule, such as the way to everything a section only samples. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Icon className="size-4 shrink-0 text-accent-400" />
      {/* The title keeps its width and the meta line gives way, capped so a long title still cannot scroll <main>. */}
      <h2 className="max-w-full shrink-0 truncate text-base text-ink-100">
        {title}
      </h2>
      {meta && (
        <span className="min-w-0 truncate text-2xs uppercase tracking-eyebrow text-ink-600">
          {meta}
        </span>
      )}
      <span className="section-rule" />
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
